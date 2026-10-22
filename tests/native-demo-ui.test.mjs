import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { runOfflineDemo } from '../lib/opencode/demo.mjs';

test('UI demo service executes the disposable Node tests and reports their real output', async () => {
  const output = [];
  const io = { log: line => output.push(line), error: line => output.push(line) };
  let invocation;
  const exitCode = await runOfflineDemo({
    io,
    execute: async (argv, options) => {
      invocation = { argv, options };
      return { code: 0, output: 'ℹ tests 2\nℹ pass 2', timedOut: false, cancelled: false };
    },
  });
  assert.equal(exitCode, 0);
  assert.equal(invocation.argv[0], process.execPath);
  assert.deepEqual(invocation.argv.slice(1), ['--test', 'test/app.test.mjs']);
  assert.equal(invocation.options.timeoutSeconds, 30);
  assert.equal(dirname(resolve(invocation.options.cwd)), resolve(os.tmpdir()));
  assert.equal(basename(invocation.options.cwd).startsWith('carthagent-native-demo-'), true);
  assert.notEqual(resolve(invocation.options.cwd), resolve(process.cwd()), 'fixture runs in a disposable sandbox, not the repository');
  assert.equal('signal' in invocation.options, true);
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
