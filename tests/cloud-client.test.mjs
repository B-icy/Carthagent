import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CloudClient, cloudControlUrl, cloudManagedUsageRecovery, formatCloudAccount, formatNanoUsd, oauthCredentials, openBrowser } from '../lib/cloud/client.mjs';

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('browser opening uses platform launchers and rejects non-HTTP targets', async () => {
  const calls = [];
  const spawnImpl = (command, args) => {
    calls.push({ command, args });
    return { once(event, callback) { if (event === 'spawn') queueMicrotask(callback); return this; }, unref() {} };
  };
  assert.equal(await openBrowser('https://cloud.test/path?a=1', { platform: 'linux', env: {}, spawnImpl }), true);
  assert.equal(calls[0].command, 'xdg-open');
  assert.deepEqual(calls[0].args, ['https://cloud.test/path?a=1']);
  assert.equal(await openBrowser('file:///tmp/secret', { spawnImpl }), false);
});

test('Cloud client resolves the control-plane URL and formats integer nano-USD', () => {
  assert.equal(cloudControlUrl({}), 'https://api.carthagent.xyz');
  assert.equal(cloudControlUrl({ CARTHAGENT_CLOUD_URL: ' https://preview.test/v1/ ' }), 'https://preview.test/v1');
  assert.equal(formatNanoUsd(1_230_000_000), '$1.23');
  assert.equal(formatNanoUsd(-10_000_000), '-$0.01');
  assert.equal(formatNanoUsd(1.5), 'unavailable');
});

test('Cloud device flow reports the code, tolerates pending, and returns rotating credentials', async () => {
  const calls = [];
  let polls = 0;
  const client = new CloudClient({
    baseUrl: 'https://cloud.test', sleep: async () => {},
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/v1/device/authorizations')) return response(201, {
        deviceCode: 'ctgd_secret', userCode: 'ABCDE-12345', verificationUri: 'https://cloud.test/activate',
        verificationUriComplete: 'https://cloud.test/activate?code=ABCDE-12345', expiresIn: 600, interval: 1,
      });
      polls++;
      if (polls === 1) return response(428, { error: 'authorization_pending' });
      return response(200, { accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 });
    },
  });
  const events = [];
  const tokens = await client.authorizeDevice({ notify: event => events.push(event), signal: new AbortController().signal });
  assert.equal(tokens.accessToken, 'access');
  assert.equal(events[0].type, 'device_code');
  assert.equal(events[0].verificationUri, 'https://cloud.test/activate?code=ABCDE-12345');
  assert.ok(events.some(event => event.type === 'progress'));
  assert.equal(calls.length, 3);
});

test('Cloud client surfaces denial, expiry, cancellation, and HTTP errors without secrets', async () => {
  const denied = new CloudClient({ baseUrl: 'https://cloud.test', fetchImpl: async url => url.endsWith('/authorizations')
    ? response(201, { deviceCode: 'secret-device', userCode: 'DENY-1', verificationUri: 'https://verify', expiresIn: 60, interval: 1 })
    : response(401, { error: 'access_denied' }) });
  await assert.rejects(denied.authorizeDevice(), error => error.code === 'access_denied' && !error.message.includes('secret-device'));

  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await assert.rejects(new CloudClient().authorizeDevice({ signal: controller.signal }), /cancelled/);

  const expired = new CloudClient({
    baseUrl: 'https://cloud.test', sleep: async () => {},
    fetchImpl: async url => url.endsWith('/authorizations')
      ? response(201, { deviceCode: 'd', userCode: 'E', verificationUri: 'https://verify', expiresIn: -1, interval: 1 })
      : response(428, { error: 'authorization_pending' }),
  });
  await assert.rejects(expired.authorizeDevice(), error => error.code === 'expired_token');
});

test('Cloud client sends account, billing, and session requests with bearer auth', async () => {
  const requests = [];
  const client = new CloudClient({ baseUrl: 'https://cloud.test', fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return response(200, url.endsWith('/account') ? { accountId: 'a', balance: { availableNanoUsd: 1_000_000_000 }, subscription: { status: 'active' }, sessions: [] } : { url: 'https://stripe.test' });
  } });
  const account = await client.account({ accessToken: 'access' });
  await client.checkout({ accessToken: 'access', successUrl: 'https://return', cancelUrl: 'https://return' });
  await client.portal({ accessToken: 'access', returnUrl: 'https://return' });
  await client.revokeSession({ accessToken: 'access', sessionId: 'session/1' });
  assert.equal(account.accountId, 'a');
  assert.ok(requests.every(item => item.options.headers.authorization === 'Bearer access'));
  assert.match(requests.at(-1).url, /session%2F1$/);
});

test('OAuth and account formatters keep token expiration and account UX deterministic', () => {
  assert.deepEqual(oauthCredentials({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 }, 1_000), { access: 'a', refresh: 'r', expires: 901_000 });
  assert.match(formatCloudAccount({ accountId: 'acct', balance: { availableNanoUsd: 1_000_000_000 }, subscription: { status: 'none' }, sessions: [{}, { revoked_at: 'x' }] }), /Credit: \$1\.00 available[\s\S]*Plan: Free[\s\S]*1 active, 1 revoked/);
  const managed = formatCloudAccount({
    accountId: 'paid', balance: { availableNanoUsd: 8_000_000_000 },
    subscription: { status: 'active', current_period_end: 1_800_000_000 },
    managedUsage: {
      periodEnd: 1_800_000_000,
      monthly: { allowanceNanoUsd: 8_000_000_000, reservedNanoUsd: 250_000_000, availableNanoUsd: 6_750_000_000 },
      daily: { limitNanoUsd: 500_000_000, reservedNanoUsd: 50_000_000, availableNanoUsd: 300_000_000, resetsAt: '2027-01-02T00:00:00.000Z' },
    }, sessions: [],
  });
  assert.match(managed, /Managed monthly: \$6\.75 available of \$8\.00 \(\$0\.25 reserved\)/);
  assert.match(managed, /Managed daily: \$0\.30 available of \$0\.50 \(\$0\.05 reserved\)/);
  assert.match(managed, /Daily reset: 2027-01-02T00:00:00\.000Z/);
});

test('managed usage recovery distinguishes daily, monthly, subscription, and credit paths', () => {
  assert.match(cloudManagedUsageRecovery('daily_limit_reached'), /00:00 UTC/);
  assert.match(cloudManagedUsageRecovery('monthly_allowance_exhausted'), /billing portal/);
  assert.match(cloudManagedUsageRecovery({ code: 'subscription_inactive' }), /subscription is inactive/);
  assert.match(cloudManagedUsageRecovery('insufficient_quota'), /billing checkout/);
  assert.equal(cloudManagedUsageRecovery('upstream timeout'), null);
});
