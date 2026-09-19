-- Reference schema for the Carthagent Cloud financial authority.
-- Application tests use node:sqlite; production may apply the same constraints
-- to a managed SQL database. All monetary values are integer nano-USD.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE TABLE credit_grants (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  original_nano_usd INTEGER NOT NULL CHECK(original_nano_usd > 0),
  remaining_nano_usd INTEGER NOT NULL CHECK(remaining_nano_usd >= 0),
  expires_at TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE reservations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  requested_nano_usd INTEGER NOT NULL CHECK(requested_nano_usd > 0),
  status TEXT NOT NULL CHECK(status IN ('open','settled','released')),
  request_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  settled_at TEXT
);
CREATE TABLE reservation_allocations (
  reservation_id TEXT NOT NULL REFERENCES reservations(id),
  grant_id TEXT NOT NULL REFERENCES credit_grants(id),
  reserved_nano_usd INTEGER NOT NULL CHECK(reserved_nano_usd > 0),
  consumed_nano_usd INTEGER NOT NULL DEFAULT 0 CHECK(consumed_nano_usd >= 0),
  PRIMARY KEY(reservation_id, grant_id)
);
CREATE TABLE ledger_entries (
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
