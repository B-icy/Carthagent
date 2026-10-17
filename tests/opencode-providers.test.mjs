import test from 'node:test';
import assert from 'node:assert/strict';
import { readLegacyCarthagentCredential, refreshSingleFlight, credentialStorageKey } from '../lib/opencode/credentials.mjs';
import { createSessionIdentity, managedRequestIdentity, shipTelemetryHeaders } from '../plugins/carthagent/src/server/telemetry.ts';
import { registerProviders, providerConstants } from '../plugins/carthagent/src/server/providers.ts';
import { createDeviceAuthController } from '../plugins/carthagent/src/server/device-auth.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fakeContext({ integrations = ['experiential-labs', 'anthropic', 'openai-codex'], connections = {} } = {}) {
  const hooks = [];
  const events = [];
  const providerTransforms = [];
  const integrationTransforms = [];
  const storage = new Map();
  const registrations = () => ({ dispose() { this.disposed = true; } });
  const ctx = {
    provider: {
      async transform(callback) {
        const models = new Map();
        const editor = {
          add(record) { providerTransforms.push(record); },
          get(id) { return integrations.includes(id) ? { provider: { id }, models: new Map() } : undefined; },
          models: { set(id, value) { models.set(id, value); } },
        };
        callback(editor);
        providerTransforms.push({ models });
        return registrations();
      },
      async reload() {},
    },
    integration: {
      async transform(callback) {
        const methods = [];
        const editor = {
          list: () => integrations.map(id => ({ id, name: id })),
          get: id => integrations.includes(id) ? ({ id, name: id }) : undefined,
          update() {}, remove() {},
          method: { update(value) { methods.push(value); }, list: () => [], remove() {} },
        };
        callback(editor);
        integrationTransforms.push(methods);
        return registrations();
      },
      connection: {
        async active(id) { return connections[id]?.connection; },
        async resolve(connection) { return connection.credential; },
      },
    },
    session: { async hook(name, callback, options) { hooks.push({ name, callback, options }); return registrations(); } },
    storage: {
      async get(key) { return storage.get(key); },
      async set(key, value) { storage.set(key, value); },
    },
    event: { async *subscribe({ signal } = {}) { events.push('subscribed'); if (!signal?.aborted) await new Promise(resolve => signal?.addEventListener('abort', resolve, { once: true })); } },
  };
  return { ctx, hooks, events, providerTransforms, integrationTransforms, storage };
}

test('session telemetry uses stable session-derived thread IDs and request-kind identities', () => {
  const identities = createSessionIdentity({ secret: 'fixture' });
  const alpha = identities.thread('ses_native_non_uuid');
  assert.equal(alpha, identities.thread('ses_native_non_uuid'));
  assert.notEqual(alpha, identities.thread('ses_other'));
  assert.match(alpha, /^[0-9a-f-]{36}$/);
  assert.equal(managedRequestIdentity({ sessionID: 's', kind: 'primary', body: '{}', secret: 'x' }),
    managedRequestIdentity({ sessionID: 's', kind: 'primary', body: '{}', secret: 'x' }));
  assert.notEqual(managedRequestIdentity({ sessionID: 's', kind: 'primary', body: '{}', secret: 'x' }),
    managedRequestIdentity({ sessionID: 's', kind: 'title', body: '{}', secret: 'x' }));
  assert.notEqual(identities.request('same-session', 'primary'), identities.request('same-session', 'primary'));
  const headers = shipTelemetryHeaders({ sessionID: 'ses_native_non_uuid', kind: 'generate', body: '{}', env: {}, agentDir: '/missing' , identity: identities, requestSecret: 'x', version: 'test' });
  assert.equal(headers['x-carthagent-thread-id'], alpha);
  assert.equal(headers['x-carthagent-turn'], '1');
  assert.ok(headers['x-carthagent-request-id']);
  assert.equal(headers['x-carthagent-version'], 'test');
});

