import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { CloudLedger } from '../lib/cloud/ledger.mjs';
import { CloudControlPlane } from '../lib/cloud/control-plane.mjs';
import { cloudRouter } from '../lib/cloud/http.mjs';

async function fixture(t) {
  let id = 0;
  const now = new Date('2026-01-01T00:00:00.000Z');
  const ledger = new CloudLedger({ id: () => `l-${++id}`, clock: () => now });
  const control = new CloudControlPlane({ ledger, id: () => `c-${++id}`, clock: () => now, random: size => Buffer.alloc(size, 7), tokenSecret: 'secret', publicUrl: 'https://cloud.test' });
  const account = control.createUserAccount({ email: 'api@example.com' });
  const app = express();
  app.use(cloudRouter(control, { authenticateBrowser: async req => req.get('x-test-account') === account.accountId ? account : null }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.close(); ledger.close(); });
  return { base: `http://127.0.0.1:${server.address().port}`, account, control };
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
  assert.equal((await accountResponse.json()).balance.availableNanoUsd, 1_000_000_000);
  assert.equal((await fetch(`${base}/v1/token/revoke`, { method: 'POST', headers: { authorization: `Bearer ${tokens.accessToken}` } })).status, 200);
  assert.equal((await fetch(`${base}/v1/account`, { headers: { authorization: `Bearer ${tokens.accessToken}` } })).status, 401);
});
