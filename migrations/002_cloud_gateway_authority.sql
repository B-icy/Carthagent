-- Versioned Carthagent Cloud aliases, customer pricing, and hosted-request
-- reconciliation records. Prices and charges are integer nano-USD.
CREATE TABLE cloud_pricing_versions (
  id TEXT PRIMARY KEY,
  input_nano_usd_per_million_tokens INTEGER NOT NULL CHECK(input_nano_usd_per_million_tokens >= 0),
  output_nano_usd_per_million_tokens INTEGER NOT NULL CHECK(output_nano_usd_per_million_tokens >= 0),
  fixed_request_nano_usd INTEGER NOT NULL CHECK(fixed_request_nano_usd >= 0),
  created_at TEXT NOT NULL
);
CREATE TABLE cloud_model_aliases (
  alias TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  current_revision_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE cloud_model_alias_revisions (
  id TEXT PRIMARY KEY,
  alias TEXT NOT NULL REFERENCES cloud_model_aliases(alias),
  upstream_alias TEXT NOT NULL,
  pricing_version_id TEXT NOT NULL REFERENCES cloud_pricing_versions(id),
  max_input_tokens INTEGER NOT NULL,
  default_max_output_tokens INTEGER NOT NULL,
  max_output_tokens INTEGER NOT NULL,
  maximum_attempts INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(alias, id)
);
CREATE TABLE cloud_gateway_requests (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  operation_key TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  alias TEXT NOT NULL,
  alias_revision_id TEXT NOT NULL,
  pricing_version_id TEXT NOT NULL,
  reservation_id TEXT REFERENCES reservations(id),
  state TEXT NOT NULL,
  gateway_request_id TEXT UNIQUE,
  customer_charge_nano_usd INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  terminal_state TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, operation_key)
);
CREATE TABLE cloud_gateway_attempts (
  gateway_request_row_id TEXT NOT NULL REFERENCES cloud_gateway_requests(id),
  attempt_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  PRIMARY KEY(gateway_request_row_id, attempt_id)
);
