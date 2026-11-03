import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createTerminalProgress } from '../lib/opencode/progress.mjs';

test('progress animates, fits the terminal, clears on abort and never writes again', async () => {
  const output = [];
  const controller = new AbortController();
  const progress = createTerminalProgress({ stream: { isTTY: true, columns: 24, write: value => output.push(value) }, env: {}, ascii: true, signal: controller.signal });
  try {
    progress.update('Starting a very long workspace name');
    await delay(200);
    assert.ok(output.length >= 2);
    assert.notEqual(output[0], output[1]);
    for (const frame of output) assert.ok(frame.replace(/\r\x1b\[2K/g, '').length <= 23);
    controller.abort();
    assert.equal(output.at(-1), '\r\x1b[2K');
    const count = output.length;
    progress.update('must not appear');
    await delay(120);
    assert.equal(output.length, count);
  } finally { progress.stop(); }
});

test('redirected, disabled and dumb-terminal progress emits no control sequences or text', () => {
  for (const options of [{ isTTY: false }, { isTTY: true, enabled: false }, { isTTY: true, env: { TERM: 'dumb' } }]) {
    const output = [];
    const progress = createTerminalProgress({ stream: { isTTY: options.isTTY, write: text => output.push(text) }, ...options });
    progress.update('Starting');
    progress.stop();
    assert.deepEqual(output, []);
  }
});

test('reduced motion renders a static stage and strips terminal controls from labels', async () => {
  const output = [];
  const progress = createTerminalProgress({ stream: { isTTY: true, write: text => output.push(text) }, env: { CTG_REDUCED_MOTION: '1' } });
  try {
    progress.update('Installing\npackage\x1b[31m');
    await delay(120);
    assert.equal(output.length, 1);
    assert.match(output[0], /Installing package \[31m/);
  } finally { progress.stop(); }
});
