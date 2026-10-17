#!/usr/bin/env python3
"""Paired real-PTY glyph probe. Only known host chrome is normalized/asserted."""
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
import tempfile
import termios
import time

_screen_spec = importlib.util.spec_from_file_location(
    'native_terminal_semantics', Path(__file__).with_name('native-terminal-semantics.py'))
_screen_module = importlib.util.module_from_spec(_screen_spec)
_screen_spec.loader.exec_module(_screen_module)
Screen = _screen_module.Screen


USER_TEXT = 'CTG_USER_TEXT 漢字 café → • − …'
CHROME_PAIRS = [('█▀▀', 'O P E N C O D E')]


def child_environment(root, config, mode, source=None):
    """Allowlist terminal/runtime inputs; never inherit release credentials."""
    source = os.environ if source is None else source
    env = {key: source[key] for key in ('PATH', 'LANG', 'LC_ALL') if key in source}
    env.update({'HOME': str(root / 'home'), 'TERM': 'xterm-256color', 'COLORTERM': 'truecolor',
                'XDG_CONFIG_HOME': str(root / 'config'), 'XDG_DATA_HOME': str(root / 'data'),
                'XDG_STATE_HOME': str(root / 'state'), 'XDG_CACHE_HOME': str(root / 'cache'),
                'OPENCODE_DB': str(root / 'db.sqlite'), 'OPENCODE_CONFIG_DIR': str(config),
                'OPENCODE_CONFIG': str(config / 'opencode.json'),
                'OPENCODE_CONFIG_PROJECT_DISABLE': 'true', 'CTG_TUI_GLYPHS': mode})
    return env


def run_mode(binary, mode, timeout):
    with tempfile.TemporaryDirectory(prefix='ctg-glyph-pty-') as temp:
        root = Path(temp)
        project = root / 'project'
        config = root / 'config' / 'opencode'
        for directory in (project, config, root / 'home', root / 'data', root / 'state', root / 'cache'):
            directory.mkdir(parents=True, exist_ok=True)
        (config / 'opencode.json').write_text(json.dumps({'update': 'disable'}), encoding='utf8')
        env = child_environment(root, config, mode)
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 32, 100, 0, 0))
        child = subprocess.Popen([binary, '--standalone'], cwd=project, env=env,
                                 stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        screen = Screen()
        raw = bytearray()
        started = time.monotonic()
        pasted = False
        home_seen = False
        try:
            while time.monotonic() - started < timeout:
                if child.poll() is not None:
                    raise RuntimeError(f'{mode}: runtime exited {child.returncode}: {screen.visible()[-1200:]}')
                if select.select([master], [], [], .05)[0]:
                    try:
                        chunk = os.read(master, 65536)
                    except OSError:
                        break
                    raw.extend(chunk)
                    screen.feed(chunk)
                    if b'\x1b[6n' in chunk:
                        os.write(master, b'\x1b[1;1R')
                    if b'\x1b[c' in chunk:
                        os.write(master, b'\x1b[?1;2c')
                visible = screen.visible()
                lower = visible.lower()
                if not pasted and ('ask anything' in lower or 'what is the tech' in lower):
                    home_seen = True
                    # Insert but do not submit: this makes arbitrary user text
                    # observable in the genuine composer without contacting a provider.
                    os.write(master, b'\x1b[200~' + USER_TEXT.encode() + b'\x1b[201~')
                    pasted = True
                if pasted and USER_TEXT in screen.visible():
                    break
            visible = screen.visible()
            if not home_seen or not pasted or 'CTG_USER_TEXT' not in visible:
                raise AssertionError(f'{mode}: home/composer user-text marker not observed; screen={visible[-1600:]!r}')
            paint_text = raw.decode('utf8', errors='replace')
            user_components = ['CTG_USER_TEXT', '漢', '字', 'café', '→', '•', '−', '…']
            missing_components = [part for part in user_components if part not in paint_text]
            if missing_components:
                raise AssertionError(f'{mode}: PTY paint stream omitted staged user-text components: {missing_components!r}')
            # The compact Screen model does not calculate wide-cell positions;
            # exclude the composer row containing our unique user marker, not
            # arbitrary Unicode elsewhere on screen, from static-chrome checks.
            lines = visible.splitlines()
            marker_rows = [index for index, line in enumerate(lines) if 'CTG_USER_TEXT' in line]
            user_row_neighborhood = {row + delta for row in marker_rows for delta in (-1, 0, 1)}
            chrome_region = '\n'.join(line for index, line in enumerate(lines) if index not in user_row_neighborhood)
            chrome = {}
            for unicode_token, ascii_token in CHROME_PAIRS:
                chrome[unicode_token] = {'asciiAlternative': ascii_token,
                                         'unicodePresent': unicode_token in chrome_region,
                                         'asciiPresent': ascii_token in chrome_region}
            if mode == 'ascii':
                if '█▀▀' in chrome_region or '▀▀▀' in chrome_region:
                    raise AssertionError(f'ASCII startup logo still contains Unicode block-art chrome; screen={visible[-1200:]!r}')
                if 'OPEN CODE' not in chrome_region and 'O P E N C O D E' not in chrome_region:
                    raise AssertionError(f'ASCII startup logo alternative not observed; screen={visible[-1200:]!r}')
            else:
                if '█▀▀' not in chrome_region:
                    raise AssertionError(f'Unicode startup logo not observed; screen={visible[-1200:]!r}')
            return {'mode': mode, 'homeObserved': home_seen, 'composerMarkerVisible': 'CTG_USER_TEXT' in visible,
                    'userTextComponentsInPtyPaint': user_components,
                    'userText': USER_TEXT, 'hostChrome': chrome, 'screen': visible,
                    'ptyOutputSha256': hashlib.sha256(raw).hexdigest(), 'ptyOutputBytes': len(raw)}
        finally:
            if child.poll() is None:
                os.write(master, b'\x1b')
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
            os.close(master)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True)
    parser.add_argument('--timeout', type=int, default=45)
    parser.add_argument('--artifact')
    args = parser.parse_args()
    modes = [run_mode(args.binary, mode, args.timeout) for mode in ('ascii', 'unicode')]
    result = {'status': 'PASS', 'claim': 'paired actual-TUI PTY rendering; only known static chrome is asserted',
              'provider': 'none; prompt is staged but not submitted', 'physicalClipboardVerified': False,
              'modes': modes}
    text = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    print(text, end='')
    if args.artifact:
        Path(args.artifact).resolve().write_text(text, encoding='utf8')


if __name__ == '__main__':
    main()
