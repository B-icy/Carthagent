import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipboardCommands, sanitizePaste } from '../lib/tui/clipboard.mjs';

test('clipboardCommands picks the platform clipboard tool', () => {
  assert.deepEqual(clipboardCommands('darwin', {}), [['pbpaste', []]]);
  assert.equal(clipboardCommands('win32', {})[0][0], 'powershell.exe');
  const linux = clipboardCommands('linux', {});
  assert.deepEqual(linux.map(c => c[0]), ['wl-paste', 'xclip', 'xsel']);
});

test('clipboardCommands adds PowerShell for WSL', () => {
  const wsl = clipboardCommands('linux', { WSL_DISTRO_NAME: 'Ubuntu' });
  assert.equal(wsl.at(-1)[0], 'powershell.exe');
  const notWsl = clipboardCommands('linux', {});
  assert.ok(!notWsl.some(c => c[0] === 'powershell.exe'));
});

test('sanitizePaste strips whitespace and control bytes for single-line fields', () => {
  assert.equal(sanitizePaste('  sk-abc\n\n'), 'sk-abc');
  assert.equal(sanitizePaste('sk-abc\r\ndef'), 'sk-abcdef');
  assert.equal(sanitizePaste('a\tb c'), 'abc');
  assert.equal(sanitizePaste('code\u0007\u001b'), 'code');
  assert.equal(sanitizePaste(null), '');
  assert.equal(sanitizePaste(undefined), '');
});

test('sanitizePaste keeps newlines but drops control junk in multiline mode', () => {
  assert.equal(sanitizePaste('line1\r\nline2', { multiline: true }), 'line1\nline2');
  assert.equal(sanitizePaste('a\u0007b', { multiline: true }), 'ab');
  assert.equal(sanitizePaste('  keep spaces  ', { multiline: true }), '  keep spaces  ');
});
