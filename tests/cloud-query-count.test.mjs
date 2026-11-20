import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CloudLedger } from '../lib/cloud/ledger.mjs';
import { CloudControlPlane } from '../lib/cloud/control-plane.mjs';
import { CloudGatewayAuthority } from '../lib/cloud/gateway.mjs';
import { countQueries, normalizeSql } from './helpers/sql-query-counter.mjs';

const SMALL = 1;
const LARGE = 50;
const NOW = new Date('2026-01-01T00:00:00.000Z');

function cloud() {
  let next = 0;
  const id = () => `id-${String(++next).padStart(4, '0')}`;
  const ledger = new CloudLedger({ id, clock: () => NOW });
  const control = new CloudControlPlane({ ledger, id, clock: () => NOW, tokenSecret: 'query-count-secret', random: size => Buffer.alloc(size, next % 251) });
  const gateway = new CloudGatewayAuthority({ control, ledger, id, clock: () => NOW });
  const { accountId } = control.createUserAccount({ email: 'budget@example.com' });
  return { ledger, control, gateway, accountId, counter: countQueries(ledger.db) };
}

function seeded(rows) {
  const fixture = cloud();
  const { ledger, control, gateway, accountId } = fixture;
  gateway.publishPricing({ id: 'price', inputNanoUsdPerMillionTokens: 1, outputNanoUsdPerMillionTokens: 1 });
  for (let index = 0; index < rows; index++) {
    ledger.grant({ accountId, amountNanoUsd: 1_000, idempotencyKey: `grant:${index}` });
    ledger.appendEntry({ accountId, kind: 'charge', amountNanoUsd: -1, idempotencyKey: `charge:${index}`, metadata: { alias: 'model', inputTokens: 1 } });
    fixture.tokens = control.issueSession(accountId);
    gateway.publishAlias({
      alias: `model-${index}`,
      displayName: `Model ${index}`,
      upstreamAlias: 'upstream',
      pricingVersionId: 'price',
      maxInputTokens: 10,
      defaultMaxOutputTokens: 10,
      maxOutputTokens: 10,
    });
  }
  ledger.db
    .prepare(
      `INSERT INTO cloud_gateway_requests (id, account_id, operation_key, endpoint, alias, alias_revision_id, pricing_version_id, state, created_at, updated_at)
      VALUES ('request', ?, 'operation', 'chat.completions', 'model-0', 'revision', 'price', 'settled', ?, ?)`,
    )
    .run(accountId, NOW.toISOString(), NOW.toISOString());
  const attempt = ledger.db.prepare(
    `INSERT INTO cloud_gateway_attempts (gateway_request_row_id, attempt_id, state, input_tokens, output_tokens) VALUES ('request', ?, 'completed', 1, 1)`,
  );
  for (let index = 0; index < rows; index++) attempt.run(`attempt-${index}`);
  return fixture;
}

const READ_PATHS = {
  'ledger.available': ({ ledger, accountId }) => ledger.available(accountId),
  'ledger.entries': ({ ledger, accountId }) => ledger.entries(accountId),
  'control.account': ({ control, accountId }) => control.account(accountId),
  'control.grants': ({ control, accountId }) => control.grants(accountId),
  'control.usage': ({ control, accountId }) => control.usage(accountId, { limit: 200 }),
  'control.listSessions': ({ control, accountId }) => control.listSessions(accountId),
  'control.subscription': ({ control, accountId }) => control.subscription(accountId),
  'control.verifyAccessToken': ({ control, tokens }) => control.verifyAccessToken(tokens.accessToken, 'account:read'),
  'gateway.models': ({ gateway }) => gateway.models(),
  'gateway.resolveAlias': ({ gateway }) => gateway.resolveAlias('model-0'),
  'gateway.request': ({ gateway }) => gateway.request('request'),
};

// Statement budgets per call. Raising one needs a reason, not just a new number.
const READ_BUDGETS = {
  'ledger.available': 1,
  'ledger.entries': 1,
  'control.account': 5,
  'control.grants': 1,
  'control.usage': 1,
  'control.listSessions': 1,
  'control.subscription': 1,
  'control.verifyAccessToken': 2,
  'gateway.models': 1,
  'gateway.resolveAlias': 1,
  'gateway.request': 2,
};

function growth(small, large) {
  const keys = new Set([...Object.keys(small.statements), ...Object.keys(large.statements)]);
  return Object.fromEntries([...keys].map(sql => [sql, (large.statements[sql] ?? 0) - (small.statements[sql] ?? 0)]).filter(([, delta]) => delta !== 0));
}