test('parallel token refresh callers share one rotation result and failures can retry', async () => {
  let calls = 0;
  let release;
  const work = refreshSingleFlight('credential-1:refresh-A', async () => {
    calls++;
    await new Promise(resolve => { release = resolve; });
    return { access: 'next', refresh: 'rotated' };
  });
  const concurrent = refreshSingleFlight('credential-1:refresh-A', async () => { calls++; return null; });
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await Promise.all([work, concurrent]), [
    { access: 'next', refresh: 'rotated' }, { access: 'next', refresh: 'rotated' },
  ]);
  await assert.rejects(refreshSingleFlight('credential-2', async () => { throw new Error('failed'); }), /failed/);
  assert.equal(await refreshSingleFlight('credential-2', async () => 'recovered'), 'recovered');
});

test('CTG device-auth generations cancel polling, expire, and clean up on unload', async () => {
  const requests = [];
  const controller = createDeviceAuthController({
    env: { CARTHAGENT_CLOUD_URL: 'https://cloud.test' }, agentDir: '/tmp/device-auth-test',
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).endsWith('/v1/device/authorizations')) return new Response(JSON.stringify({
        deviceCode: 'device', userCode: 'ABCD', verificationUri: 'https://verify.test', expiresIn: 30, interval: 1,
      }), { status: 201 });
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
    },
    sleep: async (_ms, signal) => {
      if (signal?.aborted) throw signal.reason;
    },
  });
  const flow = await controller.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(JSON.parse(requests[0].options.body).installId, UUID);
  assert.equal(requests[1].url, 'https://cloud.test/v1/device/token');
  assert.equal(controller.cancel(flow.flowId), true);
  await assert.rejects(flow.callback, /cancelled/);
  assert.equal(controller.cancel(flow.flowId), false);

  const next = await controller.start();
  await new Promise(resolve => setImmediate(resolve));
  await controller.cleanup();
  await assert.rejects(next.callback, /plugin_unloaded/);
  assert.equal(controller.cancel(next.flowId), false);
});

test('legacy credential migration reads Ship OAuth and BYOK without writing Pi store', async () => {
  const source = JSON.stringify({
    'experiential-labs': { type: 'oauth', access: 'a', refresh: 'r', expires: 123 },
  });
  assert.deepEqual(await readLegacyCarthagentCredential({ agentDir: '/unused', readFileImpl: async () => source }),
    { type: 'oauth', access: 'a', refresh: 'r', expires: 123 });
  assert.equal(credentialStorageKey('experiential-labs'), 'ctg.credentials/experiential-labs');
  assert.throws(() => credentialStorageKey('../auth'), /Invalid/);
});

