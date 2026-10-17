import test from 'node:test';
import assert from 'node:assert/strict';
import { runOfflineDemo } from '../lib/opencode/demo.mjs';

test('UI demo service executes the disposable Node tests and reports their real output', async () => {
  const output = [];
  const io = { log: line => output.push(line), error: line => output.push(line) };
  let argv;
  const exitCode = await runOfflineDemo({
    io,
    nodeBinary: '/trusted/node',
    execute: async (command, options) => {
      argv = command;
      assert.equal(options.cwd.includes('carthagent-native-demo-'), true);
      const { runCommand } = await import('../lib/delivery.mjs');
      return runCommand([process.execPath, ...command.slice(1)], options);
    },
  });
  assert.equal(exitCode, 0);
  assert.deepEqual(argv.slice(0, 2), ['/trusted/node', '--test']);
  const text = output.join('\n');
  assert.match(text, /no provider\/API calls/);
  assert.match(text, /Fixture workspace:/);
  assert.match(text, /tests 2|pass 2|# tests 2/i);
  assert.match(text, /verified only inside this disposable demo fixture/);
});

test('native TUI demo selects Node instead of Bun/OpenCode process.execPath by default', async () => {
  let argv;
  await runOfflineDemo({
    io: { log() {}, error() {} },
    execute: async command => { argv = command; return { code: 0, output: '# tests 2\n# pass 2', timedOut: false, cancelled: false }; },
  });
  assert.equal(argv[0], process.versions.bun ? 'node' : process.execPath);
});

test('a launcher-provided trusted Node executable overrides a Bun host runtime', async () => {
  let argv;
  await runOfflineDemo({
    io: { log() {}, error() {} },
    nodeBinary: '/launcher/owned/node',
    execute: async command => { argv = command; return { code: 0, output: '', timedOut: false, cancelled: false }; },
  });
  assert.equal(argv[0], '/launcher/owned/node');
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
