import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModelLoader, modelSupportsThinking } from '../lib/tui/models.mjs';
import { catalogModels } from '../lib/providers/model-catalog.mjs';
import { anthropicDiscoveryProviderConfig, registerSubscriptionProviders } from '../lib/providers/subscription-models.mjs';
import { ModelRuntime } from '../vendor/agent/index.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('picker reads past the startup snapshot and thinking sees delayed discovery', async () => {
  let models = [{ provider: 'anthropic', id: 'claude-opus-5' }];
  let calls = 0;
  const state = {};
  const load = createModelLoader({ async send() { calls++; return { models }; } }, state);
  await Promise.all([load(), load()]);
  assert.equal(calls, 1);
  models = [...models, { provider: 'anthropic', id: 'claude-opus-5-5', reasoning: true }];
  const refreshed = await load();
  assert.equal(calls, 2);
  assert.equal(refreshed.at(-1).full, 'anthropic/claude-opus-5-5');
  assert.ok(modelSupportsThinking(state.modelList.at(-1)));
});

test('model loader preserves last good list on RPC failure but accepts an empty registry', async () => {
  let response = { models: [{ provider: 'anthropic', id: 'a' }] };
  const state = {};
  const load = createModelLoader({ async send() { if (response instanceof Error) throw response; return response; } }, state);
  const first = await load();
  response = new Error('restarting');
  assert.deepEqual(await load(), first);
  response = { models: [] };
  assert.deepEqual(await load(), []);
});

test('owned catalog supplies Opus 5.5 limits without a pi catalog', async () => {
  const opus = catalogModels('anthropic').find(model => model.id === 'claude-opus-5-5');
  assert.equal(opus.contextWindow, 1_000_000);
  assert.equal(opus.maxTokens, 128_000);
  assert.ok(opus.reasoning);
  const config = anthropicDiscoveryProviderConfig({ fetchImpl: async () => Response.json({ data: [{ id: opus.id }] }) });
  const models = await config.refreshModels({ allowNetwork: true, credential: { type: 'api_key', key: 'test' }, signal: new AbortController().signal, stored: { models: [{ id: opus.id, contextWindow: 200_000, maxTokens: 64_000 }] } });
  assert.equal(models[0].contextWindow, opus.contextWindow);
});

test('real runtime refresh uses provider discovery, never pi.dev, including non-overlay providers', async () => {
  const previous = globalThis.fetch;
  const calls = [];
  const dir = await mkdtemp(join(tmpdir(), 'ctg-registry-'));
  globalThis.fetch = async url => { calls.push(String(url)); throw new Error(`Unexpected fetch: ${url}`); };
  try {
    const runtime = await ModelRuntime.create({ authPath: join(dir, 'auth.json'), modelsPath: null, refreshOnCreate: false });
    registerSubscriptionProviders(runtime, { fetchImpl: async url => {
      calls.push(String(url));
      return Response.json({ data: [{ id: 'claude-opus-5-5' }] });
    } });
    await runtime.setRuntimeApiKey('anthropic', 'test');
    await runtime.refresh({ allowNetwork: false });
    assert.equal(runtime.getModels('anthropic').find(model => model.id === 'claude-opus-5-5').contextWindow, 1_000_000);
    await runtime.refresh({ allowNetwork: true });
    assert.ok(calls.some(url => url.startsWith('https://api.anthropic.com/v1/models')));
    assert.ok(calls.every(url => !url.includes('pi.dev')), calls.join('\n'));
    assert.ok(runtime.getModels('anthropic').some(model => model.id === 'claude-opus-5-5'));
  } finally {
    globalThis.fetch = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
