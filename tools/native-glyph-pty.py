#!/usr/bin/env python3
"""Paired real-PTY glyph probe. Only known host chrome is normalized/asserted."""
import argparse
import codecs
import fcntl
import hashlib
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
import tempfile
import termios
import time
import unicodedata

_screen_spec = importlib.util.spec_from_file_location(
    'native_terminal_semantics', Path(__file__).with_name('native-terminal-semantics.py'))
_screen_module = importlib.util.module_from_spec(_screen_spec)
_screen_spec.loader.exec_module(_screen_module)
Screen = _screen_module.Screen


USER_MARKER = 'CTG_GLYPH_PAYLOAD'
USER_TEXT = USER_MARKER + ' 漢字 café → • − …'
CHROME_PAIRS = [('█▀▀', 'O P E N C O D E')]


class GlyphScreen(Screen):
    """PTY screen model with Unicode cell widths, local to this acceptance probe."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.decoder = codecs.getincrementaldecoder('utf8')('replace')

    @staticmethod
    def char_width(char):
        if unicodedata.combining(char):
            return 0
        return 2 if unicodedata.east_asian_width(char) in ('W', 'F') else 1

    def feed(self, data):
        for char in self.decoder.decode(data):
            if self.mode == 'osc':
                if char == '\x07' or (self.osc_escape and char == '\\'):
                    self._osc(self.osc)
                    self.osc = ''
                    self.mode = 'text'
                elif char != '\x1b':
                    self.osc += char
                self.osc_escape = char == '\x1b'
                continue
            if self.mode == 'csi':
                if '@' <= char <= '~':
                    if char == 't':
                        self.csi_sequences.append((self.csi, char))
                    self._csi(char, self.csi)
                    self.mode, self.csi = 'text', ''
                else:
                    self.csi += char
                continue
            if self.mode == 'esc':
                if char == '[':
                    self.mode, self.csi = 'csi', ''
                elif char == ']':
                    self.mode = 'osc'
                else:
                    self.mode = 'text'
                continue
            if char == '\x1b':
                self.mode = 'esc'
            elif char == '\r':
                self.x = 0
            elif char == '\n':
                self.y = min(self.y + 1, self.rows - 1)
            elif char == '\b':
                self.x = max(0, self.x - 1)
            elif char >= ' ':
                width = self.char_width(char)
                if width == 0:
                    if self.x > 0:
                        previous = min(self.columns - 1, self.x - 1)
                        while previous > 0 and self.cells[self.y][previous] == '':
                            previous -= 1
                        self.cells[self.y][previous] += char
                    continue
                if self.x + width > self.columns:
                    self.wrapCount += 1
                    self.x, self.y = 0, min(self.y + 1, self.rows - 1)
                self.cells[self.y][self.x] = char
                if width == 2 and self.x + 1 < self.columns:
                    self.cells[self.y][self.x + 1] = ''
                self.x += width

    def visible(self):
        return '\n'.join(''.join(row).rstrip() for row in self.cells)


def assert_composer_payload(screen_text, expected=USER_TEXT):
    """Require the complete ordered payload on the actual marker-bearing composer row."""
    pattern = re.compile(r'^\s*[┃|]\s*' + re.escape(expected) + r'\s*$')
    rows = [row for row in screen_text.splitlines() if pattern.fullmatch(row)]
    if not rows:
        raise AssertionError('exact staged user payload is not preserved in the rendered composer row')
    return rows[0]


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
