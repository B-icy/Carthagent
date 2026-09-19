import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CloudLedger, nanoUsd, validateFinancialMetadata } from '../lib/cloud/ledger.mjs';

const NANO = 1_000_000_000;
function ledger() {
  let next = 0;
  return new CloudLedger({ id: () => `id-${++next}`, clock: () => new Date('2026-01-01T00:00:00.000Z') });
}

test('ledger uses safe integer nano-USD and rejects customer-content metadata', () => {
  assert.equal(nanoUsd(NANO), NANO);
  assert.throws(() => nanoUsd(1.2), /safe integer/);
  assert.throws(() => validateFinancialMetadata({ prompt: 'secret' }), /customer content/);
  assert.throws(() => validateFinancialMetadata({ toolArguments: 'secret' }), /customer content/);
  assert.deepEqual(validateFinancialMetadata({ alias: 'carthagent-fast', inputTokens: 12, success: true }), { alias: 'carthagent-fast', inputTokens: 12, success: true });
});

test('grant and reservation are idempotent and reserve before dispatch', () => {
  const store = ledger();
  store.grant({ accountId: 'acct', amountNanoUsd: 10 * NANO, idempotencyKey: 'grant:1', source: 'trial' });
  store.grant({ accountId: 'acct', amountNanoUsd: 10 * NANO, idempotencyKey: 'grant:1', source: 'trial' });
  assert.equal(store.available('acct'), 10 * NANO);
  const reservation = store.reserve({ accountId: 'acct', maximumNanoUsd: 3 * NANO, idempotencyKey: 'request:1' });
  assert.equal(store.reserve({ accountId: 'acct', maximumNanoUsd: 3 * NANO, idempotencyKey: 'request:1' }).id, reservation.id);
  assert.equal(store.available('acct'), 7 * NANO);
  assert.throws(() => store.reserve({ accountId: 'acct', maximumNanoUsd: 8 * NANO, idempotencyKey: 'request:2' }), /insufficient_credit/);
  store.close();
});

test('settlement charges measured usage and releases unused reservation', () => {
  const store = ledger();
  store.grant({ accountId: 'acct', amountNanoUsd: 10 * NANO, idempotencyKey: 'grant:1' });
  const reservation = store.reserve({ accountId: 'acct', maximumNanoUsd: 4 * NANO, idempotencyKey: 'reserve:1' });
  const charge = store.settle({
    reservationId: reservation.id,
    actualNanoUsd: 1_500_000_000,
    requestId: 'xpl-request-1',
    attemptId: 'xpl-attempt-1',
    idempotencyKey: 'settle:1',
    metadata: { alias: 'carthagent-code', inputTokens: 100, outputTokens: 20, status: 'ok' },
  });
  assert.equal(charge.gateway_request_id, 'xpl-request-1');
  assert.equal(store.available('acct'), 8_500_000_000);
  const entries = store.entries('acct');
  assert.deepEqual(entries.map(entry => entry.kind), ['credit_grant', 'reservation', 'charge', 'reservation_release']);
  assert.equal(entries.find(entry => entry.kind === 'charge').metadata.alias, 'carthagent-code');
  assert.equal(JSON.stringify(entries).includes('prompt'), false);
  assert.equal(store.settle({ reservationId: reservation.id, actualNanoUsd: 1_500_000_000, requestId: 'xpl-request-1', idempotencyKey: 'settle:1' }).id, charge.id);
  store.close();
});

test('failed dispatch releases the complete reservation', () => {
  const store = ledger();
  store.grant({ accountId: 'acct', amountNanoUsd: 2 * NANO, idempotencyKey: 'grant:1' });
  const reservation = store.reserve({ accountId: 'acct', maximumNanoUsd: NANO, idempotencyKey: 'reserve:1' });
  const release = store.release({ reservationId: reservation.id, idempotencyKey: 'release:1' });
  assert.equal(release.amount_nano_usd, NANO);
  assert.equal(store.available('acct'), 2 * NANO);
  assert.equal(store.release({ reservationId: reservation.id, idempotencyKey: 'release:1' }).id, release.id);
  store.close();
});

test('earliest-expiring grants are consumed first', () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  let next = 0;
  const store = new CloudLedger({ id: () => `id-${++next}`, clock: () => now });
  store.grant({ accountId: 'acct', amountNanoUsd: NANO, idempotencyKey: 'later', expiresAt: '2026-03-01T00:00:00.000Z' });
  store.grant({ accountId: 'acct', amountNanoUsd: NANO, idempotencyKey: 'sooner', expiresAt: '2026-02-01T00:00:00.000Z' });
  const reservation = store.reserve({ accountId: 'acct', maximumNanoUsd: 1_500_000_000, idempotencyKey: 'reserve' });
  store.settle({ reservationId: reservation.id, actualNanoUsd: 1_500_000_000, requestId: 'request', idempotencyKey: 'settle' });
  now = new Date('2026-02-15T00:00:00.000Z');
  assert.equal(store.available('acct'), 500_000_000);
  store.close();
});
