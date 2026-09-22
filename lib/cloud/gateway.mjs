import { randomUUID } from 'node:crypto';
import { nanoUsd } from './ledger.mjs';

const MILLION = 1_000_000n;
const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled', 'incomplete']);
const SAFE_RESPONSE_HEADERS = new Set([
  'content-type', 'retry-after', 'x-request-id', 'x-client-request-id',
  'x-gateway-alias', 'x-gateway-alias-revision', 'x-gateway-canonical-model',
  'x-gateway-provider', 'x-gateway-deployment', 'x-gateway-route-depth',
  'x-gateway-route-reason', 'x-gateway-replay-repair', 'x-gateway-zdr-constrained',
]);

const integer = (value, name, { minimum = 0 } = {}) => {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`${name} must be a safe integer >= ${minimum}`);
  return value;
};

const text = (value, name, maximum = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new TypeError(`${name} must be a non-empty string up to ${maximum} characters`);
  return value.trim();
};

function exactReplay(existing, candidate, fields, label) {
  for (const field of fields) if (existing[field] !== candidate[field]) throw new Error(`${label}_immutable_conflict`);
  return existing;
}

export function tokenChargeNanoUsd(tokens, rateNanoUsdPerMillionTokens) {
  integer(tokens, 'tokens');
  nanoUsd(rateNanoUsdPerMillionTokens, 'rateNanoUsdPerMillionTokens');
  if (rateNanoUsdPerMillionTokens < 0) throw new Error('token price cannot be negative');
  const charge = (BigInt(tokens) * BigInt(rateNanoUsdPerMillionTokens) + MILLION - 1n) / MILLION;
  if (charge > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('calculated charge exceeds safe integer range');
  return Number(charge);
}

export function customerChargeNanoUsd(pricing, attempts) {
  const fixed = nanoUsd(Number(pricing.fixed_request_nano_usd), 'fixedRequestNanoUsd');
  let charge = fixed;
  for (const attempt of attempts) {
    charge += tokenChargeNanoUsd(attempt.inputTokens, Number(pricing.input_nano_usd_per_million_tokens));
    charge += tokenChargeNanoUsd(attempt.outputTokens, Number(pricing.output_nano_usd_per_million_tokens));
    if (!Number.isSafeInteger(charge)) throw new Error('calculated charge exceeds safe integer range');
  }
  return charge;
}

export function estimateInputTokens(body) {
  // A token cannot contain more bytes than the complete encoded request. Using
  // UTF-8 bytes therefore deliberately over-reserves without interpreting or
  // retaining customer content.
  return Buffer.byteLength(JSON.stringify(body), 'utf8');
}

export function boundedGatewayRequest(endpoint, body, revision) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid_request_body');
  if (body.model !== revision.alias) throw new Error('model_not_found');
  const request = structuredClone(body);
  const inputTokens = estimateInputTokens(request);
  if (inputTokens > Number(revision.max_input_tokens)) throw new Error('request_too_large');

  const outputField = endpoint === 'responses' ? 'max_output_tokens'
    : Object.hasOwn(request, 'max_completion_tokens') ? 'max_completion_tokens' : 'max_tokens';
  const supplied = request[outputField];
  const outputTokens = supplied === undefined
    ? Number(revision.default_max_output_tokens)
    : integer(supplied, outputField, { minimum: 1 });
  if (outputTokens > Number(revision.max_output_tokens)) throw new Error('max_output_tokens_exceeded');
  request[outputField] = outputTokens;
  request.model = revision.upstream_alias;
  return { request, inputTokens, outputTokens };
}

export class GatewayDispatchError extends Error {
  constructor(message, { outcome = 'unknown', cause } = {}) {
    super(message, { cause });
    this.name = 'GatewayDispatchError';
    this.outcome = outcome;
  }
}

