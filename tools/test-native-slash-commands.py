#!/usr/bin/env python3
"""Bounded actual-slash PTY acceptance for the active Carthagent native plugin."""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pty
import select
import signal
import struct
import subprocess
import termios
import time

def load_local_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


Screen = load_local_module('native_terminal_semantics', 'native-terminal-semantics.py').Screen
_env = load_local_module('native_slash_acceptance_env', 'native-slash-acceptance-env.py')
TUI_ENV_KEYS = _env.TUI_ENV_KEYS
assert_clean_child_environment = _env.assert_clean_child_environment
fixture_environment = _env.fixture_environment


class Tui:
    def __init__(self, binary, fixture, session_id, env):
        self.master, slave = pty.openpty()
        self.rows, self.columns = 45, 130
        fcntl.ioctl(slave, termios.TIOCSWINSZ,
                    struct.pack('HHHH', self.rows, self.columns, 0, 0))
        child_env = {**env, 'TERM': 'xterm-256color', 'COLORTERM': 'truecolor',
                     'OPENCODE_PASSWORD': fixture['password']}
        assert_clean_child_environment(child_env)
        self.child = subprocess.Popen([binary, '--server', fixture['baseUrl'],
            '--session', session_id], cwd=fixture['cwd'], env=child_env,
            stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        self.screen = Screen(rows=self.rows, columns=self.columns)
        self.raw = bytearray()
        self.stopped = False

    def drain(self, seconds=.15):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if select.select([self.master], [], [], .04)[0]:
                try: data = os.read(self.master, 65536)
                except OSError: return
                if not data: return
                self.raw.extend(data)
                self.screen.feed(data)
            elif self.child.poll() is not None:
                raise AssertionError(f'native TUI exited early: {self.child.returncode}')

    def wait_for(self, predicate, description, timeout=12):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            self.drain(.1)
            if predicate():
                self.drain(.12)
                return
        raise AssertionError(f'timed out waiting for {description}:\n{self.screen.visible()}')

    def submit_slash(self, command, marker=None, select_next=False, extra_enter=False, use_tab=False):
        # Native OpenCode opens slash completion on the first Enter; the second
        # Enter accepts the exact typed command and invokes the plugin handler.
        before = len(self.raw)
        command_name, separator, arguments = command.partition(' ')
        if select_next:
            # Enter opens the duplicate command list; selecting the second exact
            # /stats entry must dispatch the CTG handler rather than host stats.
            os.write(self.master, command_name.encode('utf8') + b'\r')
            self.drain(.35)
            os.write(self.master, b'\x1b[B\x1b[B')
            self.drain(.2)
            os.write(self.master, b'\r')
        else:
            os.write(self.master, command_name.encode('utf8'))
            self.drain(.35)
            os.write(self.master, b'\t')
            self.drain(.15)
            if separator:
                os.write(self.master, (' ' + arguments).encode('utf8'))
                self.drain(.12)
            os.write(self.master, b'\r')
        if extra_enter:
            self.drain(.12)
            os.write(self.master, b'\r')
        if marker:
            self.wait_for(lambda: marker in self.screen.visible(), f'dispatched {command}')
        return {'typed': command, 'ptyBytes': len(self.raw) - before,
                'visibleTail': self.screen.visible()[-500:]}

    def send_prompt(self, text, marker):
        os.write(self.master, text.encode('utf8') + b'\r')
        self.wait_for(lambda: marker in self.screen.visible(), f'assistant marker {marker}')

    def stop(self):
        if self.stopped:
            return
        self.stopped = True
        if self.child.poll() is None:
            try: os.killpg(self.child.pid, signal.SIGTERM)
            except ProcessLookupError: pass
            try: self.child.wait(timeout=4)
            except subprocess.TimeoutExpired:
                os.killpg(self.child.pid, signal.SIGKILL)
                self.child.wait(timeout=4)
        try: os.close(self.master)
        except OSError: pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True)
    parser.add_argument('--owned-root', required=True)
    parser.add_argument('--release-manifest', required=True)
    parser.add_argument('--fixture', required=True, help='JSON line emitted by native-fixture.mjs')
    parser.add_argument('--artifact')
    args = parser.parse_args()
    fixture = json.loads(Path(args.fixture).read_text())
    env = fixture_environment(os.environ, Path(fixture['temp']) / 'tui-home',
                             Path(args.owned_root).resolve(),
                             Path(args.release_manifest).resolve())
    env = {key: value for key, value in env.items() if key in TUI_ENV_KEYS}
    env['OPENCODE_SERVER_PASSWORD'] = fixture['password']
    env['OPENCODE_SERVER_USERNAME'] = 'opencode'
    assert_clean_child_environment(env)
    binary = str(Path(args.binary).resolve())
    digest = hashlib.sha256(Path(binary).read_bytes()).hexdigest()
    tui = Tui(binary, fixture, fixture['sessionID'], env)
    checks = {}
    try:
        tui.wait_for(lambda: '┃' in tui.screen.visible(), 'active session composer')
        if 'getting started' in tui.screen.visible().lower():
            for _ in range(2):
                os.write(tui.master, b'\x1b')
                tui.drain(.25)
        tui.send_prompt('SLASH_FIXTURE_SEED <script>alert("x")</script> & "quoted"',
                        'FIXTURE_REPLY')

        export_name = 'slash-acceptance.html'
        checks['exportDispatch'] = tui.submit_slash(f'/export {export_name}', 'Session exported')
        exported = Path(fixture['cwd']) / export_name
        end = time.monotonic() + 8
        while not exported.exists() and time.monotonic() < end: time.sleep(.05)
        html = exported.read_text(encoding='utf8')
        assert '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;quoted&quot;' in html
        assert '<script>alert("x")</script>' not in html
        checks['exportHtmlEscapesFullConversation'] = {'path': export_name,
            'bytes': exported.stat().st_size, 'escapedPromptPresent': True,
            'activeScriptAbsent': True, 'completeDocument': html.startswith('<!doctype html>') and html.endswith('</html>')}

        stats_start = len(tui.raw)
        os.write(tui.master, b'/stats')
        tui.drain(.3)
        stats_result = tui.submit_slash('/stats details')
        tui.drain(.2)
        visible = tui.screen.visible()
        stats_status = 'PASS' if 'Input tokens: not reported' in visible and 'Cost: not reported' in visible else 'FAIL'
        stats_details = {'dialogRendered': stats_status == 'PASS',
            'observedNativeStatsInstead': 'Usage statistics' in visible,
            'rendered': visible[-1000:]}
        if stats_status == 'PASS':
            os.write(tui.master, b'\r')
            tui.drain(.2)
        else:
            os.write(tui.master, b'\x1b')
            tui.drain(.3)
        stats_result = {'typed': '/stats details',
            'ptyBytes': len(tui.raw) - stats_start,
            'visibleTail': tui.screen.visible()[-500:]}
        checks['statsDispatch'] = {**stats_result, 'status': stats_status}
        checks['statsActualSessionAndUnknownHandling'] = stats_details

        checks['guideTaskDispatch'] = tui.submit_slash('/guide framed task marker', 'GUIDE_FIXTURE_REPLY')
        checks['guideToggleDispatch'] = tui.submit_slash('/guide ')
        toggle_prompt = 'GUIDE_TOGGLE_SENTINEL exact text'
        os.write(tui.master, b'\x15')
        tui.drain(.1)
        tui.send_prompt(toggle_prompt, 'FIXTURE_REPLY')
        tui.drain(.3)
        provider_log = Path(fixture['providerLog'])
        provider_prompts = json.loads(provider_log.read_text()) if provider_log.exists() else []
        toggle_provider_prompt = next((text for text in provider_prompts if toggle_prompt in text), '')
        toggle_status = 'PASS' if toggle_provider_prompt == toggle_prompt else 'FAIL'
        checks['guideToggleObserved'] = {'status': toggle_status,
            'providerPromptReceived': bool(toggle_provider_prompt),
            'framingDisabled': toggle_provider_prompt == toggle_prompt,
            'providerPromptExcerpt': toggle_provider_prompt[:300]}
        checks['rawDispatch'] = tui.submit_slash('/raw RAW_SENTINEL exact text', 'RAW_FIXTURE_REPLY')
        provider_prompts = json.loads(provider_log.read_text()) if provider_log.exists() else []
        raw_prompt = next((text for text in provider_prompts if 'RAW_SENTINEL' in text), '')
        checks['rawFramingBypass'] = {'status': 'PASS' if 'Deliver this task in phases' not in raw_prompt and raw_prompt.endswith('RAW_SENTINEL exact text') else 'FAIL',
            'providerPromptExcerpt': raw_prompt[:500]}
        guide_prompt = next((text for text in provider_prompts if 'framed task marker' in text), '')
        checks['guideTaskFraming'] = {'status': 'PASS' if 'Deliver this task in phases' in guide_prompt else 'FAIL',
            'providerPromptExcerpt': guide_prompt[:500]}

        checks['workflowRoute'] = tui.submit_slash('/workflow', 'CARTHAGENT · WORKFLOW')
        # The plugin route is persistent; subsequent slash text is not submitted
        # from that custom renderer. Other views are exercised from independent
        # sessions by the surrounding route-level harness, not claimed here.
        tui.stop()
        for command, expected, key in (
                ('/architecture', 'CARTHAGENT · ARCHITECTURE', 'architectureRoute'),
                ('/evidence', 'CARTHAGENT · EVIDENCE', 'evidenceRoute')):
            route_tui = Tui(binary, fixture, fixture['sessionID'], env)
            try:
                route_tui.wait_for(lambda: '┃' in route_tui.screen.visible(), 'route session composer')
                checks[key] = route_tui.submit_slash(command, expected)
            finally:
                route_tui.stop()
        submitted = checks['submittedSlashes'] = [
            '/export slash-acceptance.html', '/stats', '/guide framed task marker', '/guide ',
            '/raw RAW_SENTINEL exact text', '/workflow', '/architecture', '/evidence']
        assert len(submitted) == len(set(submitted)), 'slash submission evidence contains duplicate commands'
        failures = [name for name, value in checks.items()
                    if isinstance(value, dict) and value.get('status') == 'FAIL']
        result = {'status': 'PASS' if not failures else 'PARTIAL', 'failures': failures,
            'scope': 'Linux POSIX PTY; actual native plugin slash submissions; offline loopback provider',
            'binarySha256': digest, 'sessionID': fixture['sessionID'],
            'pluginReadiness': fixture['pluginReadiness'], 'providerRequests': fixture['providerRequests'],
            'checks': checks}
        rendered = json.dumps(result, indent=2, ensure_ascii=False) + '\n'
        print(rendered, end='')
        if args.artifact:
            Path(args.artifact).write_text(rendered, encoding='utf8')
        if failures:
            return 2
    finally:
        tui.stop()


if __name__ == '__main__':
    main()
