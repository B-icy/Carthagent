import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeKeyParser, matchSlash, selectionText } from '../lib/tui/app.mjs';

test('/copy is discoverable in command autocomplete', () => {
  assert.ok(matchSlash('/cop').some(c => c.name === '/copy'));
});

test('bracketed paste survives every byte boundary, Unicode and CRLF', () => {
  const text = 'first\r\n日本語 😀\rlast\n' + 'long text '.repeat(10000);
  const bytes = Buffer.from(`a\x1b[200~${text}\x1b[201~b\r`);
  const keys = [];
  const parse = makeKeyParser(k => keys.push(k));
  for (const byte of bytes) parse(Buffer.from([byte]));
  assert.deepEqual(keys, [
    { key: 'char', ch: 'a' },
    { key: 'paste', text: text.replace(/\r\n?/g, '\n') },
    { key: 'char', ch: 'b' },
    { key: 'enter' },
  ]);
});

test('mixed mouse, plain input and consecutive pastes are all consumed', () => {
  const keys = [];
  const parse = makeKeyParser(k => keys.push(k));
  parse('a\x1b[<0;10;8M\x1b[<32;4;2M\x1b[<0;4;2m\x1b[200~one\x1b[201~\x1b[200~two\x1b[201~');
  assert.deepEqual(keys.map(k => k.key), ['char', 'mousedown', 'mousedrag', 'mouseup', 'paste', 'paste']);
  assert.deepEqual(keys.slice(-2).map(k => k.text), ['one', 'two']);
});

test('split paste end marker never leaks into pasted text', () => {
  for (let split = 1; split < 6; split++) {
    const keys = [];
    const parse = makeKeyParser(k => keys.push(k));
    parse('\x1b[200~content' + '\x1b[201~'.slice(0, split));
    parse('\x1b[201~'.slice(split));
    assert.deepEqual(keys, [{ key: 'paste', text: 'content' }]);
  }
});

test('upward and downward selections copy identical text and preserve Unicode', () => {
  const lines = ['hello', '日本語 😀', 'last line'];
  const forward = { ax: 2, ay: 1, bx: 4, by: 3 };
  const reverse = { ax: 4, ay: 3, bx: 2, by: 1 };
  assert.equal(selectionText(lines, forward, 20), 'ello\n日本語 😀\nlast');
  assert.equal(selectionText(lines, reverse, 20), selectionText(lines, forward, 20));
});

test('logical selection includes offscreen rows without truncation', () => {
  const lines = Array.from({ length: 1000 }, (_, i) => `${i}: ${'x'.repeat(80)}`);
  const text = selectionText(lines, { ax: 90, ay: 1000, bx: 1, by: 1 }, 90);
  assert.equal(text, lines.join('\n'));
  assert.ok(Buffer.byteLength(text) > 50000);
});
