#!/usr/bin/env python3
"""Exercise a native CTG plugin command in a disposable real terminal host."""
import argparse
import fcntl
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', default=shutil.which('opencode'))
    parser.add_argument('--plugin', default=str(pathlib.Path(__file__).resolve().parents[1] / 'plugins/carthagent'))
    parser.add_argument('--command', default='/ctg-status')
    parser.add_argument('--expect', default='OpenCode 2.0.32')
    parser.add_argument('--capture', help='Save the full raw PTY transcript for diagnosis')
    parser.add_argument('--ready', help='Wait for this plugin-rendered marker before typing')
    parser.add_argument('--confirm', action='store_true', help='Press Enter again to execute a selected slash completion')
    args = parser.parse_args()
    if not args.binary:
        parser.error('OpenCode binary is required')
    args.binary = str(pathlib.Path(args.binary).resolve())
    with tempfile.TemporaryDirectory(prefix='ctg-pty-') as temp:
        root = pathlib.Path(temp)
        for name in ['home', 'project', 'config/opencode', 'data', 'state', 'cache']:
            (root / name).mkdir(parents=True, exist_ok=True)
        (root / 'config/opencode/opencode.json').write_text(json.dumps({
            'plugins': [str(pathlib.Path(args.plugin).resolve())], 'update': 'disable',
        }))
        env = {key: os.environ[key] for key in ['PATH', 'LANG', 'LC_ALL'] if key in os.environ}
        env.update({
            'HOME': str(root / 'home'), 'TERM': 'xterm-256color', 'COLORTERM': 'truecolor',
            'XDG_CONFIG_HOME': str(root / 'config'), 'XDG_DATA_HOME': str(root / 'data'),
            'XDG_STATE_HOME': str(root / 'state'), 'XDG_CACHE_HOME': str(root / 'cache'),
            'OPENCODE_DB': str(root / 'database.sqlite'),
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
        submitted = False
        confirmed = False
        try:
            while time.monotonic() - started < 60:
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
                    output.clear()
                    os.write(master, args.command.encode())
                    sent = True
                    sent_at = time.monotonic()
                if sent and not submitted and time.monotonic() - sent_at > 1:
                    output.clear()
                    os.write(master, b'\r')
                    submitted = True
                if submitted and args.confirm and not confirmed and time.monotonic() - sent_at > 2:
                    os.write(master, b'\r')
                    confirmed = True
                if submitted and args.expect.encode() in output:
                    if b'runtime unavailable' in output or b'No matching commands' in output:
                        raise RuntimeError('Command was unavailable or its RPC failed')
                    print(json.dumps({'command': args.command, 'observed': args.expect,
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
