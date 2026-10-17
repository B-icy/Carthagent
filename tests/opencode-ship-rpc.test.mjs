import test from 'node:test';
import assert from 'node:assert/strict';
const jiti = (await import('jiti')).createJiti(import.meta.url);
const { createShipRpcHandlers: createHandlers } = await jiti.import('../plugins/carthagent/src/server/ship-rpc.ts');
const { CloudClient } = await import('../lib/cloud/client.mjs');

test('profile Ship RPC uses resolved native OAuth and loopback account, billing, and revoke endpoints', async () => {
  const requests = [];
  const server = await import('node:http').then(({ createServer }) => createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization, body: body ? JSON.parse(body) : undefined });
    const payload = request.url === '/v1/account' ? { account: { id: 'acct-loopback' }, grants: [], sessions: [] }
      : request.url === '/v1/billing/checkout' ? { url: 'https://billing.test/checkout' }
        : request.url === '/v1/billing/portal' ? { url: 'https://billing.test/portal' }
          : {};
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  }));
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const ctx = { integration: { connection: {
      active: async id => { assert.equal(id, 'experiential-labs'); return { type: 'credential', method: 'oauth', id: 'cred-profile' }; },
      resolve: async () => ({ type: 'oauth', methodID: 'carthagent-device', access: 'loopback-token' }),
    } } };
    const handlers = createHandlers(ctx, { baseUrl, cloudUrl: baseUrl, cloudClient: new CloudClient({ baseUrl }) });
    const signal = new AbortController().signal;
    assert.deepEqual(await handlers.shipAccount({}, { signal }), { account: { account: { id: 'acct-loopback' }, grants: [], sessions: [] } });
    assert.deepEqual(await handlers.shipBilling({ action: 'checkout' }, { signal }), { url: 'https://billing.test/checkout' });
    assert.deepEqual(await handlers.shipBilling({ action: 'portal' }, { signal }), { url: 'https://billing.test/portal' });
    assert.deepEqual(await handlers.shipLogout({ session: 'session-target' }, { signal }), { revoked: true });
    assert.deepEqual(await handlers.shipLogout({}, { signal }), { revoked: true, credentialID: 'cred-profile' });
    assert.deepEqual(requests.map(item => [item.method, item.url]), [
      ['GET', '/v1/account'], ['POST', '/v1/billing/checkout'], ['POST', '/v1/billing/portal'],
      ['DELETE', '/v1/account/sessions/session-target'], ['POST', '/v1/token/revoke'],
    ]);
    assert.ok(requests.every(item => item.authorization === 'Bearer loopback-token'));
    assert.deepEqual(requests[1].body, { successUrl: `${baseUrl}/account`, cancelUrl: `${baseUrl}/account` });
    assert.deepEqual(requests[2].body, { returnUrl: `${baseUrl}/account` });
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('profile Ship RPC rejects BYOK, absent auth, and pre-aborted operations without network calls', async () => {
  let requests = 0;
  const cloudClient = { async account() { requests++; }, async checkout() { requests++; }, async portal() { requests++; }, async revokeCurrent() { requests++; }, async revokeSession() { requests++; } };
  const rpcCall = signal => ({
    signal,
    error: (code, message, data) => { throw Object.assign(new Error(message), { type: `ship.${code}`, data }); },
  });
  for (const connection of [undefined, { type: 'credential', method: 'key', id: 'key' }]) {
    const handlers = createHandlers({ integration: { connection: {
      active: async () => connection,
      resolve: async () => connection ? { type: 'key', key: 'byok' } : undefined,
    } } }, { cloudClient });
    await assert.rejects(handlers.shipAccount({}, rpcCall(new AbortController().signal)), /active Carthagent Ship OAuth/);
  }
  const handlers = createHandlers({ integration: { connection: { active: async () => undefined, resolve: async () => undefined } } }, { cloudClient });
  const controller = new AbortController();
  controller.abort(new Error('cancelled before request'));
  await assert.rejects(handlers.shipAccount({}, rpcCall(controller.signal)), /cancelled before request/);
  assert.equal(requests, 0);
});
