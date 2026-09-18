import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickerKey, commitPicker } from '../lib/tui/picker.mjs';
import { makeKeyParser } from '../lib/tui/app.mjs';

test('picker keyboard navigation never commits until Enter and Escape cancels', () => {
  const p = { sel: 0 };
  const actions = [];
  const parse = makeKeyParser(k => actions.push(pickerKey(p, k.key, 20)));
  parse(Buffer.from('\x1b[B\x1b[B\r'));
  assert.equal(p.sel, 2);
  assert.deepEqual(actions, ['browse', 'browse', 'commit']);
  assert.equal(pickerKey(p, 'esc', 20), 'cancel');
  assert.equal(pickerKey(p, 'enter', 0), 'browse');
});

test('picker serializes pending commits and retains failures for retry', async () => {
  const p = { sel: 0 };
  let resolve, calls = 0, closed = 0;
  const action = () => { calls++; return new Promise(r => { resolve = r; }); };
  const first = commitPicker(p, action, () => closed++);
  assert.equal(pickerKey(p, 'enter', 2), 'pending');
  await commitPicker(p, action, () => closed++);
  assert.equal(calls, 1);
  resolve(); await first;
  assert.equal(closed, 1);
  await commitPicker(p, async () => { throw Error('Cannot switch'); }, () => closed++);
  assert.equal(p.error, 'Cannot switch');
  assert.equal(p.pending, false);
  assert.equal(closed, 1);
  await commitPicker(p, async () => {}, () => closed++);
  assert.equal(p.error, '');
  assert.equal(closed, 2);
});