test('the query counter counts executions by normalized SQL and restores the database', () => {
  const { ledger, counter } = cloud();
  const statement = ledger.db.prepare('SELECT   1 AS one\n  WHERE 1 = ?');
  const { total, statements } = counter.measure(() => {
    statement.get(1);
    statement.all(1);
    ledger.db.exec('SELECT 2');
  });
  assert.equal(total, 3);
  assert.deepEqual(statements, { 'SELECT 1 AS one WHERE 1 = ?': 2, 'SELECT 2': 1 });
  assert.equal(normalizeSql(' a\n\tb '), 'a b');
  counter.restore();
  ledger.db.prepare('SELECT 3').get();
  ledger.db.exec('SELECT 4');
  assert.equal(counter.total, 3);
});

test('cloud read paths execute a constant, budgeted number of statements regardless of row count', () => {
  const small = seeded(SMALL);
  const large = seeded(LARGE);
  assert.equal(large.control.listSessions(large.accountId).length, LARGE);
  assert.equal(large.control.grants(large.accountId).length, LARGE);
  assert.equal(large.control.usage(large.accountId, { limit: 200 }).length, LARGE);
  assert.equal(large.gateway.request('request').attempts.length, LARGE);
  assert.equal(large.gateway.models().length, LARGE);
  for (const [name, read] of Object.entries(READ_PATHS)) {
    const few = small.counter.measure(() => read(small));
    const many = large.counter.measure(() => read(large));
    assert.deepEqual(growth(few, many), {}, `${name} must not issue per-row statements`);
    assert.equal(many.total, READ_BUDGETS[name], `${name} statement budget: ${JSON.stringify(many.statements)}`);
  }
});

function ledgerWithGrants(count) {
  const fixture = cloud();
  for (let index = 0; index < count; index++) fixture.ledger.grant({ accountId: fixture.accountId, amountNanoUsd: 10, idempotencyKey: `grant:${index}` });
  return fixture;
}

const CREDIT_GRANT_DEBIT = 'UPDATE credit_grants SET remaining_nano_usd = remaining_nano_usd - ? WHERE id = ?';
const CREDIT_GRANT_REFUND = 'UPDATE credit_grants SET remaining_nano_usd = remaining_nano_usd + ? WHERE id = ?';
const ALLOCATION_INSERT = 'INSERT INTO reservation_allocations (reservation_id, grant_id, reserved_nano_usd) VALUES (?, ?, ?)';
const ALLOCATION_CONSUME = 'UPDATE reservation_allocations SET consumed_nano_usd = ? WHERE reservation_id = ? AND grant_id = ?';

function reservationAcross(grants, { settle, release } = {}) {
  const fixture = ledgerWithGrants(grants);
  const { ledger, accountId, counter } = fixture;
  const reserved = counter.measure(() => ledger.reserve({ accountId, maximumNanoUsd: grants * 10, idempotencyKey: 'reservation' }));
  if (settle)
    return counter.measure(() => ledger.settle({ reservationId: reserved.result.id, actualNanoUsd: 5, requestId: 'request', idempotencyKey: 'settle' }));
  if (release) return counter.measure(() => ledger.release({ reservationId: reserved.result.id, idempotencyKey: 'release' }));
  return reserved;
}

test('ledger writes scale only with the grants a reservation spans, by design', () => {
  const delta = LARGE - SMALL;
  assert.deepEqual(
    growth(reservationAcross(SMALL), reservationAcross(LARGE)),
    { [CREDIT_GRANT_DEBIT]: delta, [ALLOCATION_INSERT]: delta },
    'reserve debits and allocates once per spanned grant; everything else is constant',
  );
  assert.deepEqual(
    growth(reservationAcross(SMALL, { settle: true }), reservationAcross(LARGE, { settle: true })),
    { [ALLOCATION_CONSUME]: delta, [CREDIT_GRANT_REFUND]: delta },
    'settle consumes each allocation and refunds the unused part of each spanned grant',
  );
  assert.deepEqual(
    growth(reservationAcross(SMALL, { release: true }), reservationAcross(LARGE, { release: true })),
    { [CREDIT_GRANT_REFUND]: delta },
    'release refunds each spanned grant once',
  );
});

test('ledger grants and trial claims execute a constant number of statements', () => {
  const few = ledgerWithGrants(SMALL);
  const many = ledgerWithGrants(LARGE);
  const grant = fixture => fixture.counter.measure(() => fixture.ledger.grant({ accountId: fixture.accountId, amountNanoUsd: 10, idempotencyKey: 'next' }));
  assert.deepEqual(growth(grant(few), grant(many)), {});
  const claim = fixture => fixture.counter.measure(() => fixture.control.claimTrial(fixture.accountId));
  assert.deepEqual(growth(claim(few), claim(many)), {});
});