export class ExperientialGatewayClient {
  constructor({
    baseUrl = process.env.EXP_GATEWAY_URL || 'https://api.experientiallabs.ai/v1',
    apiKey = process.env.EXPLABS_API_KEY || '',
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
  }

  async dispatch({ endpoint, body, operationKey, clientRequestId, signal }) {
    if (!this.apiKey) throw new GatewayDispatchError('Upstream gateway credential is not configured', { outcome: 'not_dispatched' });
    if (typeof this.fetch !== 'function') throw new GatewayDispatchError('Gateway dispatch requires fetch support', { outcome: 'not_dispatched' });
    try {
      return await this.fetch(`${this.baseUrl}/${endpoint === 'responses' ? 'responses' : 'chat/completions'}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
          'idempotency-key': operationKey,
          'x-client-request-id': clientRequestId,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (cause) {
      // Once fetch begins a POST, a transport failure cannot prove that the
      // gateway or provider did not execute it. Keep the reservation held.
      throw new GatewayDispatchError('Upstream gateway outcome is unknown', { outcome: 'unknown', cause });
    }
  }
}

export function pendingSettlementSource() {
  return {
    // The upstream OpenAI-compatible response contract currently
    // exposes the gateway request ID, but not every physical attempt identity.
    // Never infer attempts or charges from an HTTP success or client-visible
    // usage alone; deployers must inject an authoritative accounting resolver.
    async resolve() { return { status: 'pending' }; },
  };
}

export class CloudGatewayAuthority {
  constructor({
    control,
    ledger = control?.ledger,
    upstream = new ExperientialGatewayClient(),
    settlementSource = pendingSettlementSource(),
    id = randomUUID,
    clock = () => new Date(),
  } = {}) {
    if (!control || !ledger) throw new TypeError('control and ledger are required');
    this.control = control;
    this.ledger = ledger;
    this.db = ledger.db;
    this.upstream = upstream;
    this.settlementSource = settlementSource;
    this.id = id;
    this.clock = clock;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cloud_pricing_versions (
        id TEXT PRIMARY KEY,
        input_nano_usd_per_million_tokens INTEGER NOT NULL CHECK(input_nano_usd_per_million_tokens >= 0),
        output_nano_usd_per_million_tokens INTEGER NOT NULL CHECK(output_nano_usd_per_million_tokens >= 0),
        fixed_request_nano_usd INTEGER NOT NULL CHECK(fixed_request_nano_usd >= 0),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cloud_model_aliases (
        alias TEXT PRIMARY KEY, display_name TEXT NOT NULL, current_revision_id TEXT, active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cloud_model_alias_revisions (
        id TEXT PRIMARY KEY, alias TEXT NOT NULL REFERENCES cloud_model_aliases(alias), upstream_alias TEXT NOT NULL,
        pricing_version_id TEXT NOT NULL REFERENCES cloud_pricing_versions(id), max_input_tokens INTEGER NOT NULL,
        default_max_output_tokens INTEGER NOT NULL, max_output_tokens INTEGER NOT NULL, maximum_attempts INTEGER NOT NULL,
        created_at TEXT NOT NULL, UNIQUE(alias, id)
      );
      CREATE TABLE IF NOT EXISTS cloud_gateway_requests (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), operation_key TEXT NOT NULL,
        endpoint TEXT NOT NULL, alias TEXT NOT NULL, alias_revision_id TEXT NOT NULL, pricing_version_id TEXT NOT NULL,
        reservation_id TEXT REFERENCES reservations(id), state TEXT NOT NULL,
        gateway_request_id TEXT UNIQUE, customer_charge_nano_usd INTEGER, input_tokens INTEGER, output_tokens INTEGER,
        terminal_state TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(account_id, operation_key)
      );
      CREATE TABLE IF NOT EXISTS cloud_gateway_attempts (
        gateway_request_row_id TEXT NOT NULL REFERENCES cloud_gateway_requests(id), attempt_id TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
        PRIMARY KEY(gateway_request_row_id, attempt_id)
      );
    `);
  }

  now() { return this.clock().toISOString(); }

  publishPricing({ id = this.id(), inputNanoUsdPerMillionTokens, outputNanoUsdPerMillionTokens, fixedRequestNanoUsd = 0 }) {
    const candidate = {
      id: text(id, 'pricing id'),
      input_nano_usd_per_million_tokens: integer(inputNanoUsdPerMillionTokens, 'inputNanoUsdPerMillionTokens'),
      output_nano_usd_per_million_tokens: integer(outputNanoUsdPerMillionTokens, 'outputNanoUsdPerMillionTokens'),
      fixed_request_nano_usd: integer(fixedRequestNanoUsd, 'fixedRequestNanoUsd'),
    };
    const existing = this.db.prepare('SELECT * FROM cloud_pricing_versions WHERE id = ?').get(candidate.id);
    if (existing) return exactReplay(existing, candidate, ['input_nano_usd_per_million_tokens', 'output_nano_usd_per_million_tokens', 'fixed_request_nano_usd'], 'pricing_version');
    this.db.prepare(`INSERT INTO cloud_pricing_versions
      (id, input_nano_usd_per_million_tokens, output_nano_usd_per_million_tokens, fixed_request_nano_usd, created_at)
      VALUES (?, ?, ?, ?, ?)`).run(candidate.id, candidate.input_nano_usd_per_million_tokens, candidate.output_nano_usd_per_million_tokens, candidate.fixed_request_nano_usd, this.now());
    return this.db.prepare('SELECT * FROM cloud_pricing_versions WHERE id = ?').get(candidate.id);
  }

  publishAlias({
    alias, displayName, upstreamAlias, pricingVersionId, revisionId = this.id(),
    maxInputTokens, defaultMaxOutputTokens, maxOutputTokens, maximumAttempts = 1, active = true,
  }) {
    alias = text(alias, 'alias');
    const pricing = this.db.prepare('SELECT * FROM cloud_pricing_versions WHERE id = ?').get(pricingVersionId);
    if (!pricing) throw new Error('pricing_version_not_found');
    const revision = {
      id: text(revisionId, 'revision id'), alias, upstream_alias: text(upstreamAlias, 'upstreamAlias'),
      pricing_version_id: pricingVersionId,
      max_input_tokens: integer(maxInputTokens, 'maxInputTokens', { minimum: 1 }),
      default_max_output_tokens: integer(defaultMaxOutputTokens, 'defaultMaxOutputTokens', { minimum: 1 }),
      max_output_tokens: integer(maxOutputTokens, 'maxOutputTokens', { minimum: 1 }),
      maximum_attempts: integer(maximumAttempts, 'maximumAttempts', { minimum: 1 }),
    };
    if (revision.default_max_output_tokens > revision.max_output_tokens) throw new Error('default output limit exceeds maximum');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`INSERT OR IGNORE INTO cloud_model_aliases (alias, display_name, active, created_at) VALUES (?, ?, ?, ?)`)
        .run(alias, text(displayName, 'displayName'), active ? 1 : 0, this.now());
      const existing = this.db.prepare('SELECT * FROM cloud_model_alias_revisions WHERE id = ?').get(revision.id);
      if (existing) exactReplay(existing, revision, ['alias', 'upstream_alias', 'pricing_version_id', 'max_input_tokens', 'default_max_output_tokens', 'max_output_tokens', 'maximum_attempts'], 'alias_revision');
      else this.db.prepare(`INSERT INTO cloud_model_alias_revisions
        (id, alias, upstream_alias, pricing_version_id, max_input_tokens, default_max_output_tokens, max_output_tokens, maximum_attempts, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(revision.id, alias, revision.upstream_alias, pricingVersionId, revision.max_input_tokens, revision.default_max_output_tokens, revision.max_output_tokens, revision.maximum_attempts, this.now());
      this.db.prepare('UPDATE cloud_model_aliases SET display_name = ?, current_revision_id = ?, active = ? WHERE alias = ?')
        .run(displayName.trim(), revision.id, active ? 1 : 0, alias);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.resolveAlias(alias);
  }

  resolveAlias(alias) {
    return this.db.prepare(`SELECT a.alias, a.display_name, a.active, r.*, p.input_nano_usd_per_million_tokens,
      p.output_nano_usd_per_million_tokens, p.fixed_request_nano_usd
      FROM cloud_model_aliases a JOIN cloud_model_alias_revisions r ON r.id = a.current_revision_id
      JOIN cloud_pricing_versions p ON p.id = r.pricing_version_id WHERE a.alias = ? AND a.active = 1`).get(alias);
  }

  models() {
    return this.db.prepare(`SELECT alias AS id, display_name AS name FROM cloud_model_aliases
      WHERE active = 1 AND current_revision_id IS NOT NULL ORDER BY alias`).all()
      .map(row => ({ id: row.id, name: row.name }));
  }

  modelEnvelope() {
    const created = Math.floor(this.clock().getTime() / 1000);
    return { object: 'list', data: this.models().map(model => ({ id: model.id, object: 'model', created, owned_by: 'carthagent' })) };
  }

  request(requestId) {
    const row = this.db.prepare('SELECT * FROM cloud_gateway_requests WHERE id = ?').get(requestId);
    if (!row) return null;
    return { ...row, attempts: this.db.prepare('SELECT * FROM cloud_gateway_attempts WHERE gateway_request_row_id = ? ORDER BY rowid').all(requestId) };
  }

  frozenRevision(revisionId) {
    return this.db.prepare(`SELECT r.*, p.input_nano_usd_per_million_tokens,
      p.output_nano_usd_per_million_tokens, p.fixed_request_nano_usd
      FROM cloud_model_alias_revisions r JOIN cloud_pricing_versions p ON p.id = r.pricing_version_id
      WHERE r.id = ?`).get(revisionId);
  }

  mark(requestId, state) {
    this.db.prepare('UPDATE cloud_gateway_requests SET state = ?, updated_at = ? WHERE id = ?').run(state, this.now(), requestId);
  }

  async invoke({ accountId, endpoint, body, operationKey = this.id(), clientRequestId, signal }) {
    if (!['chat.completions', 'responses'].includes(endpoint)) throw new Error('unsupported_gateway_endpoint');
    operationKey = text(operationKey, 'operation key', 512);
    const duplicate = this.db.prepare('SELECT * FROM cloud_gateway_requests WHERE account_id = ? AND operation_key = ?').get(accountId, operationKey);
    if (duplicate) throw new Error(duplicate.state === 'reconciliation_required' ? 'request_reconciliation_required' : 'idempotency_key_reused');
    const revision = this.resolveAlias(body?.model);
    if (!revision) throw new Error('model_not_found');
    const bounded = boundedGatewayRequest(endpoint, body, revision);
    const maximumAttempts = Number(revision.maximum_attempts);
    const maximumNanoUsd = customerChargeNanoUsd(revision, Array.from({ length: maximumAttempts }, () => ({
      inputTokens: bounded.inputTokens, outputTokens: bounded.outputTokens,
    })));
    if (maximumNanoUsd <= 0) throw new Error('invalid_zero_cost_reservation');

    const id = this.id();
    const now = this.now();
    this.db.prepare(`INSERT INTO cloud_gateway_requests
      (id, account_id, operation_key, endpoint, alias, alias_revision_id, pricing_version_id, state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'admitting', ?, ?)`).run(id, accountId, operationKey, endpoint, revision.alias, revision.id, revision.pricing_version_id, now, now);
    let reservation;
    try {
      reservation = this.ledger.reserve({ accountId, maximumNanoUsd, idempotencyKey: `gateway:${accountId}:${operationKey}` });
      this.db.prepare(`UPDATE cloud_gateway_requests SET reservation_id = ?, state = 'reserved', updated_at = ? WHERE id = ?`).run(reservation.id, this.now(), id);
    } catch (error) {
      this.mark(id, error.message === 'insufficient_credit' ? 'rejected_insufficient_credit' : 'admission_failed');
      throw error;
    }

    let response;
    try {
      response = await this.upstream.dispatch({
        endpoint, body: bounded.request, operationKey,
        clientRequestId: clientRequestId || id, signal,
      });
    } catch (error) {
      if (error?.outcome === 'not_dispatched') {
        this.ledger.release({ reservationId: reservation.id, idempotencyKey: `gateway-release:${id}` });
        this.mark(id, 'released_not_dispatched');
      } else this.mark(id, 'reconciliation_required');
      throw error;
    }
    const gatewayRequestId = response.headers.get('x-request-id');
    this.db.prepare(`UPDATE cloud_gateway_requests SET gateway_request_id = ?, state = 'dispatched', updated_at = ? WHERE id = ?`)
      .run(gatewayRequestId || null, this.now(), id);
    return { id, response, reservation, revision };
  }

  async finalize(handle, { responseBody = null } = {}) {
    const current = this.request(handle.id);
    if (!current) throw new Error('gateway_request_not_found');
    if (['settled', 'released_not_dispatched'].includes(current.state)) return current;
    let settlement;
    try {
      settlement = await this.settlementSource.resolve({
        gatewayRequest: current, response: handle.response, responseBody,
      });
    } catch {
      this.mark(handle.id, 'reconciliation_required');
      return this.request(handle.id);
    }
    return this.reconcile(handle.id, settlement);
  }

  async reconcile(requestRowId, settlement = null) {
    const current = this.request(requestRowId);
    if (!current) throw new Error('gateway_request_not_found');
    if (['settled', 'released_not_dispatched'].includes(current.state)) return current;
    if (!settlement) {
      try { settlement = await this.settlementSource.resolve({ gatewayRequest: current }); }
      catch { settlement = null; }
    }
    if (settlement?.status === 'not_dispatched') {
      this.ledger.release({ reservationId: current.reservation_id, idempotencyKey: `gateway-release:${requestRowId}` });
      this.mark(requestRowId, 'released_not_dispatched');
      return this.request(requestRowId);
    }
    if (settlement?.status !== 'terminal') {
      this.mark(requestRowId, 'reconciliation_required');
      return this.request(requestRowId);
    }
    try {
      const revision = this.frozenRevision(current.alias_revision_id);
      if (!revision) throw new Error('alias_revision_not_found');
      const requestId = text(settlement.requestId, 'gateway request id', 512);
      if (current.gateway_request_id && current.gateway_request_id !== requestId) throw new Error('gateway_request_id_mismatch');
      if (!TERMINAL_STATES.has(settlement.terminalState)) throw new Error('invalid_terminal_state');
      if (!Array.isArray(settlement.attempts) || !settlement.attempts.length || settlement.attempts.length > Number(revision.maximum_attempts)) throw new Error('invalid_gateway_attempts');
      const attempts = settlement.attempts.map(attempt => ({
        attemptId: text(attempt.attemptId, 'gateway attempt id', 512),
        state: text(attempt.state, 'attempt state', 40),
        inputTokens: integer(attempt.inputTokens, 'inputTokens'),
        outputTokens: integer(attempt.outputTokens, 'outputTokens'),
      }));
      if (new Set(attempts.map(attempt => attempt.attemptId)).size !== attempts.length) throw new Error('duplicate_gateway_attempt');
      const charge = customerChargeNanoUsd(revision, attempts);
      const inputTokens = attempts.reduce((sum, attempt) => sum + attempt.inputTokens, 0);
      const outputTokens = attempts.reduce((sum, attempt) => sum + attempt.outputTokens, 0);
      this.ledger.settle({
        reservationId: current.reservation_id, actualNanoUsd: charge, requestId,
        attemptId: attempts.at(-1).attemptId, idempotencyKey: `gateway-settle:${requestRowId}`,
        metadata: {
          alias: current.alias, pricingVersionId: current.pricing_version_id,
          inputTokens, outputTokens, status: settlement.terminalState,
        },
      });
      for (const attempt of attempts) this.db.prepare(`INSERT OR IGNORE INTO cloud_gateway_attempts
        (gateway_request_row_id, attempt_id, state, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?)`)
        .run(requestRowId, attempt.attemptId, attempt.state, attempt.inputTokens, attempt.outputTokens);
      this.db.prepare(`UPDATE cloud_gateway_requests SET state = 'settled', gateway_request_id = ?, customer_charge_nano_usd = ?,
        input_tokens = ?, output_tokens = ?, terminal_state = ?, updated_at = ? WHERE id = ?`)
        .run(requestId, charge, inputTokens, outputTokens, settlement.terminalState, this.now(), requestRowId);
    } catch {
      this.mark(requestRowId, 'reconciliation_required');
    }
    return this.request(requestRowId);
  }
}

export function copyGatewayResponseHeaders(response, res) {
  for (const [name, value] of response.headers) if (SAFE_RESPONSE_HEADERS.has(name.toLowerCase())) res.setHeader(name, value);
}
