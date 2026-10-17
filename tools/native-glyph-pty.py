#!/usr/bin/env python3
"""Paired real-PTY glyph probe. Only known host chrome is normalized/asserted."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pty
import re
import select
import signal
import struct
import subprocess
import tempfile
import termios
import time

from native_glyph_helpers import CHROME_PAIRS, USER_TEXT, GlyphScreen, assert_composer_payload, child_environment


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
        screen = GlyphScreen()
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
                if pasted and any(re.fullmatch(r'\s*[┃|]\s*' + re.escape(USER_TEXT) + r'\s*', row)
                                  for row in screen.visible().splitlines()):
                    break
            visible = screen.visible()
            if not home_seen or not pasted:
                raise AssertionError(f'{mode}: home/composer was not reached; screen={visible[-1600:]!r}')
            composer_row = assert_composer_payload(visible)
            # Exclude the rendered composer row from static chrome checks.
            lines = visible.splitlines()
            marker_rows = [index for index, line in enumerate(lines) if USER_TEXT in line]
            chrome_region = '\n'.join(line for index, line in enumerate(lines) if index not in marker_rows)
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
            return {'mode': mode, 'homeObserved': home_seen, 'composerPayloadExact': True,
                    'composerRow': composer_row,
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
