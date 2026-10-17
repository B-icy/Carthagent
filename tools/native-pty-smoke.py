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


def resolve_binary(value):
    """Resolve PATH names before path normalization; otherwise use only the pinned package binary."""
    if value and (os.path.isabs(value) or os.sep in value or (os.altsep and os.altsep in value)):
        candidate = pathlib.Path(value).expanduser().resolve()
        return str(candidate) if candidate.is_file() else None
    if value:
        found = shutil.which(value)
        if found:
            return str(pathlib.Path(found).resolve())
    owned = pathlib.Path(__file__).resolve().parents[1] / 'node_modules/@opencode/cli/bin/opencode.exe'
    if value in (None, '', 'opencode') and owned.is_file():
        return str(owned.resolve())
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', default=os.environ.get('CTG_OPENCODE_BIN') or os.environ.get('OPENCODE_BIN') or 'opencode')
    parser.add_argument('--plugin', default=str(pathlib.Path(__file__).resolve().parents[1] / 'plugins/carthagent'))
    parser.add_argument('--command', default='/ctg-status')
    parser.add_argument('--after-command', action='append', help='Submit another command after expected output; may be repeated')
    parser.add_argument('--after-expect', action='append', help='Expected output for each additional command')
    parser.add_argument('--expect', default='OpenCode 2.0.32')
    parser.add_argument('--expect-color', help='Require a truecolor ANSI RGB sequence after the command, e.g. 230,196,128')
    parser.add_argument('--ready', help='Wait for this marker before typing')
    parser.add_argument('--confirm', action='store_true', help='Press Enter again after selecting slash completion')
    parser.add_argument('--second-enter', action='store_true', help='Send a second Enter after the initial command submission')
    args = parser.parse_args()
    args.binary = resolve_binary(args.binary)
    if not args.binary:
        parser.error('OpenCode binary was not found on PATH or at the owned package path node_modules/@opencode/cli/bin/opencode.exe')
    with tempfile.TemporaryDirectory(prefix='ctg-pty-') as temp:
        root = pathlib.Path(temp)
        for name in ['home', 'project', 'config/opencode', 'data', 'state', 'cache']:
            (root / name).mkdir(parents=True, exist_ok=True)
        (root / 'config/opencode/opencode.json').write_text(json.dumps({
            'plugins': [str(pathlib.Path(args.plugin).resolve())], 'update': 'disable',
        }))
        if args.expect_color:
            provisioner = pathlib.Path(args.plugin).resolve() / 'src/ui/theme-provision.mjs'
            subprocess.run([
                'node', '--input-type=module', '-e',
                "const { provisionDefaultNativeTheme } = await import(process.argv[1]); await provisionDefaultNativeTheme(process.argv[2]);",
                str(provisioner), str(root / 'config/opencode'),
            ], check=True)
        env = {key: os.environ[key] for key in ['PATH', 'LANG', 'LC_ALL'] if key in os.environ}
        env.update({
            'HOME': str(root / 'home'), 'TERM': 'xterm-256color', 'COLORTERM': 'truecolor',
            'XDG_CONFIG_HOME': str(root / 'config'), 'XDG_DATA_HOME': str(root / 'data'),
            'XDG_STATE_HOME': str(root / 'state'), 'XDG_CACHE_HOME': str(root / 'cache'),
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
        submitted = False
        confirmed = False
        after_index = 0
        after_typed_at = None
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
                    output.clear()
                    sent_at = time.monotonic()
                    os.write(master, args.command.encode())
                    sent = True
                if sent and not submitted and after_index == 0 and time.monotonic() - sent_at > 1:
                    os.write(master, b'\r')
                    submitted = True
                if submitted and (args.confirm or args.second_enter) and not confirmed and time.monotonic() - sent_at > 2:
                    os.write(master, b'\r')
                    confirmed = True
                    if args.second_enter:
                        submitted = False
                        sent_at = time.monotonic()
                after_commands = args.after_command or []
                after_expects = args.after_expect or []
                if len(after_commands) != len(after_expects):
                    raise ValueError('--after-command and --after-expect must be supplied in matching counts')
                expected_output = args.expect if after_index == 0 else after_expects[after_index - 1]
                if after_index < len(after_commands) and args.expect.encode() in output and b'/theme' in args.command.encode():
                    try:
                        theme_config = json.loads((root / 'config/opencode/cli.json').read_text())
                    except FileNotFoundError:
                        theme_config = {}
                    if theme_config.get('theme', {}).get('name') == 'carthage':
                        output.clear()
                        os.write(master, after_commands[after_index].encode())
                        after_typed_at = time.monotonic()
                        after_index += 1
                        submitted = False
                        continue
                if submitted and expected_output.encode() in output and after_index < len(after_commands):
                    if args.command.startswith('/theme ') and after_index == 1:
                        theme_config = json.loads((root / 'config/opencode/cli.json').read_text())
                        assert theme_config['theme']['name'] == 'carthage', theme_config
                    output.clear()
                    os.write(master, after_commands[after_index].encode())
                    after_typed_at = time.monotonic()
                    after_index += 1
                    submitted = False
                    continue
                if after_index and not submitted and time.monotonic() - after_typed_at > 1:
                    os.write(master, b'\r')
                    submitted = True
                    sent_at = time.monotonic()
                    output.clear()
                if submitted and expected_output.encode() in output:
                    if b'runtime unavailable' in output or b'No matching commands' in output:
                        raise RuntimeError('Command was unavailable or its RPC failed')
                    if args.expect_color and args.command.startswith('/theme ') and after_index == len(after_commands):
                        theme_config = json.loads((root / 'config/opencode/cli.json').read_text())
                        assert theme_config['theme']['name'] == 'carthage', theme_config
                    if args.expect_color and after_index == len(after_commands):
                        channels = [part.strip() for part in args.expect_color.split(',')]
                        if len(channels) != 3 or any(not part.isdigit() or int(part) > 255 for part in channels):
                            raise ValueError('--expect-color must be an RGB triple such as 242,198,109')
                        ansi = f"\x1b[38;2;{';'.join(channels)}m".encode()
                        if ansi not in output:
                            print(f'Expected rendered foreground color {ansi!r} was not observed; recent raw PTY bytes: {output[-12000:]!r}')
                            raise AssertionError('Rendered accent color did not match the selected native theme')
                    print(json.dumps({'command': args.command, 'observed': expected_output,
                                      'theme': 'carthage' if args.expect_color else None,
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
