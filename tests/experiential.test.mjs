import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPERIENTIAL_API_KEY_ENV,
  EXPERIENTIAL_PROVIDER_ID,
  cloudGatewayUrl,
  cloudOAuth,
  createCloudOperationIdentity,
  experientialBaseUrl,
  isCloudAccessToken,
  managedCloudRequestOptions,
  experientialProviderConfig,
  parseExperientialModels,
  registerExperientialProvider,
} from '../lib/providers/experiential.mjs';

test('Experiential provider uses the hosted gateway and canonical environment variable', () => {
  assert.equal(EXPERIENTIAL_PROVIDER_ID, 'experiential-labs');
  assert.equal(EXPERIENTIAL_API_KEY_ENV, 'EXPLABS_API_KEY');
  assert.equal(experientialBaseUrl({}), 'https://api.experientiallabs.ai/v1');
  assert.equal(experientialBaseUrl({ EXP_GATEWAY_URL: ' https://preview.test/v1/ ' }), 'https://preview.test/v1');
  assert.equal(experientialBaseUrl({ CARTHAGENT_CLOUD_URL: ' https://control-plane.test/ ' }), 'https://api.experientiallabs.ai/v1');
  assert.equal(cloudGatewayUrl({ CARTHAGENT_CLOUD_URL: ' https://control-plane.test/v1/ ' }), 'https://control-plane.test/v1');
  const access = ['header', Buffer.from(JSON.stringify({ sub: 'account', sid: 'session', scope: 'models:read gateway:invoke' })).toString('base64url'), 'signature'].join('.');
  assert.equal(isCloudAccessToken(access), true);
  assert.equal(isCloudAccessToken('direct-test-key'), false);
  const config = experientialProviderConfig({ env: {} });
  assert.equal(config.apiKey, '$EXPLABS_API_KEY');
  assert.equal(config.authHeader, true);
  assert.equal(config.api, 'openai-completions');
  assert.equal(typeof config.streamSimple, 'function');
  assert.equal(config.oauth.name, 'Carthagent Cloud account');
});

test('Managed Cloud operations share one identity across metadata, HTTP headers, and SDK retries', async () => {
  let ids = 0;
  const payloads = [];
  const options = managedCloudRequestOptions({
    requestHeaders: { 'X-Test': 'preserved' },
    onPayload: async payload => {
      payloads.push(payload);
      return { ...payload, metadata: { inherited: 'yes' } };
    },
  }, () => `operation-${++ids}`);

  assert.equal(ids, 1);
  assert.deepEqual(options.requestHeaders, {
    'X-Test': 'preserved',
    'Idempotency-Key': 'operation-1',
    'X-Client-Request-Id': 'operation-1',
  });
  const body = await options.onPayload({ model: 'carthagent-code', messages: [] }, { id: 'carthagent-code' });
  assert.equal(payloads.length, 1);
  assert.deepEqual(body.metadata, { inherited: 'yes', operation_key: 'operation-1' });

  // The OpenAI SDK receives the same immutable request options object on every
  // retry; creating a later operation is the only thing that advances the ID.
  assert.equal(options.requestHeaders['Idempotency-Key'], 'operation-1');
  assert.equal(createCloudOperationIdentity(() => `operation-${++ids}`), 'operation-2');
  assert.throws(() => createCloudOperationIdentity(() => ''), /identity is invalid/);
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

test('Experiential model discovery authenticates with API-key or OAuth credentials without logging them', async () => {
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
  await config.refreshModels({ allowNetwork: true, credential: { type: 'oauth', access: 'managed-test-access' }, signal: new AbortController().signal });
  assert.equal(requests[1].url, 'https://api.carthagent.xyz/v1/models');
  assert.equal(requests[1].options.headers.Authorization, 'Bearer managed-test-access');
});

test('Carthagent Cloud OAuth uses device authorization and rotating refresh tokens', async () => {
  const calls = [];
  let polls = 0;
  const opened = [];
  const oauth = cloudOAuth({
    env: { CARTHAGENT_CLOUD_URL: 'https://cloud.test' }, now: () => 1_000, sleep: async () => {}, openBrowserImpl: async url => { opened.push(url); return true; },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/v1/device/authorizations')) return new Response(JSON.stringify({ deviceCode: 'd', userCode: 'CODE', verificationUri: 'https://verify', expiresIn: 600, interval: 1 }), { status: 201 });
      if (url.endsWith('/v1/device/token')) {
        polls++;
        return polls === 1 ? new Response(JSON.stringify({ error: 'authorization_pending' }), { status: 428 })
          : new Response(JSON.stringify({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 }), { status: 200 });
      }
      return new Response(JSON.stringify({ accessToken: 'next-access', refreshToken: 'next-refresh', expiresIn: 900 }), { status: 200 });
    },
  });
  const codes = [];
  const credential = await oauth.login({ signal: new AbortController().signal, onDeviceCode: value => codes.push(value), onAuth: () => {}, onProgress: () => {} });
  assert.deepEqual(credential, { access: 'access', refresh: 'refresh', expires: 901_000 });
  assert.equal(codes[0].userCode, 'CODE');
  assert.deepEqual(opened, ['https://verify']);
  const refreshed = await oauth.refreshToken(credential, new AbortController().signal);
  assert.deepEqual(refreshed, { access: 'next-access', refresh: 'next-refresh', expires: 901_000 });
  assert.equal(oauth.getApiKey(refreshed), 'next-access');
  assert.ok(calls.some(call => call.url === 'https://cloud.test/v1/token/refresh'));
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
