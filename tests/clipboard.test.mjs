import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipboardCommands, clipboardWriteCommands, sanitizePaste, writeClipboard } from '../lib/tui/clipboard.mjs';

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

test('clipboardWriteCommands picks the platform clipboard tool', () => {
  assert.deepEqual(clipboardWriteCommands('darwin', {}), [['pbcopy', []]]);
  const win32 = clipboardWriteCommands('win32', {});
  assert.deepEqual(win32.map(c => c[0]), ['powershell.exe']);
  const linux = clipboardWriteCommands('linux', {});
  assert.deepEqual(linux.map(c => c[0]), ['wl-copy', 'xclip', 'xsel']);
});

test('clipboardWriteCommands adds PowerShell for WSL', () => {
  const wsl = clipboardWriteCommands('linux', { WSL_DISTRO_NAME: 'Ubuntu' });
  assert.equal(wsl.at(-1)[0], 'powershell.exe');
  const notWsl = clipboardWriteCommands('linux', {});
  assert.ok(!notWsl.some(c => c[0] === 'clip.exe' || c[0] === 'powershell.exe'));
});

test('writeClipboard resolves safely when tools are absent', async () => {
  // On Linux test runner without display/tools or non-existent platform, writeClipboard resolves false without rejecting
  const res = await writeClipboard('test text', { platform: 'unknown-platform' });
  assert.equal(res, false);
});

test('writeClipboard pipes text to child stdin and resolves true', async () => {
  // Test piping using node command
  const res = await writeClipboard('hello from carthagent', {
    commands: [[process.execPath, ['-e', 'process.stdin.resume(); process.stdin.on("data", () => process.exit(0))']]],
  });
  assert.equal(res, true);
});

test('Windows and WSL clipboard routes declare Unicode encodings', () => {
  for (const [platform, env] of [['win32', {}], ['linux', { WSL_INTEROP: 'yes' }]]) {
    const commands = clipboardWriteCommands(platform, env);
    assert.ok(!commands.some(c => c[0] === 'clip.exe'));
    assert.match(commands.find(c => c[0] === 'powershell.exe')[1].at(-1), /InputEncoding.*UTF8Encoding/);
    assert.match(clipboardCommands(platform, env).find(c => c[0] === 'powershell.exe')[1].at(-1), /OutputEncoding.*UTF8Encoding/);
  }
});

test('clipboard subprocess receives exact UTF-8 Unicode bytes without BOM', async () => {
  const text = '● MESSAGES │ café ✓\n┬ · 日本語 😀';
  {
    const expected = Buffer.from(text, 'utf8').toString('hex');
    const script = 'const chunks=[]; process.stdin.on("data", c=>chunks.push(c)); process.stdin.on("end",()=>{process.exitCode=Buffer.concat(chunks).toString("hex")===process.argv[1]?0:1;});';
    assert.equal(await writeClipboard(text, { commands: [[process.execPath, ['-e', script, expected]]] }), true);
  }
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
