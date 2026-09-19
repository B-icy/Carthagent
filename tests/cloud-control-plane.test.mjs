import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { CloudLedger } from '../lib/cloud/ledger.mjs';
import { CLOUD_PLAN, CloudControlPlane, verifyStripeSignature } from '../lib/cloud/control-plane.mjs';

function fixture(overrides = {}) {
  let id = 0;
  let random = 0;
  const now = new Date('2026-01-01T00:00:00.000Z');
  const ledger = new CloudLedger({ id: () => `ledger-${++id}`, clock: () => now });
  const control = new CloudControlPlane({
    ledger, clock: () => now, id: () => `control-${++id}`,
    random: size => Buffer.alloc(size, ++random), tokenSecret: 'test-token-secret',
    publicUrl: 'https://cloud.test', ...overrides,
  });
  return { control, ledger, now };
}

test('device authorization approves once, grants trial once, and issues scoped rotating tokens', () => {
  const { control, ledger } = fixture();
  const account = control.createUserAccount({ email: 'user@example.com' });
  const device = control.createDeviceAuthorization({ clientName: 'laptop' });
  assert.equal(device.verificationUri, 'https://cloud.test/activate');
  assert.throws(() => control.pollDeviceToken({ deviceCode: device.deviceCode }), /authorization_pending/);
  assert.deepEqual(control.approveDeviceAuthorization({ userCode: device.userCode, accountId: account.accountId }), { approved: true, clientName: 'laptop' });
  assert.equal(ledger.available(account.accountId), CLOUD_PLAN.trialNanoUsd);
  const tokens = control.pollDeviceToken({ deviceCode: device.deviceCode });
  const claims = control.verifyAccessToken(tokens.accessToken, 'gateway:invoke');
  assert.equal(claims.sub, account.accountId);
  assert.throws(() => control.pollDeviceToken({ deviceCode: device.deviceCode }), /invalid_grant/);
  const refreshed = control.refreshSession({ refreshToken: tokens.refreshToken });
  assert.notEqual(refreshed.refreshToken, tokens.refreshToken);
  assert.throws(() => control.refreshSession({ refreshToken: tokens.refreshToken }), /invalid_grant/);
  control.revokeSession({ sessionId: claims.sid });
  assert.throws(() => control.verifyAccessToken(refreshed.accessToken), /revoked_token/);
  assert.equal(control.claimTrial(account.accountId).claimed, false);
});

test('device denial does not create a session or grant', () => {
  const { control, ledger } = fixture();
  const account = control.createUserAccount({ email: 'deny@example.com' });
  const device = control.createDeviceAuthorization();
  control.approveDeviceAuthorization({ userCode: device.userCode, accountId: account.accountId, approve: false });
  assert.throws(() => control.pollDeviceToken({ deviceCode: device.deviceCode }), /access_denied/);
  assert.equal(ledger.available(account.accountId), 0);
});

test('Stripe signatures are verified with timestamp tolerance', () => {
  const payload = '{"id":"evt_1"}';
  const timestamp = 1_767_225_600;
  const secret = 'whsec_test';
  const digest = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  assert.equal(verifyStripeSignature(payload, `t=${timestamp},v1=${digest}`, secret, { now: timestamp * 1000 }), true);
  assert.throws(() => verifyStripeSignature(payload, `t=${timestamp},v1=bad`, secret, { now: timestamp * 1000 }), /Invalid Stripe signature/);
});

test('authoritative invoice webhook grants Builder credit exactly once', () => {
  const secret = 'whsec_test';
  const { control, ledger } = fixture({ stripeWebhookSecret: secret, stripePriceId: 'price_builder' });
  const account = control.createUserAccount({ email: 'builder@example.com' });
  const event = {
    id: 'evt_invoice_1', type: 'invoice.paid', data: { object: {
      id: 'in_1', customer: 'cus_1', subscription: 'sub_1', period_start: 1_767_225_600,
      period_end: 1_769_904_000, metadata: { accountId: account.accountId },
    } },
  };
  const payload = JSON.stringify(event);
  const timestamp = 1_767_225_600;
  const signature = `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')}`;
  assert.deepEqual(control.handleStripeWebhook({ payload, signature }), { duplicate: false, processed: true });
  assert.deepEqual(control.handleStripeWebhook({ payload, signature }), { duplicate: true });
  assert.equal(ledger.available(account.accountId), CLOUD_PLAN.builderMonthlyNanoUsd);
  assert.equal(control.subscription(account.accountId).status, 'active');
});

test('Checkout and portal use server-owned plan and customer references', async () => {
  const calls = [];
  const stripe = {
    createCheckoutSession: async input => { calls.push(['checkout', input]); return { id: 'cs_1', url: 'https://checkout.test' }; },
    createPortalSession: async input => { calls.push(['portal', input]); return { id: 'bps_1', url: 'https://portal.test' }; },
  };
  const { control } = fixture({ stripe, stripePriceId: 'price_server_owned' });
  const account = control.createUserAccount({ email: 'pay@example.com' });
  const checkout = await control.createCheckout({ accountId: account.accountId, successUrl: 'https://app/success', cancelUrl: 'https://app/cancel' });
  assert.equal(checkout.url, 'https://checkout.test');
  assert.equal(calls[0][1].line_items[0].price, 'price_server_owned');
  control.upsertSubscription(account.accountId, { id: 'sub_1', customer: 'cus_1', status: 'active' });
  const portal = await control.createPortal({ accountId: account.accountId, returnUrl: 'https://app/account' });
  assert.equal(portal.url, 'https://portal.test');
  assert.equal(calls[1][1].customer, 'cus_1');
});
