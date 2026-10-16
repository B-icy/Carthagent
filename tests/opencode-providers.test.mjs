import test from 'node:test';
import assert from 'node:assert/strict';
import { readLegacyCarthagentCredential, refreshSingleFlight, credentialStorageKey } from '../lib/opencode/credentials.mjs';
import { createSessionIdentity, managedRequestIdentity, shipTelemetryHeaders } from '../plugins/carthagent/src/server/telemetry.ts';
import { registerProviders, providerConstants } from '../plugins/carthagent/src/server/providers.ts';

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
  assert.equal(headers['x-carthagent-turn'], '0');
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
    'carthagent-ship': { connection: { id: 'ship', credential: { type: 'oauth', access: token, refresh: 'refresh', expires: Date.now() + 100000 } } },
    anthropic: { connection: { id: 'claude', credential: { type: 'oauth', access: 'claude-token' } } },
    'openai-codex': { connection: { id: 'codex', credential: { type: 'oauth', access: 'codex-token' } } },
  };
  const fake = fakeContext({ integrations: ['carthagent-ship', 'experiential-labs', 'anthropic', 'openai-codex'], connections });
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
  assert.deepEqual(fake.integrationTransforms[0].map(item => item.integrationID), ['carthagent-ship', 'carthagent-ship']);
  assert.equal(fake.integrationTransforms[0][0].method.id, 'carthagent-device');
  assert.equal(fake.integrationTransforms[0][1].method.type, 'key');
  assert.equal(fake.providerTransforms.find(item => item.info?.id === providerConstants.SHIP_PROVIDER_ID).info.package,
    '@opencode/ai/providers/openai-compatible');
  assert.ok(fake.hooks.some(item => item.name === 'http.request' && item.options.providerID === 'experiential-labs'));
  assert.ok(fake.hooks.some(item => item.name === 'http.response'));
  const hooksByName = Object.fromEntries(fake.hooks.map(item => [item.name, item]));
  const nativeSession = { sessionID: 'ses_non_uuid_123', kind: 'primary', model: { providerID: 'experiential-labs' } };
  const request = new Request('https://gateway.example/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'gpt-6-luna', messages: [] }) });
  const hookedRequestEvent = { ...nativeSession, request };
  await hooksByName['http.request'].callback(hookedRequestEvent);
  assert.equal(hookedRequestEvent.request.headers.get('x-carthagent-thread-id')?.length, 36);
  assert.ok(hookedRequestEvent.request.headers.get('Idempotency-Key'));
  const retryEvent = { ...nativeSession, attempt: 1, decision: { retry: true, delay: 0 }, error: {} };
  await hooksByName.retry.callback(retryEvent);
  assert.deepEqual(retryEvent.decision, { retry: false });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.ok(fetchCalls.some(([url]) => url.includes('/models')));
  await cleanup();
  assert.ok(fake.events.includes('subscribed'));
});
