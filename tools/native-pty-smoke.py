#!/usr/bin/env python3
"""Exercise a native CTG plugin command in a disposable real terminal host."""
import argparse
import fcntl
import hashlib
import json
import os
import pathlib
import pty
import re
import select
import shutil
import signal
import struct
import subprocess
import tempfile
import termios
import time
from contextlib import nullcontext


def host_environment(source):
    """Do not forward the runtime-download credential to the native TUI host."""
    return {key: value for key, value in source.items() if key.lower() != 'ctg_runtime_github_token'}


def resolve_binary(value):
    """Resolve explicit developer paths; default binary selection belongs to the JS runtime gate."""
    if value and (os.path.isabs(value) or os.sep in value or (os.altsep and os.altsep in value)):
        candidate = pathlib.Path(value).expanduser().resolve()
        return str(candidate) if candidate.is_file() else None
    if value:
        found = shutil.which(value)
        if found:
            return str(pathlib.Path(found).resolve())
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True, help='Binary selected and validated by the production runtime resolver')
    parser.add_argument('--expected-sha256', required=True, help='Independently verified binary identity supplied by the JS acceptance gate')
    parser.add_argument('--node-executable', required=True, help='Node runtime used to provision the isolated native profile')
    parser.add_argument('--plugin', default=str(pathlib.Path(__file__).resolve().parents[1] / 'plugins/carthagent'))
    parser.add_argument('--command', default='/ctg-status')
    parser.add_argument('--command-args', help='Type slash-command arguments after selecting the command suggestion')
    parser.add_argument('--after-command', action='append', help='Submit another command after expected output; may be repeated')
    parser.add_argument('--after-expect', action='append', help='Expected output for each additional command')
    parser.add_argument('--expect', default='OpenCode 2.0.32')
    parser.add_argument('--capture', help='Save the full raw PTY transcript for diagnosis')
    parser.add_argument('--expect-color', help='Require a truecolor ANSI RGB sequence after the command, e.g. 230,196,128')
    parser.add_argument('--initial-theme', help='Select a provisioned native theme before launching the TUI')
    parser.add_argument('--expect-theme', help='Require this native theme selection to persist after command submission')
    parser.add_argument('--state-dir', help='Reuse an isolated profile across native process restarts')
    parser.add_argument('--reuse-state', action='store_true', help='Reuse the isolated state without reprovisioning it')
    parser.add_argument('--expect-startup-color', action='store_true', help='Require the configured accent in the initial process render')
    parser.add_argument('--write-initial-theme', action='store_true', help='Write --initial-theme before native startup')
    parser.add_argument('--ready', help='Wait for this marker before typing')
    parser.add_argument('--confirm', action='store_true', help='Wait for command submission and confirmation handling to settle')
    parser.add_argument('--second-enter', action='store_true', help='Wait for command submission and confirmation handling to settle')
    parser.add_argument('--post-submit-marker', help='Require an additional unique marker after submission')
    args = parser.parse_args()
    args.binary = resolve_binary(args.binary)
    if not args.binary:
        parser.error('The selected OpenCode binary is missing; select and validate it through the production runtime resolver first')
    if not re.fullmatch(r'[a-f0-9]{64}', args.expected_sha256):
        parser.error('--expected-sha256 must be a lowercase SHA-256 digest')
    actual = hashlib.sha256(pathlib.Path(args.binary).read_bytes()).hexdigest()
    if actual != args.expected_sha256:
        parser.error(f'Selected OpenCode binary SHA-256 changed before PTY execution: {actual}')
    state = pathlib.Path(args.state_dir) if args.state_dir else None
    temp_context = nullcontext(str(state)) if state else tempfile.TemporaryDirectory(prefix='ctg-pty-')
    with temp_context as temp:
        root = pathlib.Path(temp)
        for name in ['home', 'project', 'config/opencode', 'data', 'state', 'cache']:
            (root / name).mkdir(parents=True, exist_ok=True)
        # Mirror the launcher contract: custom themes are installed before the
        # native TUI scans its profile. Installing from inside the running TUI
        # cannot make a newly-created theme selectable in that same process.
        provisioner = pathlib.Path(args.plugin).resolve() / 'src/ui/theme-provision.mjs'
        if not args.reuse_state:
            (root / 'config/opencode/opencode.json').write_text(json.dumps({
                'plugins': [str(pathlib.Path(args.plugin).resolve())], 'update': 'disable',
            }))
            subprocess.run([
                args.node_executable, '--input-type=module', '-e',
                "const { provisionDefaultNativeTheme } = await import(process.argv[1]); await provisionDefaultNativeTheme(process.argv[2]);",
                str(provisioner), str(root / 'config/opencode'),
            ], check=True)
        if args.initial_theme and args.write_initial_theme:
            (root / 'config/opencode/cli.json').write_text(json.dumps({'theme': {'name': args.initial_theme}}))
        cli_config_path = root / 'config/opencode/cli.json'
        initial_config = json.loads(cli_config_path.read_text()) if cli_config_path.exists() else {}
        env = host_environment(os.environ)
        node_binary = pathlib.Path(args.node_executable).resolve()
        if not node_binary.is_file():
            parser.error(f'Trusted Node executable does not exist: {node_binary}')
        env['CTG_NODE_EXECUTABLE'] = str(node_binary)
        env.update({
            'HOME': str(root / 'home'), 'TERM': 'xterm-256color', 'COLORTERM': 'truecolor',
            'XDG_CONFIG_HOME': str(root / 'config'), 'XDG_DATA_HOME': str(root / 'data'),
            'XDG_STATE_HOME': str(root / 'state'), 'XDG_CACHE_HOME': str(root / 'cache'),
            'OPENCODE_CONFIG_DIR': str(root / 'config/opencode'),
            'OPENCODE_DB': str(root / 'database.sqlite'),
            'OPENCODE_CONFIG_PROJECT_DISABLE': 'true',
        })
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 36, 120, 0, 0))
        child = subprocess.Popen([args.binary, '--standalone'], cwd=root / 'project', env=env,
                                 stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        output = bytearray()
        transcript = bytearray()
        started = time.monotonic()
        sent = False
        sent_at = None
        selected_at = None
        submitted = False
        confirmation_complete = False
        completion_dismissed = False
        after_completion_dismissed = False
        submission_at = None
        enter_count = 0
        after_index = 0
        after_typed_at = None
        pre_submit_transcript = None
        try:
            while time.monotonic() - started < 30:
                if child.poll() is not None:
                    raise RuntimeError(f'Native TUI exited early: {child.returncode}')
                if select.select([master], [], [], 0.1)[0]:
                    chunk = os.read(master, 65536)
                    output.extend(chunk)
                    transcript.extend(chunk)
                    # Terminal capability requests need replies on a headless PTY.
                    if b'\x1b[6n' in chunk:
                        os.write(master, b'\x1b[1;1R')
                    if b'\x1b[c' in chunk:
                        os.write(master, b'\x1b[?1;2c')
                ready = args.ready.encode() in transcript if args.ready else time.monotonic() - started > 8
                if not sent and ready:
                    pre_submit_transcript = bytes(transcript)
                    output.clear()
                    sent_at = time.monotonic()
                    command = args.command + (f' {args.command_args}' if args.command_args else '')
                    os.write(master, command.encode())
                    sent = True
                if sent and not submitted and after_index == 0 and time.monotonic() - sent_at > 1:
                    if not completion_dismissed:
                        # Argument-taking commands consume Enter to select a
                        # slash suggestion. Dismiss that overlay first, just as
                        # the follow-up path does, then submit exactly once.
                        os.write(master, b'\x1b')
                        completion_dismissed = True
                        sent_at = time.monotonic()
                        continue
                    # Submit the fully typed native command once. Do not reset
                    # `sent`: the ready gate must never type the command twice.
                    output.clear()
                    os.write(master, b'\r')
                    enter_count += 1
                    submitted = True
                    submission_at = time.monotonic()
                confirmation_prompt = re.search(rb'(?i)(?:are you sure|confirm\?|\[y/n\]|\(y/n\)|press enter to confirm)', output)
                if submitted and submission_at is not None and not confirmation_complete:
                    if confirmation_prompt:
                        # A second Enter must never be speculative. Keep the
                        # test blocked until an explicit confirmation UI is
                        # handled by a purpose-built confirmation action.
                        raise RuntimeError('Command opened a confirmation prompt; no explicit confirmation handler is configured')
                    if time.monotonic() - submission_at > 2:
                        confirmation_complete = True
                after_commands = args.after_command or []
                after_expects = args.after_expect or []
                if len(after_commands) != len(after_expects):
                    raise ValueError('--after-command and --after-expect must be supplied in matching counts')
                expected_output = args.expect if after_index == 0 else after_expects[after_index - 1]
                if submitted and expected_output.encode() in output and after_index < len(after_commands):
                    output.clear()
                    os.write(master, after_commands[after_index].encode())
                    after_typed_at = time.monotonic()
                    after_completion_dismissed = False
                    after_index += 1
                    submitted = False
                    confirmation_complete = False
                    submission_at = None
                    continue
                if after_index and not submitted and not after_completion_dismissed and time.monotonic() - after_typed_at > 1:
                    # Follow-up commands must use the same explicit submit path
                    # as the top-level probe. In particular, the theme command
                    # may leave the host's slash completion active; the first
                    # Enter could select a completion instead of submitting.
                    output.clear()
                    os.write(master, b'\x1b')
                    after_completion_dismissed = True
                    after_typed_at = time.monotonic()
                if after_index and not submitted and after_completion_dismissed and time.monotonic() - after_typed_at > 0.5:
                    os.write(master, b'\r')
                    submitted = True
                    sent_at = time.monotonic()
                    submission_at = sent_at
                    output.clear()
                command_submitted = submitted and (confirmation_complete or not (args.confirm or args.second_enter))
                result_output = command_submitted and expected_output.encode() in output and (not args.post_submit_marker or args.post_submit_marker.encode() in output)
                if result_output:
                    if b'runtime unavailable' in output or b'No matching commands' in output:
                        raise RuntimeError('Command was unavailable or its RPC failed')
                    if args.expect_theme:
                        theme_config = json.loads(cli_config_path.read_text())
                        assert theme_config.get('theme', {}).get('name') == args.expect_theme, theme_config
                    if args.expect_color and (args.initial_theme or args.expect_theme):
                        channels = [part.strip() for part in args.expect_color.split(',')]
                        if len(channels) != 3 or any(not part.isdigit() or int(part) > 255 for part in channels):
                            raise ValueError('--expect-color must be an RGB triple such as 242,198,109')
                        ansi = f"\x1b[38;2;{';'.join(channels)}m".encode()
                        if ansi not in output:
                            print(f'Expected rendered foreground color {ansi!r} was not observed; recent raw PTY bytes: {output[-12000:]!r}')
                            raise AssertionError('Rendered accent color did not match the selected native theme')
                    if args.expect_startup_color and args.expect_color:
                        channels = [part.strip() for part in args.expect_color.split(',')]
                        ansi = f"\x1b[38;2;{';'.join(channels)}m".encode()
                        if ansi not in pre_submit_transcript:
                            raise AssertionError('Persisted theme accent was not present in the restarted process initial render')
                    print(json.dumps({'command': args.command, 'observed': expected_output,
                                      'postSubmission': True, 'enterCount': enter_count,
                                       'theme': args.expect_theme or args.initial_theme if args.expect_color else None,
                                      'ansiColor': args.expect_color,
                                      'elapsedMs': round((time.monotonic() - started) * 1000),
                                      'terminalBytes': len(output)}))
                    return
            plain = re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]', b'', bytes(output))
            for log in (root / 'data').rglob('*.log'):
                lines = [line for line in log.read_text(errors='replace').splitlines()
                         if 'plugin' in line.lower() or 'error' in line.lower()]
                print('\n'.join(lines[-30:]))
            raise RuntimeError(f'Expected {args.expect!r} not rendered: {plain[-8000:].decode(errors="replace")}')
        finally:
            if args.capture:
                pathlib.Path(args.capture).write_bytes(transcript)
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
            os.close(master)


if __name__ == '__main__':
    main()