test('provider registration uses native provider transforms and cleanup; refresh discovers subscriptions through injected APIs', async () => {
  const token = `x.${Buffer.from(JSON.stringify({ sub: 'acct', sid: 'sid', scope: 'gateway:invoke' })).toString('base64url')}.x`;
  const connections = {
    'experiential-labs': { connection: { id: 'ship', credential: { type: 'oauth', access: token, refresh: 'refresh', expires: Date.now() + 100000 } } },
    anthropic: { connection: { id: 'claude', credential: { type: 'oauth', access: 'claude-token' } } },
    'openai-codex': { connection: { id: 'codex', credential: { type: 'oauth', access: 'codex-token' } } },
  };
  const fake = fakeContext({ integrations: ['experiential-labs', 'anthropic', 'openai-codex'], connections });
  const fetchCalls = [];
  const fetchImpl = async (url, init) => {
    fetchCalls.push([String(url), init]);
    if (String(url).endsWith('/models') && String(url).includes('experientiallabs')) {
      return new Response(JSON.stringify({ data: [{ id: 'gpt-6-luna' }, { id: 'unknown-model', name: 'Unknown' }] }), { status: 200 });
    }
    if (String(url).includes('api.anthropic.com')) return new Response(JSON.stringify({ data: [{ id: 'claude-test', type: 'model' }] }), { status: 200 });
    if (String(url).includes('chatgpt.com')) return new Response(JSON.stringify({ models: [{ slug: 'codex-test', supported_reasoning_levels: ['low', 'high'] }] }), { status: 200 });
    throw new Error(`unexpected URL ${url}`);
  };
  const cleanup = await registerProviders(fake.ctx, {
    env: { CARTHAGENT_CODING_AGENT_DIR: '/missing' }, fetchImpl,
    openBrowser: () => false, requestSecret: 'test-secret',
  });
  assert.equal(typeof cleanup, 'function');
  assert.deepEqual(fake.integrationTransforms[0].map(item => item.integrationID), ['experiential-labs', 'experiential-labs']);
  assert.equal(fake.integrationTransforms[0][0].method.id, 'carthagent-device');
  assert.equal(fake.integrationTransforms[0][1].method.type, 'key');
  assert.equal(fake.providerTransforms.find(item => item.info?.id === providerConstants.SHIP_PROVIDER_ID).info.package,
    '@opencode/ai/providers/openai-compatible');
  assert.ok(fake.hooks.some(item => item.name === 'http.request' && item.options.providerID === 'experiential-labs'));
  assert.ok(fake.hooks.some(item => item.name === 'http.response'));
  const hooksByName = Object.fromEntries(fake.hooks.map(item => [item.name, item]));
  const nativeSession = { sessionID: 'ses_non_uuid_123', kind: 'primary', model: { providerID: 'experiential-labs' } };
  const modelRequest = { ...nativeSession, headers: {} };
  await hooksByName['model.request'].callback(modelRequest);
  const nextModelRequest = { ...nativeSession, headers: {} };
  await hooksByName['model.request'].callback(nextModelRequest);
  assert.ok(modelRequest.headers['x-carthagent-request-id']);
  assert.notEqual(modelRequest.headers['x-carthagent-request-id'], nextModelRequest.headers['x-carthagent-request-id'],
    'separate native requests in one session must have distinct idempotency identities');
  const auxiliaryRequest = { ...nativeSession, kind: 'title', headers: {} };
  await hooksByName['model.request'].callback(auxiliaryRequest);
  assert.notEqual(modelRequest.headers['x-carthagent-request-id'], auxiliaryRequest.headers['x-carthagent-request-id'],
    'auxiliary request kinds must have independent identities');
  const request = new Request('https://gateway.example/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'gpt-6-luna', messages: [] }) });
  const hookedRequestEvent = { ...nativeSession, request: new Request(request, { headers: { 'x-carthagent-request-id': modelRequest.headers['x-carthagent-request-id'] } }) };
  await hooksByName['http.request'].callback(hookedRequestEvent);
  assert.equal(hookedRequestEvent.request.headers.get('x-carthagent-thread-id')?.length, 36);
  assert.equal(hookedRequestEvent.request.headers.get('Idempotency-Key'), modelRequest.headers['x-carthagent-request-id']);
  const retry = new Request('https://gateway.example/v1/chat/completions', { method: 'POST', headers: { 'x-carthagent-request-id': modelRequest.headers['x-carthagent-request-id'] }, body: JSON.stringify({ model: 'gpt-6-luna', messages: [] }) });
  const retryRequestEvent = { ...nativeSession, request: retry };
  await hooksByName['http.request'].callback(retryRequestEvent);
  assert.equal(retryRequestEvent.request.headers.get('Idempotency-Key'), hookedRequestEvent.request.headers.get('Idempotency-Key'),
    'transport retry identity must remain stable');
  const retryEvent = { ...nativeSession, attempt: 1, decision: { retry: true, delay: 0 }, error: {} };
  await hooksByName.retry.callback(retryEvent);
  assert.deepEqual(retryEvent.decision, { retry: false });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.ok(fetchCalls.some(([url]) => url.includes('/models')));
  await cleanup();
  assert.ok(fake.events.includes('subscribed'));
});
