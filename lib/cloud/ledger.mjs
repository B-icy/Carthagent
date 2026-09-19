import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const ENTRY_KINDS = new Set(['credit_grant', 'reservation', 'charge', 'reservation_release', 'refund', 'adjustment']);
const FORBIDDEN_METADATA = /prompt|response|source|code|tool|argument|content|message/i;

export function nanoUsd(value, name = 'amountNanoUsd') {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${name} must be a safe integer nano-USD amount`);
  return value;
}

export function validateFinancialMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new TypeError('metadata must be an object');
  const clean = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_METADATA.test(key)) throw new Error(`financial metadata must not contain customer content (${key})`);
    if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) throw new TypeError(`financial metadata value ${key} must be scalar`);
    clean[key] = value;
  }
  return clean;
}

export function openLedger(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS credit_grants (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      original_nano_usd INTEGER NOT NULL CHECK(original_nano_usd > 0),
      remaining_nano_usd INTEGER NOT NULL CHECK(remaining_nano_usd >= 0),
      expires_at TEXT,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS credit_grants_spendable ON credit_grants(account_id, expires_at, created_at);
    CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      idempotency_key TEXT NOT NULL UNIQUE,
      requested_nano_usd INTEGER NOT NULL CHECK(requested_nano_usd > 0),
      status TEXT NOT NULL CHECK(status IN ('open','settled','released')),
      request_id TEXT UNIQUE,
      created_at TEXT NOT NULL,
      settled_at TEXT
    );
    CREATE TABLE IF NOT EXISTS reservation_allocations (
      reservation_id TEXT NOT NULL REFERENCES reservations(id),
      grant_id TEXT NOT NULL REFERENCES credit_grants(id),
      reserved_nano_usd INTEGER NOT NULL CHECK(reserved_nano_usd > 0),
      consumed_nano_usd INTEGER NOT NULL DEFAULT 0 CHECK(consumed_nano_usd >= 0),
      PRIMARY KEY(reservation_id, grant_id)
    );
    CREATE TABLE IF NOT EXISTS ledger_entries (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      kind TEXT NOT NULL,
      amount_nano_usd INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      reservation_id TEXT REFERENCES reservations(id),
      gateway_request_id TEXT,
      gateway_attempt_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

export class CloudLedger {
  constructor({ path = ':memory:', clock = () => new Date(), id = randomUUID } = {}) {
    this.db = openLedger(path);
    this.clock = clock;
    this.id = id;
  }

  now() { return this.clock().toISOString(); }
  close() { this.db.close(); }

  createAccount(accountId = this.id()) {
    this.db.prepare('INSERT OR IGNORE INTO accounts (id, created_at) VALUES (?, ?)').run(accountId, this.now());
    return accountId;
  }

  entryByKey(key) {
    return this.db.prepare('SELECT * FROM ledger_entries WHERE idempotency_key = ?').get(key);
  }

  appendEntry({ accountId, kind, amountNanoUsd, idempotencyKey, reservationId = null, gatewayRequestId = null, gatewayAttemptId = null, metadata = {} }) {
    if (!ENTRY_KINDS.has(kind)) throw new Error(`unknown ledger entry kind: ${kind}`);
    nanoUsd(amountNanoUsd);
    if (!idempotencyKey) throw new Error('idempotencyKey is required');
    const cleanMetadata = validateFinancialMetadata(metadata);
    const existing = this.entryByKey(idempotencyKey);
    if (existing) return existing;
    const id = this.id();
    this.db.prepare(`INSERT INTO ledger_entries
      (id, account_id, kind, amount_nano_usd, idempotency_key, reservation_id, gateway_request_id, gateway_attempt_id, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, accountId, kind, amountNanoUsd, idempotencyKey, reservationId, gatewayRequestId, gatewayAttemptId, JSON.stringify(cleanMetadata), this.now()
    );
    return this.db.prepare('SELECT * FROM ledger_entries WHERE id = ?').get(id);
  }

  grant({ accountId, amountNanoUsd, idempotencyKey, expiresAt = null, source = 'manual', metadata = {} }) {
    nanoUsd(amountNanoUsd);
    if (amountNanoUsd <= 0) throw new Error('grant amount must be positive');
    this.createAccount(accountId);
    const existing = this.entryByKey(idempotencyKey);
    if (existing) return existing;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const grantId = this.id();
      this.db.prepare(`INSERT INTO credit_grants
        (id, account_id, original_nano_usd, remaining_nano_usd, expires_at, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(grantId, accountId, amountNanoUsd, amountNanoUsd, expiresAt, source, this.now());
      const entry = this.appendEntry({ accountId, kind: 'credit_grant', amountNanoUsd, idempotencyKey, metadata: { ...metadata, grantId } });
      this.db.exec('COMMIT');
      return entry;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  available(accountId, at = this.now()) {
    const row = this.db.prepare(`SELECT COALESCE(SUM(remaining_nano_usd), 0) AS balance
      FROM credit_grants WHERE account_id = ? AND remaining_nano_usd > 0 AND (expires_at IS NULL OR expires_at > ?)`).get(accountId, at);
    return Number(row.balance);
  }

  reserve({ accountId, maximumNanoUsd, idempotencyKey }) {
    nanoUsd(maximumNanoUsd, 'maximumNanoUsd');
    if (maximumNanoUsd <= 0) throw new Error('reservation amount must be positive');
    const existing = this.db.prepare('SELECT * FROM reservations WHERE idempotency_key = ?').get(idempotencyKey);
    if (existing) return existing;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const grants = this.db.prepare(`SELECT * FROM credit_grants
        WHERE account_id = ? AND remaining_nano_usd > 0 AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at, created_at, id`).all(accountId, this.now());
      if (grants.reduce((sum, grant) => sum + Number(grant.remaining_nano_usd), 0) < maximumNanoUsd) throw new Error('insufficient_credit');
      const reservationId = this.id();
      this.db.prepare(`INSERT INTO reservations
        (id, account_id, idempotency_key, requested_nano_usd, status, created_at)
        VALUES (?, ?, ?, ?, 'open', ?)`).run(reservationId, accountId, idempotencyKey, maximumNanoUsd, this.now());
      let remaining = maximumNanoUsd;
      for (const grant of grants) {
        if (!remaining) break;
        const amount = Math.min(remaining, Number(grant.remaining_nano_usd));
        this.db.prepare('UPDATE credit_grants SET remaining_nano_usd = remaining_nano_usd - ? WHERE id = ?').run(amount, grant.id);
        this.db.prepare('INSERT INTO reservation_allocations (reservation_id, grant_id, reserved_nano_usd) VALUES (?, ?, ?)').run(reservationId, grant.id, amount);
        remaining -= amount;
      }
      this.appendEntry({ accountId, kind: 'reservation', amountNanoUsd: -maximumNanoUsd, idempotencyKey: `reservation:${idempotencyKey}`, reservationId });
      this.db.exec('COMMIT');
      return this.db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  settle({ reservationId, actualNanoUsd, requestId, attemptId = null, idempotencyKey, metadata = {} }) {
    nanoUsd(actualNanoUsd, 'actualNanoUsd');
    if (actualNanoUsd < 0) throw new Error('actual charge cannot be negative');
    const existing = this.entryByKey(idempotencyKey);
    if (existing) return existing;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const reservation = this.db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
      if (!reservation) throw new Error('reservation_not_found');
      if (reservation.status !== 'open') throw new Error(`reservation_${reservation.status}`);
      if (actualNanoUsd > reservation.requested_nano_usd) throw new Error('charge_exceeds_reservation');
      const allocations = this.db.prepare('SELECT * FROM reservation_allocations WHERE reservation_id = ? ORDER BY rowid').all(reservationId);
      let chargeRemaining = actualNanoUsd;
      let released = 0;
      for (const allocation of allocations) {
        const consumed = Math.min(chargeRemaining, Number(allocation.reserved_nano_usd));
        const release = Number(allocation.reserved_nano_usd) - consumed;
        this.db.prepare('UPDATE reservation_allocations SET consumed_nano_usd = ? WHERE reservation_id = ? AND grant_id = ?').run(consumed, reservationId, allocation.grant_id);
        if (release) this.db.prepare('UPDATE credit_grants SET remaining_nano_usd = remaining_nano_usd + ? WHERE id = ?').run(release, allocation.grant_id);
        chargeRemaining -= consumed;
        released += release;
      }
      const entry = this.appendEntry({ accountId: reservation.account_id, kind: 'charge', amountNanoUsd: -actualNanoUsd, idempotencyKey, reservationId, gatewayRequestId: requestId, gatewayAttemptId: attemptId, metadata });
      if (released) this.appendEntry({ accountId: reservation.account_id, kind: 'reservation_release', amountNanoUsd: released, idempotencyKey: `release:${idempotencyKey}`, reservationId, gatewayRequestId: requestId });
      this.db.prepare(`UPDATE reservations SET status = 'settled', request_id = ?, settled_at = ? WHERE id = ?`).run(requestId, this.now(), reservationId);
      this.db.exec('COMMIT');
      return entry;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  release({ reservationId, idempotencyKey }) {
    const existing = this.entryByKey(idempotencyKey);
    if (existing) return existing;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const reservation = this.db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
      if (!reservation) throw new Error('reservation_not_found');
      if (reservation.status !== 'open') throw new Error(`reservation_${reservation.status}`);
      const allocations = this.db.prepare('SELECT * FROM reservation_allocations WHERE reservation_id = ?').all(reservationId);
      for (const allocation of allocations) this.db.prepare('UPDATE credit_grants SET remaining_nano_usd = remaining_nano_usd + ? WHERE id = ?').run(allocation.reserved_nano_usd, allocation.grant_id);
      const entry = this.appendEntry({ accountId: reservation.account_id, kind: 'reservation_release', amountNanoUsd: reservation.requested_nano_usd, idempotencyKey, reservationId });
      this.db.prepare(`UPDATE reservations SET status = 'released', settled_at = ? WHERE id = ?`).run(this.now(), reservationId);
      this.db.exec('COMMIT');
      return entry;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  entries(accountId) {
    return this.db.prepare('SELECT * FROM ledger_entries WHERE account_id = ? ORDER BY created_at, rowid').all(accountId).map(row => ({ ...row, metadata: JSON.parse(row.metadata_json) }));
  }
}
