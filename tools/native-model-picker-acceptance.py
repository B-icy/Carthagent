#!/usr/bin/env python3
"""Focused native model-picker cancel proof using a local two-model provider."""
import argparse
import fcntl
import hashlib
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import pty
import re
import select
import signal
import struct
import subprocess
import termios
import tempfile
import time
from datetime import datetime, timezone


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def option_style_bytes(transcript, option):
    pattern = re.compile(rb'(?:\x1b\[[0-9;]*m)*' + re.escape(option.encode('ascii')))
    matches = list(pattern.finditer(transcript))
    return matches[-1].group(0)[:-len(option)].decode('ascii', errors='replace') if matches else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', default=os.environ.get('CTG_OPENCODE_BIN'))
    parser.add_argument('--timeout', type=int, default=60)
    parser.add_argument('--artifact')
    args = parser.parse_args()
    if not args.binary:
        parser.error('pass --binary or set CTG_OPENCODE_BIN')
    binary = os.path.realpath(os.path.abspath(args.binary))
    if not os.path.isfile(binary):
        parser.error(f'binary not found: {binary}')
    version = subprocess.run([binary, '--version'], text=True, capture_output=True, timeout=20)
    if version.returncode or '2.0.32' not in version.stdout + version.stderr:
        parser.error(f'expected identified OpenCode 2.0.32 executable, got {version.stdout!r}')

    harness_path = Path(__file__).with_name('native-terminal-semantics.py')
    loader = importlib.machinery.SourceFileLoader('native_terminal_semantics', str(harness_path))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    harness = importlib.util.module_from_spec(spec)
    loader.exec_module(harness)
    provider = harness.Provider
    screen_type = harness.Screen
    provider.received.clear()
    provider.reply = 'MODEL_PICKER_FIXTURE_REPLY'

    source_root = Path(__file__).resolve().parents[1]
    source_commit = subprocess.run(['git', '-C', str(source_root), 'rev-parse', 'HEAD'],
                                   text=True, capture_output=True).stdout.strip()
    dirty = subprocess.run(['git', '-C', str(source_root), 'status', '--porcelain',
                             '--untracked-files=no'], text=True, capture_output=True).stdout.strip()
    result = {
        'startedAtUtc': datetime.now(timezone.utc).isoformat(),
        'case': 'native-model-picker-navigation-escape-unchanged-model',
        'binary': binary,
        'binaryVersion': (version.stdout + version.stderr).strip(),
        'binarySha256': sha256_file(binary),
        'sourceCommit': source_commit,
        'workingTreeDirty': bool(dirty),
        'probeSha256': sha256_file(__file__),
        'supportingHarnessSha256': sha256_file(harness_path),
        'provider': 'loopback offline fixture',
        'configuredModel': 'ctgfixture/fixture',
        'alternateModel': 'ctgfixture/alternate',
        'physicalOSClipboardVerified': False,
        'checks': {},
    }

    server = __import__('socketserver').ThreadingTCPServer(('127.0.0.1', 0), provider)
    import threading
    threading.Thread(target=server.serve_forever, daemon=True).start()
    master = slave = child = None
    try:
        with tempfile.TemporaryDirectory(prefix='ctg-model-picker-', ignore_cleanup_errors=True) as temp:
            root = os.path.abspath(temp)
            project = os.path.join(root, 'project')
            config_dir = os.path.join(root, 'config', 'opencode')
            for folder in (project, config_dir, os.path.join(root, 'home'),
                           os.path.join(root, 'data'), os.path.join(root, 'state'),
                           os.path.join(root, 'cache')):
                os.makedirs(folder, exist_ok=True)
            config = {
                'update': 'disable',
                'model': 'ctgfixture/fixture',
                'providers': {'ctgfixture': {
                    'name': 'CTG Picker Fixture',
                    'package': '@opencode/ai/providers/openai-compatible',
                    'settings': {'baseURL': f'http://127.0.0.1:{server.server_address[1]}/v1'},
                    'models': {
                        'fixture': {'name': 'CTG Picker A', 'limit': {'context': 32000, 'output': 1024}},
                        'alternate': {'name': 'CTG Picker B', 'limit': {'context': 32000, 'output': 1024}},
                    },
                }},
            }
            config_path = os.path.join(config_dir, 'opencode.json')
            Path(config_path).write_text(json.dumps(config), encoding='utf8')
            env = {key: os.environ[key] for key in ('PATH', 'LANG', 'LC_ALL') if key in os.environ}
            env.update({
                'HOME': os.path.join(root, 'home'), 'TERM': 'xterm-256color',
                'COLORTERM': 'truecolor', 'XDG_CONFIG_HOME': os.path.join(root, 'config'),
                'XDG_DATA_HOME': os.path.join(root, 'data'), 'XDG_STATE_HOME': os.path.join(root, 'state'),
                'XDG_CACHE_HOME': os.path.join(root, 'cache'), 'OPENCODE_DB': os.path.join(root, 'db.sqlite'),
                'OPENCODE_CONFIG_DIR': config_dir, 'OPENCODE_CONFIG': config_path,
                'OPENCODE_CONFIG_PROJECT_DISABLE': 'true',
            })
            master, slave = pty.openpty()
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 32, 100, 0, 0))
            child = subprocess.Popen([binary, '--standalone'], cwd=project, env=env,
                                     stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
            os.close(slave)
            slave = None
            screen = screen_type(rows=32, columns=100)
            transcript = bytearray()

            def pump(duration=.15):
                deadline = time.monotonic() + duration
                while time.monotonic() < deadline:
                    if child.poll() is not None:
                        raise RuntimeError(f'host exited early ({child.returncode}): {screen.visible()[-1000:]}')
                    if not select.select([master], [], [], .03)[0]:
                        continue
                    chunk = os.read(master, 65536)
                    transcript.extend(chunk)
                    screen.feed(chunk)
                    if b'\x1b[6n' in chunk:
                        os.write(master, b'\x1b[1;1R')
                    if b'\x1b[c' in chunk:
                        os.write(master, b'\x1b[?1;2c')

            def until(predicate, label, timeout=10):
                deadline = time.monotonic() + timeout
                while time.monotonic() < deadline:
                    pump(.1)
                    if predicate():
                        return
                raise TimeoutError(f'timeout waiting for {label}: screen={screen.visible()[-1200:]!r} '
                                   f'transcript={bytes(transcript[-3000:])!r}')

            until(lambda: 'ask anything' in screen.visible().lower() or
                  'what is the tech' in screen.visible().lower(), 'home composer')
            # Open a native session first so the footer/model state is explicit.
            os.write(master, b'\r')
            until(lambda: 'Build · CTG Picker A' in screen.visible(), 'active session with configured model A')
            # Native runtime binding: Ctrl+X leader then m => model.list.
            baseline_model = 'fixture'
            if 'Build · CTG Picker A' not in screen.visible():
                raise AssertionError('configured model A is not visible in active session metadata before picker')
            os.write(master, b'\x18')
            pump(.12)
            os.write(master, b'm')
            until(lambda: 'select model' in screen.visible().lower(), 'native model picker')
            requests_before_cancel = len(provider.received)

            # Filter to the two controlled choices, prove keyboard highlight moved
            # from A to B via ANSI inverse rendition at the model row, then Escape.
            os.write(master, b'CTG Picker')
            until(lambda: 'CTG Picker A' in screen.visible() and 'CTG Picker B' in screen.visible(),
                  'both filtered model choices')
            picker_before = screen.visible()
            if '● CTG Picker A' not in picker_before:
                raise AssertionError(f'current model A not visibly selected before navigation: {picker_before[-1200:]}')
            raw_before_navigation = bytes(transcript)
            os.write(master, b'\x1b[B')
            pump(.25)
            picker_after_down = screen.visible()
            if 'CTG Picker B' not in picker_after_down or 'Select model' not in picker_after_down:
                raise AssertionError(f'model picker did not remain with alternate option after ArrowDown: {picker_after_down[-1200:]}')
            style_a = option_style_bytes(bytes(transcript), 'CTG Picker A')
            style_b = option_style_bytes(bytes(transcript), 'CTG Picker B')
            if (not style_a or not style_b or style_a == style_b or
                    style_a == option_style_bytes(raw_before_navigation, 'CTG Picker A') or
                    style_b == option_style_bytes(raw_before_navigation, 'CTG Picker B')):
                raise AssertionError(f'ArrowDown did not produce independently distinguishable A/B option styling: A={style_a!r}, B={style_b!r}')
            # In this dialog Escape first clears the active model-search filter;
            # a second Escape closes the picker without submitting the highlight.
            os.write(master, b'\x1b')
            pump(.35)
            if 'Select model' in screen.visible() and 'CTG Picker' not in screen.visible():
                raise AssertionError('unexpected intermediate model-search reset state')
            os.write(master, b'\x1b')
            until(lambda: 'select model' not in screen.visible().lower(), 'model picker Escape dismissal')
            after_cancel = screen.visible()
            requests_after_cancel = len(provider.received)
            if 'ask anything' not in after_cancel.lower() and '┃' not in after_cancel:
                raise AssertionError(f'composer not restored after model picker Escape: {after_cancel[-1000:]}')
            if requests_after_cancel != requests_before_cancel:
                raise AssertionError('provider request occurred during model-picker navigation/cancel')

            if 'Build · CTG Picker A CTG Picker Fixture' not in after_cancel:
                raise AssertionError(f'configured model A not retained in active session metadata after cancel: {after_cancel[-1200:]}')

            # Enter the session, then submit a new unique prompt from the session
            # composer so model selection is evidenced by a real provider request.
            os.write(master, b'MODEL-A-AFTER-CANCEL')
            until(lambda: 'MODEL-A-AFTER-CANCEL' in screen.visible(), 'post-cancel prompt staged')
            os.write(master, b'\r')
            until(lambda: len(provider.received) > requests_before_cancel,
                  'post-cancel fixture request', timeout=20)
            after_models = [body.get('model') for body in provider.received[requests_before_cancel:]]
            after_messages = provider.received[-1].get('messages', [])
            exact_prompt = any(message.get('role') == 'user' and
                               'MODEL-A-AFTER-CANCEL' in str(message.get('content', ''))
                               for message in after_messages)
            if not exact_prompt and not any('MODEL-A-AFTER-CANCEL' in str(message) for message in after_messages):
                pump(.8)
                if len(provider.received) == requests_before_cancel:
                    os.write(master, b'\r')
                    until(lambda: len(provider.received) > requests_before_cancel,
                          'second enter post-cancel fixture request')
                after_models = [body.get('model') for body in provider.received[requests_before_cancel:]]
                after_messages = provider.received[-1].get('messages', [])
                exact_prompt = any(message.get('role') == 'user' and
                                   'MODEL-A-AFTER-CANCEL' in str(message.get('content', ''))
                                   for message in after_messages)
            if not exact_prompt:
                raise AssertionError('post-cancel request did not contain the unique exact prompt')
            if not after_models or any(model != 'fixture' for model in after_models):
                raise AssertionError(f'configured model changed after cancellation: {after_models!r}')

            result['checks']['modelPickerNavigationEscapeUnchangedModel'] = {
                'status': 'PASS',
                'modelPickerObserved': True,
                'modelOptionsVisible': ['CTG Picker A', 'CTG Picker B'],
                'currentModelBeforeNavigationVisible': 'CTG Picker A' in picker_before,
                'navigationKeySent': 'ArrowDown',
                'alternateOptionVisibleAfterNavigation': 'CTG Picker B' in picker_after_down,
                'selectedOptionStyleAfterNavigation': style_b,
                'otherOptionStyleAfterNavigation': style_a,
                'escapeDismissedPicker': True,
                'composerRestored': True,
                'providerRequestsDuringCancel': requests_after_cancel - requests_before_cancel,
                'activeSessionMetadataStillShowsModelA': 'Build · CTG Picker A CTG Picker Fixture' in after_cancel,
                'baselineProviderModel': baseline_model,
                'postCancelProviderModels': after_models,
                'postCancelUniquePromptAccepted': exact_prompt,
                'provider': 'loopback offline fixture',
            }
            result['status'] = 'PASS_BOUNDED'
            result['checks']['physicalOSClipboardVerified'] = {'status': 'NOT_TESTED'}
            pump(.3)
    except Exception as error:
        result['status'] = 'INCOMPLETE'
        result['checks'].setdefault('modelPickerNavigationEscapeUnchangedModel', {
            'status': 'FAIL', 'error': f'{type(error).__name__}: {error}'})
    finally:
        if child is not None and child.poll() is None:
            os.write(master, b'\x15/quit\r')
            try:
                child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
        if slave is not None:
            os.close(slave)
        if master is not None:
            os.close(master)
        server.shutdown()
        server.server_close()

    rendered = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    print(rendered, end='')
    if args.artifact:
        artifact = Path(args.artifact).resolve()
        artifact.parent.mkdir(parents=True, exist_ok=True)
        artifact.write_text(rendered, encoding='utf8')
    return 0 if result['status'] == 'PASS_BOUNDED' else 2


if __name__ == '__main__':
    raise SystemExit(main())
