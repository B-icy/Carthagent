import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { CloudLedger } from '../lib/cloud/ledger.mjs';
import { CloudControlPlane } from '../lib/cloud/control-plane.mjs';
import { cloudRouter } from '../lib/cloud/http.mjs';
import { CloudGatewayAuthority } from '../lib/cloud/gateway.mjs';

async function fixture(t, { withGateway = false } = {}) {
  let id = 0;
  const now = new Date('2026-01-01T00:00:00.000Z');
  const ledger = new CloudLedger({ id: () => `l-${++id}`, clock: () => now });
  const control = new CloudControlPlane({ ledger, id: () => `c-${++id}`, clock: () => now, random: size => Buffer.alloc(size, 7), tokenSecret: 'secret', publicUrl: 'https://cloud.test' });
  const account = control.createUserAccount({ email: 'api@example.com' });
  let gateway = null;
  if (withGateway) {
    gateway = new CloudGatewayAuthority({
      control, ledger, id: () => `g-${++id}`, clock: () => now,
      upstream: { dispatch: async () => new Response(JSON.stringify({ usage: { prompt_tokens: 12, completion_tokens: 3 } }), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'exp-http-request' } }) },
      settlementSource: { resolve: async () => ({ status: 'terminal', requestId: 'exp-http-request', terminalState: 'completed', attempts: [{ attemptId: 'exp-http-attempt', state: 'completed', inputTokens: 12, outputTokens: 3 }] }) },
    });
    gateway.publishPricing({ id: 'http-price', inputNanoUsdPerMillionTokens: 1_000_000, outputNanoUsdPerMillionTokens: 2_000_000 });
    gateway.publishAlias({ alias: 'carthagent-code', displayName: 'Carthagent Code', upstreamAlias: 'upstream-code', pricingVersionId: 'http-price', revisionId: 'http-revision', maxInputTokens: 100_000, defaultMaxOutputTokens: 100, maxOutputTokens: 1_000 });
  }
  const app = express();
  app.use(cloudRouter(control, { gateway, authenticateBrowser: async req => req.get('x-test-account') === account.accountId ? account : null }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.close(); ledger.close(); });
  return { base: `http://127.0.0.1:${server.address().port}`, account, control, gateway, ledger };
}

const json = body => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('HTTP device flow returns OAuth-style pending, token, account, and revoke responses', async t => {
  const { base, account } = await fixture(t);
  const device = await (await fetch(`${base}/v1/device/authorizations`, json({ clientName: 'test cli' }))).json();
  const pending = await fetch(`${base}/v1/device/token`, json({ deviceCode: device.deviceCode }));
  assert.equal(pending.status, 428);
  const approved = await fetch(`${base}/v1/device/authorizations/${device.userCode}/approve`, {
    ...json({ approve: true }), headers: { ...json({}).headers, 'x-test-account': account.accountId },
  });
  assert.equal(approved.status, 200);
  const tokens = await (await fetch(`${base}/v1/device/token`, json({ deviceCode: device.deviceCode }))).json();
  const accountResponse = await fetch(`${base}/v1/account`, { headers: { authorization: `Bearer ${tokens.accessToken}` } });
  assert.equal(accountResponse.status, 200);
  const accountBody = await accountResponse.json();
  assert.equal(accountBody.balance.availableNanoUsd, 1_000_000_000);
  assert.equal(accountBody.email, 'api@example.com');
  assert.equal(accountBody.grants[0].source, 'verified_trial');
  const balance = await (await fetch(`${base}/v1/account/balance`, { headers: { authorization: `Bearer ${tokens.accessToken}` } })).json();
  assert.equal(balance.grants[0].remainingNanoUsd, 1_000_000_000);
  const sessions = await (await fetch(`${base}/v1/account/sessions`, { headers: { authorization: `Bearer ${tokens.accessToken}` } })).json();
  assert.equal(sessions.currentSessionId, sessions.data[0].id);
  assert.equal(sessions.data[0].client_name, 'test cli');
  assert.equal((await fetch(`${base}/v1/token/revoke`, { method: 'POST', headers: { authorization: `Bearer ${tokens.accessToken}` } })).status, 200);
  assert.equal((await fetch(`${base}/v1/account`, { headers: { authorization: `Bearer ${tokens.accessToken}` } })).status, 401);
});

test('HTTP gateway exposes authenticated aliases and proxies a settled OpenAI-compatible request', async t => {
  const { base, account, control, ledger } = await fixture(t, { withGateway: true });
  ledger.grant({ accountId: account.accountId, amountNanoUsd: 1_000_000, idempotencyKey: 'http-credit' });
  const tokens = control.issueSession(account.accountId);
  const headers = { authorization: `Bearer ${tokens.accessToken}`, 'content-type': 'application/json', 'idempotency-key': 'http-operation' };
  const modelsResponse = await fetch(`${base}/v1/models`, { headers });
  assert.equal(modelsResponse.status, 200);
  assert.deepEqual((await modelsResponse.json()).data.map(model => model.id), ['carthagent-code']);
  const response = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers, body: JSON.stringify({ model: 'carthagent-code', messages: [{ role: 'user', content: 'hello' }], max_tokens: 10 }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-request-id'), 'exp-http-request');
  assert.deepEqual(await response.json(), { usage: { prompt_tokens: 12, completion_tokens: 3 } });
  const usage = await (await fetch(`${base}/v1/account/usage`, { headers })).json();
  assert.deepEqual(usage.data.map(item => ({ alias: item.alias, inputTokens: item.inputTokens, outputTokens: item.outputTokens })), [{ alias: 'carthagent-code', inputTokens: 12, outputTokens: 3 }]);
  const request = ledger.db.prepare('SELECT * FROM cloud_gateway_requests WHERE operation_key = ?').get('http-operation');
  assert.equal(request.state, 'settled');
  assert.equal(request.gateway_request_id, 'exp-http-request');
});

test('HTTP account sessions can be listed and revoked only by their account', async t => {
  const { base, account, control } = await fixture(t);
  const current = control.issueSession(account.accountId, undefined, 'current');
  control.random = size => Buffer.alloc(size, 8);
  const other = control.issueSession(account.accountId, undefined, 'other device');
  const otherClaims = control.verifyAccessToken(other.accessToken);
  const headers = { authorization: `Bearer ${current.accessToken}` };
  const response = await fetch(`${base}/v1/account/sessions/${otherClaims.sid}`, { method: 'DELETE', headers });
  assert.equal(response.status, 200);
  assert.throws(() => control.verifyAccessToken(other.accessToken), /revoked_token/);
  const missing = await fetch(`${base}/v1/account/sessions/not-found`, { method: 'DELETE', headers });
  assert.equal(missing.status, 404);
});

test('HTTP gateway rejects exhausted credit before upstream dispatch', async t => {
  const { base, account, control } = await fixture(t, { withGateway: true });
  const tokens = control.issueSession(account.accountId);
  const response = await fetch(`${base}/v1/responses`, {
    method: 'POST', headers: { authorization: `Bearer ${tokens.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'carthagent-code', input: 'hello' }),
  });
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error.code, 'insufficient_quota');
});
