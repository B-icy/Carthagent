import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createJiti } = require('jiti');
const jiti = createJiti(import.meta.url);
const { createShipRpcHandlers } = await jiti.import('../plugins/carthagent/src/server/ship-rpc.ts');

function setup() {
  const calls = [];
  const active = { id: 'ship-credential', type: 'credential', method: 'oauth', integrationID: 'experiential-labs' };
  const ctx = { integration: {
    connection: {
      active: async (id) => { calls.push(['active', id]); return active; },
      resolve: async (connection) => { calls.push(['resolve', connection.id]); return { type: 'oauth', methodID: 'carthagent-device', access: 'fixture-token' }; },
    },
    transform: async (fn) => fn({ remove: (id) => calls.push(['remove', id]) }),
  } };
  const cloud = {
    account: async (input) => { calls.push(['account', input]); return { email: 'fixture@example.test', sessions: [] }; },
    usage: async (input) => { calls.push(['usage', input]); return { data: [{ alias: 'fixture-model', inputTokens: 12, outputTokens: 8 }] }; },
    checkout: async (input) => { calls.push(['checkout', input]); return { url: 'https://billing.example.test/checkout' }; },
    portal: async (input) => { calls.push(['portal', input]); return { url: 'https://billing.example.test/portal' }; },
    revokeCurrent: async (input) => calls.push(['revokeCurrent', input]),
    revokeSession: async (input) => calls.push(['revokeSession', input]),
  };
  return { calls, ctx, cloud, handlers: createShipRpcHandlers(ctx, { cloudClient: cloud, cloudUrl: 'https://ship.example.test' }) };
}

const call = { signal: new AbortController().signal };

test('Ship account and billing RPCs use the active profile credential and injected cloud client', async () => {
  const { calls, handlers } = setup();
  const account = await handlers.shipAccount({}, call);
  assert.equal(account.account.email, 'fixture@example.test');
  assert.deepEqual((await handlers.shipUsage({ limit: 10 }, call)).usage.data[0].alias, 'fixture-model');
  assert.equal((await handlers.shipBilling({ action: 'checkout' }, call)).url, 'https://billing.example.test/checkout');
  assert.equal((await handlers.shipBilling({ action: 'portal' }, call)).url, 'https://billing.example.test/portal');
  assert.deepEqual(calls.filter(([name]) => ['account', 'usage', 'checkout', 'portal'].includes(name)).map(([name, input]) => [name, input.accessToken, input.signal === call.signal]), [
    ['account', 'fixture-token', true],
    ['usage', 'fixture-token', true],
    ['checkout', 'fixture-token', true],
    ['portal', 'fixture-token', true],
  ]);
  assert.ok(calls.some(([name, input]) => name === 'usage' && input.limit === 10));
  assert.ok(calls.some(([name, input]) => name === 'checkout' && input.successUrl === 'https://ship.example.test/account'));
});

test('Ship logout revokes one named session or the active profile token and removes its connection', async () => {
  const { calls, handlers } = setup();
  assert.deepEqual(await handlers.shipLogout({ session: 'session-1' }, call), { revoked: true });
  assert.deepEqual(await handlers.shipLogout({}, call), { revoked: true, credentialID: 'ship-credential' });
  assert.ok(calls.some(([name, input]) => name === 'revokeSession' && input.sessionId === 'session-1'));
  assert.ok(calls.some(([name, input]) => name === 'revokeCurrent' && input.accessToken === 'fixture-token'));
  assert.ok(calls.some(([name, id]) => name === 'remove' && id === 'ship-credential'));
});

test('Ship RPC requires its managed OAuth credential and honors cancellation before cloud traffic', async () => {
  const { ctx, calls, handlers } = setup();
  ctx.integration.connection.resolve = async () => ({ type: 'oauth', methodID: 'other', access: 'wrong' });
  await assert.rejects(handlers.shipAccount({}, call), /active Carthagent Ship OAuth connection/);
  assert.equal(calls.some(([name]) => name === 'account'), false);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(handlers.shipBilling({ action: 'portal' }, { signal: controller.signal }));
  assert.equal(calls.some(([name]) => name === 'portal'), false);
});
