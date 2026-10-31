import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createJiti } = require('jiti');
const jiti = createJiti(import.meta.url);
const { runModelCommand } = await jiti.import('../plugins/carthagent/src/ui/model-command.ts');

const ship = { providerID: 'experiential-labs', modelID: 'deepseek-v4.1-flash', id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' };
const other = { providerID: 'demo', modelID: 'alpha', id: 'alpha', name: 'Alpha' };

function host(overrides = {}) {
  const calls = { native: [], switched: [], selects: [], toasts: [], syncs: 0 };
  return {
    calls,
    value: {
      sync: async () => { calls.syncs++; },
      list: () => [ship, other],
      select: async (options) => { calls.selects.push(options.map((option) => option.title)); return options[0]?.value; },
      switchModel: async (sessionID, model) => { calls.switched.push({ sessionID, model }); },
      openNativePicker: (query) => { calls.native.push(query); },
      providerName: (id) => (id === 'experiential-labs' ? 'Carthagent Ship' : id),
      toast: (message, variant) => { calls.toasts.push({ message, variant }); },
      ...overrides,
    },
  };
}

test('pre-session /model opens the native configured-model picker with its argument and never switches a session', async () => {
  const bare = host();
  await runModelCommand(bare.value, { arg: '' });
  assert.deepEqual(bare.calls.native, ['']);
  const named = host();
  await runModelCommand(named.value, { arg: 'deepseek' });
  assert.deepEqual(named.calls.native, ['deepseek']);
  for (const run of [bare, named]) {
    assert.deepEqual(run.calls.switched, []);
    assert.deepEqual(run.calls.selects, []);
    assert.equal(run.calls.toasts.some((toast) => /Open or create a session/.test(toast.message)), false);
  }
});

test('existing-session /model keeps filtering by argument and commits the pick to that session only', async () => {
  const run = host();
  await runModelCommand(run.value, { sessionID: 'ses_existing', arg: 'deepseek' });
  assert.equal(run.calls.syncs, 1);
  assert.deepEqual(run.calls.selects, [['Carthagent Ship/deepseek-v4.1-flash']]);
  assert.deepEqual(run.calls.switched, [{ sessionID: 'ses_existing', model: { providerID: 'experiential-labs', id: 'deepseek-v4.1-flash' } }]);
  assert.deepEqual(run.calls.native, []);
  assert.deepEqual(run.calls.toasts, [{ message: 'Selected Carthagent Ship/deepseek-v4.1-flash.', variant: 'success' }]);
});

test('cancelling the existing-session picker changes nothing', async () => {
  const run = host({ select: async () => undefined });
  await runModelCommand(run.value, { sessionID: 'ses_existing', arg: '' });
  assert.deepEqual(run.calls.switched, []);
  assert.deepEqual(run.calls.toasts, []);
});

test('plugin /model dispatch routes through the shared command and the native model.list command', async () => {
  const tui = await readFile(new URL('../plugins/carthagent/src/tui.tsx', import.meta.url), 'utf8');
  assert.match(tui, /runModelCommand\(/);
  assert.match(tui, /keymap\.dispatch\("model\.list", query\)/);
  assert.doesNotMatch(tui, /Open or create a session before selecting its model/);
});
