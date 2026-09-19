import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPERIENTIAL_API_KEY_ENV,
  EXPERIENTIAL_PROVIDER_ID,
  experientialBaseUrl,
  experientialProviderConfig,
  parseExperientialModels,
  registerExperientialProvider,
} from '../lib/providers/experiential.mjs';

test('Experiential provider uses the hosted gateway and canonical environment variable', () => {
  assert.equal(EXPERIENTIAL_PROVIDER_ID, 'experiential-labs');
  assert.equal(EXPERIENTIAL_API_KEY_ENV, 'EXPLABS_API_KEY');
  assert.equal(experientialBaseUrl({}), 'https://api.experientiallabs.ai/v1');
  assert.equal(experientialBaseUrl({ EXP_GATEWAY_URL: ' https://preview.test/v1/ ' }), 'https://preview.test/v1');
  const config = experientialProviderConfig({ env: {} });
  assert.equal(config.apiKey, '$EXPLABS_API_KEY');
  assert.equal(config.authHeader, true);
  assert.equal(config.api, 'openai-completions');
});

test('Experiential model parsing is identity-only, sorted, and deduplicated', () => {
  const models = parseExperientialModels({ data: [
    { id: 'z-model', name: 'Zed' },
    { id: 'a-model' },
    { id: 'z-model', name: 'Duplicate' },
    { nope: true },
  ] });
  assert.deepEqual(models, [
    { id: 'a-model', name: 'a-model' },
    { id: 'z-model', name: 'Zed' },
  ]);
});

test('Experiential model discovery authenticates with the credential without logging or persisting it', async () => {
  const requests = [];
  const config = experientialProviderConfig({
    env: { EXP_GATEWAY_URL: 'https://preview.test/v1' },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ data: [{ id: 'coding' }] }) };
    },
  });
  const models = await config.refreshModels({
    allowNetwork: true,
    credential: { type: 'api_key', key: 'test-secret' },
    signal: new AbortController().signal,
  });
  assert.deepEqual(models.map(model => model.id), ['coding']);
  assert.equal(requests[0].url, 'https://preview.test/v1/models');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test-secret');
  assert.doesNotMatch(JSON.stringify(config), /test-secret/);
});

test('Experiential discovery reuses stored identities offline and fails clearly online', async () => {
  const stored = [{ id: 'stored-model' }];
  const offline = experientialProviderConfig({ fetchImpl: () => { throw new Error('network called'); } });
  assert.equal((await offline.refreshModels({ allowNetwork: false, stored })).at(0).id, 'stored-model');

  const failing = experientialProviderConfig({ fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'unauthorized' }) });
  await assert.rejects(
    failing.refreshModels({ allowNetwork: true, credential: { type: 'api_key', key: 'xpl_bad' }, signal: new AbortController().signal }),
    /failed \(401\): unauthorized/
  );
});

test('registerExperientialProvider registers one shared provider definition', () => {
  const calls = [];
  const runtime = { registerProvider: (id, config) => calls.push({ id, config }) };
  assert.equal(registerExperientialProvider(runtime), runtime);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 'experiential-labs');
  assert.equal(calls[0].config.name, 'Carthagent Cloud');
});

test('ModelRuntime resolves EXPLABS_API_KEY without copying it into provider config', async () => {
  const previous = process.env.EXPLABS_API_KEY;
  const previousCarthagentDir = process.env.CARTHAGENT_CODING_AGENT_DIR;
  const previousPiDir = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.EXPLABS_API_KEY = 'environment-only-test-key';
    process.env.CARTHAGENT_CODING_AGENT_DIR = '/tmp/carthagent-experiential-env-test';
    process.env.PI_CODING_AGENT_DIR = process.env.CARTHAGENT_CODING_AGENT_DIR;
    const { ModelRuntime } = await import('../vendor/agent/index.js');
    const runtime = await ModelRuntime.create({ allowModelNetwork: false });
    registerExperientialProvider(runtime, { env: process.env });
    assert.deepEqual(runtime.getProviderAuthStatus('experiential-labs'), {
      configured: true,
      source: 'environment',
      label: 'EXPLABS_API_KEY',
    });
    assert.equal(runtime.getRegisteredProviderConfig('experiential-labs').apiKey, '$EXPLABS_API_KEY');
  } finally {
    if (previous === undefined) delete process.env.EXPLABS_API_KEY; else process.env.EXPLABS_API_KEY = previous;
    if (previousCarthagentDir === undefined) delete process.env.CARTHAGENT_CODING_AGENT_DIR; else process.env.CARTHAGENT_CODING_AGENT_DIR = previousCarthagentDir;
    if (previousPiDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousPiDir;
  }
});
