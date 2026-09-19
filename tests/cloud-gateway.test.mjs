import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CloudLedger } from '../lib/cloud/ledger.mjs';
import { CloudControlPlane } from '../lib/cloud/control-plane.mjs';
import {
  CloudGatewayAuthority, ExperientialGatewayClient, GatewayDispatchError,
  boundedGatewayRequest, customerChargeNanoUsd, tokenChargeNanoUsd,
} from '../lib/cloud/gateway.mjs';

function fixture({ upstream, settlementSource } = {}) {
  let id = 0;
  const now = new Date('2026-01-01T00:00:00.000Z');
  const ledger = new CloudLedger({ id: () => `ledger-${++id}`, clock: () => now });
  const control = new CloudControlPlane({ ledger, id: () => `control-${++id}`, clock: () => now, tokenSecret: 'secret' });
  const account = control.createUserAccount({ email: 'gateway@example.com' });
  const gateway = new CloudGatewayAuthority({ control, ledger, id: () => `gateway-${++id}`, clock: () => now, upstream, settlementSource });
  gateway.publishPricing({ id: 'price-v1', inputNanoUsdPerMillionTokens: 1_000_000, outputNanoUsdPerMillionTokens: 2_000_000, fixedRequestNanoUsd: 50 });
  gateway.publishAlias({
    alias: 'carthagent-code', displayName: 'Carthagent Code', upstreamAlias: 'experiential-code', pricingVersionId: 'price-v1', revisionId: 'code-v1',
    maxInputTokens: 100_000, defaultMaxOutputTokens: 100, maxOutputTokens: 1_000, maximumAttempts: 2,
  });
  return { ledger, control, account, gateway };
}

const upstreamResponse = ({ requestId = 'exp-request-1', body = { usage: { prompt_tokens: 10, completion_tokens: 5 } }, status = 200 } = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'x-request-id': requestId },
});

test('pricing rounds each token leg up in integer nano-USD', () => {
  assert.equal(tokenChargeNanoUsd(1, 1), 1);
  assert.equal(tokenChargeNanoUsd(1_000_001, 1_000_000), 1_000_001);
  assert.equal(customerChargeNanoUsd({ input_nano_usd_per_million_tokens: 1_000_000, output_nano_usd_per_million_tokens: 2_000_000, fixed_request_nano_usd: 50 }, [{ inputTokens: 10, outputTokens: 5 }]), 70);
});

test('request bounding applies a server output cap and rewrites only the model alias', () => {
  const bounded = boundedGatewayRequest('chat.completions', { model: 'carthagent-code', messages: [{ role: 'user', content: 'hello' }] }, {
    alias: 'carthagent-code', upstream_alias: 'experiential-code', max_input_tokens: 10_000,
    default_max_output_tokens: 128, max_output_tokens: 256,
  });
  assert.equal(bounded.request.model, 'experiential-code');
  assert.equal(bounded.request.max_tokens, 128);
  assert.throws(() => boundedGatewayRequest('responses', { model: 'carthagent-code', input: 'hello', max_output_tokens: 300 }, {
    alias: 'carthagent-code', upstream_alias: 'experiential-code', max_input_tokens: 10_000,
    default_max_output_tokens: 128, max_output_tokens: 256,
  }), /max_output_tokens_exceeded/);
});

test('aliases and prices are immutable versions while the current revision may advance', () => {
  const { gateway, ledger } = fixture();
  assert.deepEqual(gateway.models(), [{ id: 'carthagent-code', name: 'Carthagent Code' }]);
  assert.throws(() => gateway.publishPricing({ id: 'price-v1', inputNanoUsdPerMillionTokens: 2, outputNanoUsdPerMillionTokens: 2 }), /pricing_version_immutable_conflict/);
  gateway.publishPricing({ id: 'price-v2', inputNanoUsdPerMillionTokens: 2_000_000, outputNanoUsdPerMillionTokens: 3_000_000 });
  gateway.publishAlias({
    alias: 'carthagent-code', displayName: 'Carthagent Code', upstreamAlias: 'experiential-code-v2', pricingVersionId: 'price-v2', revisionId: 'code-v2',
    maxInputTokens: 100_000, defaultMaxOutputTokens: 100, maxOutputTokens: 1_000,
  });
  assert.equal(gateway.resolveAlias('carthagent-code').id, 'code-v2');
  assert.equal(gateway.db.prepare('SELECT COUNT(*) AS count FROM cloud_model_alias_revisions').get().count, 2);
  ledger.close();
});

test('authority reserves before dispatch and settles only from authoritative request and attempt facts', async () => {
  const events = [];
  const upstream = { dispatch: async input => { events.push(['dispatch', input.body.model]); return upstreamResponse(); } };
  const settlementSource = { resolve: async () => ({
    status: 'terminal', requestId: 'exp-request-1', terminalState: 'completed', attempts: [
      { attemptId: 'exp-attempt-1', state: 'failed', inputTokens: 100, outputTokens: 0 },
      { attemptId: 'exp-attempt-2', state: 'completed', inputTokens: 100, outputTokens: 50 },
    ],
  }) };
  const { gateway, ledger, account } = fixture({ upstream, settlementSource });
  ledger.grant({ accountId: account.accountId, amountNanoUsd: 10_000_000, idempotencyKey: 'grant' });
  const before = ledger.available(account.accountId);
  const handle = await gateway.invoke({ accountId: account.accountId, endpoint: 'chat.completions', operationKey: 'op-1', body: { model: 'carthagent-code', messages: [{ role: 'user', content: 'hello' }], max_tokens: 100 } });
  assert.equal(events.length, 1);
  assert.ok(ledger.available(account.accountId) < before);
  assert.equal(handle.revision.id, 'code-v1');
  const settled = await gateway.finalize(handle, { responseBody: Buffer.from(await handle.response.text()) });
  assert.equal(settled.state, 'settled');
  assert.equal(settled.gateway_request_id, 'exp-request-1');
  assert.equal(settled.attempts.length, 2);
  assert.equal(settled.customer_charge_nano_usd, 350);
  assert.equal(ledger.entries(account.accountId).find(entry => entry.kind === 'charge').gateway_attempt_id, 'exp-attempt-2');
  ledger.close();
});

