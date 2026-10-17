import test from 'node:test';
import assert from 'node:assert/strict';
import { runOfflineDemo } from '../lib/opencode/demo.mjs';

test('UI demo service executes the disposable Node tests and reports their real output', async () => {
  const output = [];
  const io = { log: line => output.push(line), error: line => output.push(line) };
  const exitCode = await runOfflineDemo({ io });
  assert.equal(exitCode, 0);
  const text = output.join('\n');
  assert.match(text, /no provider\/API calls/);
  assert.match(text, /Fixture workspace:/);
  assert.match(text, /tests 2|pass 2|# tests 2/i);
  assert.match(text, /verified only inside this disposable demo fixture/);
});

test('UI demo service forwards cancellation and never claims a cancelled fixture passed', async () => {
  const controller = new AbortController();
  const output = [];
  const exitCode = await runOfflineDemo({
    io: { log: line => output.push(line), error: line => output.push(line) },
    signal: controller.signal,
    execute: async (_argv, options) => {
      assert.equal(options.signal, controller.signal);
      controller.abort(new Error('demo cancelled'));
      return { code: null, output: '', timedOut: false, cancelled: true };
    },
  });
  assert.equal(exitCode, 130);
  assert.match(output.join('\n'), /cancelled; no completion is claimed/);
  assert.doesNotMatch(output.join('\n'), /Verification: isolated Node test suite passed/);
});
