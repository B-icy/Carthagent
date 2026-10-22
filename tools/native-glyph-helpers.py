"""Portable glyph PTY screen and assertion helpers; no OS PTY dependencies."""
import codecs
import os
import re
import unicodedata
from pathlib import Path


USER_MARKER = 'CTG_GLYPH_PAYLOAD'
USER_TEXT = USER_MARKER + ' 漢字 café → • − …'
CHROME_PAIRS = [('▄▀▀▀ ▄▀▀▄', 'C A R T H')]


class GlyphScreen:
    """Small VT screen used by glyph acceptance, with Unicode cell widths."""

    def __init__(self, rows=32, columns=100):
        self.rows, self.columns = rows, columns
        self.cells = [[' '] * columns for _ in range(rows)]
        self.x = self.y = 0
        self.mode = 'text'
        self.csi = ''
        self.osc = ''
        self.osc_escape = False
        self.title_updates = []
        self.decoder = codecs.getincrementaldecoder('utf8')('replace')
        self.wrapCount = 0

    @staticmethod
    def char_width(char):
        if unicodedata.combining(char):
            return 0
        return 2 if unicodedata.east_asian_width(char) in ('W', 'F') else 1

    def feed(self, data):
        for char in self.decoder.decode(data):
            if self.mode == 'osc':
                if char == '\x07' or (self.osc_escape and char == '\\'):
                    command, _, title = self.osc.partition(';')
                    if command in ('0', '2'):
                        self.title_updates.append(title)
                    self.osc = ''
                    self.mode = 'text'
                elif char != '\x1b':
                    self.osc += char
                self.osc_escape = char == '\x1b'
                continue
            if self.mode == 'csi':
                if '@' <= char <= '~':
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

    def _csi(self, final, params):
        values = [int(value) if value.isdigit() else 0 for value in params.lstrip('?').split(';')]
        n = values[0] if values and values[0] else 1
        if final in ('H', 'f'):
            self.y = max(0, min(self.rows - 1, (values[0] if values and values[0] else 1) - 1))
            self.x = max(0, min(self.columns - 1, (values[1] if len(values) > 1 and values[1] else 1) - 1))
        elif final == 'A': self.y = max(0, self.y - n)
        elif final == 'B': self.y = min(self.rows - 1, self.y + n)
        elif final == 'C': self.x = min(self.columns - 1, self.x + n)
        elif final == 'D': self.x = max(0, self.x - n)
        elif final == 'K': self.cells[self.y][self.x:] = [' '] * (self.columns - self.x)
        elif final == 'J' and values and values[0] == 2:
            self.cells = [[' '] * self.columns for _ in range(self.rows)]
            self.x = self.y = 0

    def visible(self):
        return '\n'.join(''.join(row).rstrip() for row in self.cells)


def assert_composer_payload(screen_text, expected=USER_TEXT):
    """Require the complete ordered payload on a rendered prompt row."""
    pattern = re.compile(r'^\s*[┃|]\s*' + re.escape(expected) + r'\s*$')
    rows = [row for row in screen_text.splitlines() if pattern.fullmatch(row)]
    if not rows:
        raise AssertionError('exact staged user payload is not preserved in the rendered composer row')
    return rows[0]


def child_environment(root, config, mode, source=None):
    """Build a portable allowlisted child environment, excluding release secrets."""
    source = source if source is not None else os.environ
    root, config = Path(root), Path(config)
    env = {key: source[key] for key in ('PATH', 'LANG', 'LC_ALL') if key in source}
    env.update({'HOME': str(root / 'home'), 'TERM': 'xterm-256color', 'COLORTERM': 'truecolor',
                'XDG_CONFIG_HOME': str(root / 'config'), 'XDG_DATA_HOME': str(root / 'data'),
                'XDG_STATE_HOME': str(root / 'state'), 'XDG_CACHE_HOME': str(root / 'cache'),
                'OPENCODE_DB': str(root / 'db.sqlite'), 'OPENCODE_CONFIG_DIR': str(config),
                'OPENCODE_CONFIG': str(config / 'opencode.json'),
                'OPENCODE_CONFIG_PROJECT_DISABLE': 'true', 'CTG_TUI_GLYPHS': mode})
    return env