test('known pre-dispatch failures release the full reservation', async () => {
  const upstream = { dispatch: async () => { throw new GatewayDispatchError('offline', { outcome: 'not_dispatched' }); } };
  const { gateway, ledger, account } = fixture({ upstream });
  ledger.grant({ accountId: account.accountId, amountNanoUsd: 1_000_000, idempotencyKey: 'grant' });
  const before = ledger.available(account.accountId);
  await assert.rejects(gateway.invoke({ accountId: account.accountId, endpoint: 'responses', operationKey: 'known-failure', body: { model: 'carthagent-code', input: 'hello' } }), /offline/);
  assert.equal(ledger.available(account.accountId), before);
  assert.equal(gateway.db.prepare('SELECT state FROM cloud_gateway_requests WHERE operation_key = ?').get('known-failure').state, 'released_not_dispatched');
  ledger.close();
});

test('unknown transport and unknown settlement outcomes fail closed with credit held', async () => {
  const upstream = { dispatch: async () => { throw new GatewayDispatchError('timeout', { outcome: 'unknown' }); } };
  const { gateway, ledger, account } = fixture({ upstream });
  ledger.grant({ accountId: account.accountId, amountNanoUsd: 1_000_000, idempotencyKey: 'grant' });
  const before = ledger.available(account.accountId);
  await assert.rejects(gateway.invoke({ accountId: account.accountId, endpoint: 'responses', operationKey: 'ambiguous', body: { model: 'carthagent-code', input: 'hello' } }), /timeout/);
  assert.ok(ledger.available(account.accountId) < before);
  assert.equal(gateway.db.prepare('SELECT state FROM cloud_gateway_requests WHERE operation_key = ?').get('ambiguous').state, 'reconciliation_required');
  assert.equal(ledger.entries(account.accountId).some(entry => entry.kind === 'reservation_release'), false);
  ledger.close();
});

test('missing authoritative attempt identity leaves a successful HTTP result in reconciliation', async () => {
  const upstream = { dispatch: async () => upstreamResponse() };
  const settlementSource = { resolve: async () => ({ status: 'pending' }) };
  const { gateway, ledger, account } = fixture({ upstream, settlementSource });
  ledger.grant({ accountId: account.accountId, amountNanoUsd: 1_000_000, idempotencyKey: 'grant' });
  const handle = await gateway.invoke({ accountId: account.accountId, endpoint: 'responses', operationKey: 'pending', body: { model: 'carthagent-code', input: 'hello' } });
  const result = await gateway.finalize(handle, { responseBody: Buffer.from(await handle.response.text()) });
  assert.equal(result.state, 'reconciliation_required');
  assert.equal(ledger.entries(account.accountId).some(entry => entry.kind === 'charge'), false);
  ledger.close();
});

test('a later reconciliation settles against the request frozen pricing revision', async () => {
  const upstream = { dispatch: async () => upstreamResponse() };
  const settlementSource = { resolve: async () => ({ status: 'pending' }) };
  const { gateway, ledger, account } = fixture({ upstream, settlementSource });
  ledger.grant({ accountId: account.accountId, amountNanoUsd: 1_000_000, idempotencyKey: 'grant' });
  const handle = await gateway.invoke({ accountId: account.accountId, endpoint: 'responses', operationKey: 'late', body: { model: 'carthagent-code', input: 'hello', max_output_tokens: 10 } });
  await gateway.finalize(handle, { responseBody: Buffer.from(await handle.response.text()) });
  gateway.publishPricing({ id: 'price-v2', inputNanoUsdPerMillionTokens: 9_000_000, outputNanoUsdPerMillionTokens: 9_000_000 });
  gateway.publishAlias({ alias: 'carthagent-code', displayName: 'Carthagent Code', upstreamAlias: 'new-upstream', pricingVersionId: 'price-v2', revisionId: 'code-v2', maxInputTokens: 100_000, defaultMaxOutputTokens: 100, maxOutputTokens: 1_000 });
  const reconciled = await gateway.reconcile(handle.id, { status: 'terminal', requestId: 'exp-request-1', terminalState: 'completed', attempts: [{ attemptId: 'late-attempt', state: 'completed', inputTokens: 10, outputTokens: 5 }] });
  assert.equal(reconciled.state, 'settled');
  assert.equal(reconciled.pricing_version_id, 'price-v1');
  assert.equal(reconciled.customer_charge_nano_usd, 70);
  ledger.close();
});

test('Experiential client authenticates and sends stable gateway correlation headers', async () => {
  let seen;
  const client = new ExperientialGatewayClient({ baseUrl: 'https://gateway.test/v1/', apiKey: 'test-key', fetchImpl: async (url, options) => { seen = { url, options }; return upstreamResponse(); } });
  await client.dispatch({ endpoint: 'chat.completions', body: { model: 'alias' }, operationKey: 'operation-1', clientRequestId: 'client-1' });
  assert.equal(seen.url, 'https://gateway.test/v1/chat/completions');
  assert.equal(seen.options.headers.authorization, 'Bearer test-key');
  assert.equal(seen.options.headers['idempotency-key'], 'operation-1');
  assert.equal(seen.options.headers['x-client-request-id'], 'client-1');
});
