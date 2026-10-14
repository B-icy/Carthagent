import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const requireEngine = createRequire(import.meta.url);
const { createJiti } = requireEngine('jiti');
const jiti = createJiti(import.meta.url, {
  alias: { '@earendil-works/pi-coding-agent': fileURLToPath(new URL('../vendor/agent/index.js', import.meta.url)) },
});
const factory = await jiti.import(fileURLToPath(new URL('../extensions/subscriptions.ts', import.meta.url)), { default: true });

test('subscriptions extension registers both overlays and refreshes them on session_start', async () => {
  const providers = [];
  const hooks = {};
  factory({
    registerProvider(id, config) { providers.push([id, config]); },
    on(name, callback) { hooks[name] = callback; },
  });
  assert.deepEqual(providers.map(([id]) => id), ['anthropic', 'openai-codex']);
  for (const [, config] of providers) assert.equal(typeof config.refreshModels, 'function');

  assert.equal(typeof hooks.session_start, 'function');
  const calls = [];
  await hooks.session_start({}, { modelRegistry: { refresh: options => calls.push(options) } });
  assert.deepEqual(calls, [{ providers: ['anthropic', 'openai-codex'] }]);
});
