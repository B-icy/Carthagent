#!/usr/bin/env python3
"""Run only the native mouse-selection probe against an existing session."""
import argparse
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


def load_screen():
    path = Path(__file__).with_name('native-terminal-semantics.py')
    spec = importlib.util.spec_from_file_location('native_terminal_semantics', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.Screen, module.rendered_fixture_body_row


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True)
    parser.add_argument('--expected-sha256', required=True)
    parser.add_argument('--expected-version', required=True)
    parser.add_argument('--expected-probe-sha256', required=True)
    parser.add_argument('--server', required=True)
    parser.add_argument('--session', required=True)
    parser.add_argument('--server-password', required=True)
    parser.add_argument('--cwd', required=True, help='fixture project directory for this session')
    parser.add_argument('--response', default='FINAL[SNIP]END')
    parser.add_argument('--selection', default='SNIP')
    parser.add_argument('--expected-provider-ready', action='store_true',
                        help='the fixture has received and completed a provider turn')
    parser.add_argument('--timeout', type=int, default=25)
    parser.add_argument('--retain-state', action='store_true',
                        help='retain PTY transcript and JSON diagnostics in /tmp/opencode')
    args = parser.parse_args()
    Screen, body_row = load_screen()
    probe_sha = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    if probe_sha != args.expected_probe_sha256:
        parser.error(f'probe source SHA-256 mismatch: expected {args.expected_probe_sha256}, got {probe_sha}')
    binary = str(Path(args.binary).resolve())
    digest = hashlib.sha256(Path(binary).read_bytes()).hexdigest()
    if digest != args.expected_sha256:
        parser.error(f'binary SHA-256 mismatch: expected {args.expected_sha256}, got {digest}')
    version = subprocess.run([binary, '--version'], capture_output=True, text=True, timeout=20)
    actual_version = (version.stdout + version.stderr).strip()
    if version.returncode != 0 or actual_version != args.expected_version:
        parser.error(f'binary version mismatch: expected {args.expected_version!r}, got {actual_version!r}')
    cwd = str(Path(args.cwd).resolve())
    rows, columns = 32, 100
    master, slave = pty.openpty()
    import fcntl
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', rows, columns, 0, 0))
    env = {key: os.environ[key] for key in ('PATH', 'LANG', 'LC_ALL') if key in os.environ}
    env.update({'TERM': 'xterm-256color', 'COLORTERM': 'truecolor',
                'OPENCODE_SERVER_PASSWORD': args.server_password,
                'OPENCODE_CONFIG_PROJECT_DISABLE': 'true'})
    child = subprocess.Popen([binary, '--server', args.server, '--session', args.session],
                             cwd=cwd, env=env, stdin=slave, stdout=slave,
                             stderr=slave, start_new_session=True)
    os.close(slave)
    screen = Screen(rows, columns)
    output = bytearray()
    events = []
    result = {'case': 'existing-session-selection', 'server': args.server,
              'session': args.session, 'binary': binary, 'response': args.response,
              'binaryResolvedPath': binary, 'binarySha256': digest, 'binaryVersion': actual_version,
              'probeSha256': probe_sha,
              'cwd': cwd,
              'selection': args.selection, 'terminal': {'rows': rows, 'columns': columns},
              'retainedState': args.retain_state,
              'fixtureProviderTurnCompleted': args.expected_provider_ready,
              'controlledHostClipboardModel': True,
              'physicalOSClipboardVerified': False,
              'selectionClipboard': 'UNVERIFIED'}
    try:
        deadline = time.monotonic() + args.timeout
        gesture_sent_at = None
        selected_clipboard_count = 0
        stable_samples = 0
        last_candidates = None
        while time.monotonic() < deadline:
            if child.poll() is not None:
                raise RuntimeError(f'TUI exited before selection (exit {child.returncode})')
            if select.select([master], [], [], .05)[0]:
                try:
                    chunk = os.read(master, 65536)
                except OSError:
                    break
                output.extend(chunk)
                screen.feed(chunk)
                if b'\x1b[6n' in chunk:
                    os.write(master, b'\x1b[1;1R')
                if b'\x1b[c' in chunk:
                    os.write(master, b'\x1b[?1;2c')
            visible = screen.visible().splitlines()
            candidates = [(row, line[:columns]) for row, line in enumerate(visible, 1)
                          if row <= rows and body_row(line[:columns], args.response)
                          and args.selection in line[:columns]]
            if candidates and gesture_sent_at is None:
                # Use exact rendered body row; wait until it remains stable
                # across multiple reads before dispatching the SGR gesture.
                signature = tuple(candidates)
                if signature == last_candidates:
                    stable_samples += 1
                else:
                    stable_samples = 1
                last_candidates = signature
                if stable_samples < 5:
                    continue
                row, line = candidates[-1]
                start = line.rfind(args.selection) + 1
                end = start + len(args.selection) - 1
                target = line[start - 1:end]
                selected_clipboard_count = len(screen.clipboard_history)
                result['mouseCoordinates'] = {'row': row, 'startColumn': start,
                    'endColumn': end, 'screenLine': line, 'coordinateBasis': '1-based rendered cells'}
                for event in (f'\x1b[<0;{start};{row}M',
                              f'\x1b[<32;{end};{row}M',
                              f'\x1b[<0;{end};{row}m'):
                    os.write(master, event.encode())
                    events.append(event.replace('\x1b', 'ESC'))
                    time.sleep(.12)
                result['selectedSubstring'] = target
                result['gestureEvents'] = events
                result['stableRenderedBodySamples'] = stable_samples
                gesture_sent_at = time.monotonic()
            if gesture_sent_at is not None and time.monotonic() - gesture_sent_at > .5:
                break
        updates = screen.clipboard_history[selected_clipboard_count:]
        readback = screen.query_clipboard() if updates else None
        passed = updates == [args.selection] and readback == args.selection
        if args.retain_state:
            replay = Screen(rows, columns)
            replay.feed(bytes(output))
            replay_lines = replay.visible().splitlines()
            replay_candidates = [(row, line[:columns]) for row, line in enumerate(replay_lines, 1)
                                 if row <= rows and body_row(line[:columns], args.response)
                                 and args.selection in line[:columns]]
            replay_geometry_matches = bool(replay_candidates and 'mouseCoordinates' in result and
                any(row == result['mouseCoordinates']['row'] and
                    line[result['mouseCoordinates']['startColumn'] - 1:result['mouseCoordinates']['endColumn']] == args.selection
                    for row, line in replay_candidates))
        else:
            replay_geometry_matches = None
        passed = passed and replay_geometry_matches is not False
        result.update({'selectionClipboard': 'PASS' if passed else 'UNVERIFIED',
            'controlledHostClipboardUpdates': updates,
            'controlledHostClipboardReadback': readback,
            'physicalOSClipboardVerified': False,
            'fixtureResponseInCapturedPty': args.response.encode() in output,
            'sessionAttachedWithResponseVisible': any(body_row(line, args.response) for line in screen.visible().splitlines()),
            'responseBodyVisible': any(body_row(line, args.response) for line in screen.visible().splitlines()),
            'capturedPtyBytes': len(output),
            'capturedPtySha256': hashlib.sha256(output).hexdigest(),
            'capturedPtyIndependentReplayBodyMatchesGesture': replay_geometry_matches,
            'mouseModesObserved': sorted(set(x.decode() for x in __import__('re').findall(
                rb'\x1b\[\?(1000|1002|1003|1006)h', bytes(output)))),
            'status': 'PASS' if passed else 'INCOMPLETE'})
    finally:
        if child.poll() is None:
            try:
                os.write(master, b'\x03')
                child.wait(timeout=3)
            except (OSError, subprocess.TimeoutExpired):
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
        if args.retain_state:
            directory = Path('/tmp/opencode')
            directory.mkdir(parents=True, exist_ok=True)
            (directory / f'native-terminal-selection-{args.session}.pty').write_bytes(output)
            result['retainedPtyPath'] = str(directory / f'native-terminal-selection-{args.session}.pty')
        os.close(master)
    rendered = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    print(rendered, end='')
    if args.retain_state:
        path = Path('/tmp/opencode') / f'native-terminal-selection-{args.session}.json'
        path.write_text(rendered, encoding='utf8')
        print(f'retained diagnostics: {path}', file=__import__('sys').stderr)
    return 0 if result.get('status') == 'PASS' else 2


if __name__ == '__main__':
    raise SystemExit(main())
