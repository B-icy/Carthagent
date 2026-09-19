import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { CloudLedger } from './ledger.mjs';

const TRIAL_NANO_USD = 1_000_000_000;
const BUILDER_MONTHLY_NANO_USD = 10_000_000_000;
const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEVICE_TTL_SECONDS = 10 * 60;
const DEVICE_INTERVAL_SECONDS = 5;

const b64url = value => Buffer.from(value).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');
const epoch = date => Math.floor(date.getTime() / 1000);

function secureEqual(left, right) {
  const a = Buffer.from(left || '');
  const b = Buffer.from(right || '');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyStripeSignature(payload, signature, secret, { now = Date.now(), toleranceSeconds = 300 } = {}) {
  if (!secret) throw new Error('Stripe webhook secret is not configured');
  const parts = Object.fromEntries(String(signature || '').split(',').map(item => item.split('=', 2)));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(Math.floor(now / 1000) - timestamp) > toleranceSeconds) throw new Error('Invalid Stripe signature timestamp');
  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  if (!secureEqual(expected, parts.v1)) throw new Error('Invalid Stripe signature');
  return true;
}

export class CloudControlPlane {
  constructor({
    ledger = new CloudLedger(),
    clock = () => new Date(),
    id = randomUUID,
    random = size => randomBytes(size),
    tokenSecret = process.env.CARTHAGENT_CLOUD_TOKEN_SECRET || randomBytes(32).toString('hex'),
    publicUrl = process.env.CARTHAGENT_CLOUD_URL || 'https://cloud.carthagent.xyz',
    stripe = null,
    stripePriceId = process.env.STRIPE_BUILDER_PRICE_ID || '',
    stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '',
  } = {}) {
    this.ledger = ledger;
    this.db = ledger.db;
    this.clock = clock;
    this.id = id;
    this.random = random;
    this.tokenSecret = tokenSecret;
    this.publicUrl = publicUrl.replace(/\/$/, '');
    this.stripe = stripe;
    this.stripePriceId = stripePriceId;
    this.stripeWebhookSecret = stripeWebhookSecret;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cloud_users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS account_members (
        account_id TEXT NOT NULL REFERENCES accounts(id), user_id TEXT NOT NULL REFERENCES cloud_users(id),
        role TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(account_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS trial_claims (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id), claimed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS device_authorizations (
        id TEXT PRIMARY KEY, device_code_hash TEXT NOT NULL UNIQUE, user_code TEXT NOT NULL UNIQUE,
        client_name TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','approved','denied','consumed')),
        account_id TEXT REFERENCES accounts(id), expires_at INTEGER NOT NULL, interval_seconds INTEGER NOT NULL,
        created_at TEXT NOT NULL, approved_at TEXT
      );
      CREATE TABLE IF NOT EXISTS cli_sessions (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), refresh_token_hash TEXT NOT NULL UNIQUE,
        scopes TEXT NOT NULL, client_name TEXT NOT NULL DEFAULT 'Carthagent CLI', expires_at INTEGER NOT NULL,
        revoked_at TEXT, created_at TEXT NOT NULL, last_used_at TEXT
      );
      CREATE TABLE IF NOT EXISTS subscriptions (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id), stripe_customer_id TEXT UNIQUE,
        stripe_subscription_id TEXT UNIQUE, stripe_price_id TEXT, status TEXT NOT NULL,
        current_period_start INTEGER, current_period_end INTEGER, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stripe_events (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, processed_at TEXT
      );
    `);
  }

  now() { return this.clock(); }
  nowIso() { return this.now().toISOString(); }

  createUserAccount({ email, accountId = this.id(), userId = this.id() }) {
    if (!/^\S+@\S+\.\S+$/.test(email || '')) throw new Error('valid email is required');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.ledger.createAccount(accountId);
      this.db.prepare('INSERT INTO cloud_users (id, email, created_at) VALUES (?, ?, ?)').run(userId, email.toLowerCase(), this.nowIso());
      this.db.prepare('INSERT INTO account_members (account_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').run(accountId, userId, 'owner', this.nowIso());
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { accountId, userId, email: email.toLowerCase() };
  }

  claimTrial(accountId) {
    const existing = this.db.prepare('SELECT * FROM trial_claims WHERE account_id = ?').get(accountId);
    if (existing) return { claimed: false, availableNanoUsd: this.ledger.available(accountId) };
    this.db.prepare('INSERT INTO trial_claims (account_id, claimed_at) VALUES (?, ?)').run(accountId, this.nowIso());
    try {
      this.ledger.grant({ accountId, amountNanoUsd: TRIAL_NANO_USD, idempotencyKey: `trial:${accountId}`, source: 'verified_trial', metadata: { grantType: 'trial' } });
    } catch (error) {
      this.db.prepare('DELETE FROM trial_claims WHERE account_id = ?').run(accountId);
      throw error;
    }
    return { claimed: true, availableNanoUsd: this.ledger.available(accountId) };
  }

  createDeviceAuthorization({ clientName = 'Carthagent CLI' } = {}) {
    const deviceCode = `ctgd_${this.random(32).toString('base64url')}`;
    const raw = this.random(5).toString('hex').toUpperCase();
    const userCode = `${raw.slice(0, 5)}-${raw.slice(5)}`;
    const expiresAt = epoch(this.now()) + DEVICE_TTL_SECONDS;
    this.db.prepare(`INSERT INTO device_authorizations
      (id, device_code_hash, user_code, client_name, status, expires_at, interval_seconds, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`).run(this.id(), hash(deviceCode), userCode, clientName.slice(0, 120), expiresAt, DEVICE_INTERVAL_SECONDS, this.nowIso());
    return {
      deviceCode, userCode,
      verificationUri: `${this.publicUrl}/activate`,
      verificationUriComplete: `${this.publicUrl}/activate?code=${encodeURIComponent(userCode)}`,
      expiresIn: DEVICE_TTL_SECONDS,
      interval: DEVICE_INTERVAL_SECONDS,
    };
  }

  approveDeviceAuthorization({ userCode, accountId, approve = true }) {
    const row = this.db.prepare('SELECT * FROM device_authorizations WHERE user_code = ?').get(String(userCode || '').toUpperCase());
    if (!row) throw new Error('invalid_user_code');
    if (row.expires_at <= epoch(this.now())) throw new Error('expired_token');
    if (row.status !== 'pending') throw new Error(`authorization_${row.status}`);
    this.db.prepare('UPDATE device_authorizations SET status = ?, account_id = ?, approved_at = ? WHERE id = ?').run(approve ? 'approved' : 'denied', approve ? accountId : null, this.nowIso(), row.id);
    if (approve) this.claimTrial(accountId);
    return { approved: approve, clientName: row.client_name };
  }

  signAccessToken(claims) {
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b64url(JSON.stringify(claims));
    const signature = createHmac('sha256', this.tokenSecret).update(`${header}.${payload}`).digest('base64url');
    return `${header}.${payload}.${signature}`;
  }

  verifyAccessToken(token, requiredScope) {
    const [header, payload, signature] = String(token || '').split('.');
    if (!header || !payload || !signature) throw new Error('invalid_token');
    const expected = createHmac('sha256', this.tokenSecret).update(`${header}.${payload}`).digest('base64url');
    if (!secureEqual(expected, signature)) throw new Error('invalid_token');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (claims.exp <= epoch(this.now())) throw new Error('expired_token');
    const session = this.db.prepare('SELECT * FROM cli_sessions WHERE id = ?').get(claims.sid);
    if (!session || session.revoked_at) throw new Error('revoked_token');
    if (requiredScope && !String(claims.scope || '').split(' ').includes(requiredScope)) throw new Error('insufficient_scope');
    this.db.prepare('UPDATE cli_sessions SET last_used_at = ? WHERE id = ?').run(this.nowIso(), claims.sid);
    return claims;
  }

  issueSession(accountId, scopes = ['models:read', 'gateway:invoke', 'account:read'], clientName = 'Carthagent CLI') {
    const sessionId = this.id();
    const refreshToken = `ctgr_${this.random(32).toString('base64url')}`;
    const now = epoch(this.now());
    this.db.prepare(`INSERT INTO cli_sessions
      (id, account_id, refresh_token_hash, scopes, client_name, expires_at, created_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(sessionId, accountId, hash(refreshToken), scopes.join(' '), String(clientName || 'Carthagent CLI').slice(0, 120), now + REFRESH_TTL_SECONDS, this.nowIso(), this.nowIso());
    return {
      accessToken: this.signAccessToken({ sub: accountId, sid: sessionId, scope: scopes.join(' '), iat: now, exp: now + ACCESS_TTL_SECONDS }),
      tokenType: 'Bearer', expiresIn: ACCESS_TTL_SECONDS, refreshToken, scope: scopes.join(' '),
    };
  }

  pollDeviceToken({ deviceCode }) {
    const row = this.db.prepare('SELECT * FROM device_authorizations WHERE device_code_hash = ?').get(hash(deviceCode || ''));
    if (!row) throw new Error('invalid_grant');
    if (row.expires_at <= epoch(this.now())) throw new Error('expired_token');
    if (row.status === 'pending') throw new Error('authorization_pending');
    if (row.status === 'denied') throw new Error('access_denied');
    if (row.status === 'consumed') throw new Error('invalid_grant');
    const tokens = this.issueSession(row.account_id, undefined, row.client_name);
    this.db.prepare(`UPDATE device_authorizations SET status = 'consumed' WHERE id = ?`).run(row.id);
    return tokens;
  }

  refreshSession({ refreshToken }) {
    const row = this.db.prepare('SELECT * FROM cli_sessions WHERE refresh_token_hash = ?').get(hash(refreshToken || ''));
    if (!row || row.revoked_at || row.expires_at <= epoch(this.now())) throw new Error('invalid_grant');
    const replacement = `ctgr_${this.random(32).toString('base64url')}`;
    const now = epoch(this.now());
    this.db.prepare('UPDATE cli_sessions SET refresh_token_hash = ?, expires_at = ?, last_used_at = ? WHERE id = ?').run(hash(replacement), now + REFRESH_TTL_SECONDS, this.nowIso(), row.id);
    const scopes = row.scopes.split(' ').filter(Boolean);
    return { accessToken: this.signAccessToken({ sub: row.account_id, sid: row.id, scope: row.scopes, iat: now, exp: now + ACCESS_TTL_SECONDS }), tokenType: 'Bearer', expiresIn: ACCESS_TTL_SECONDS, refreshToken: replacement, scope: scopes.join(' ') };
  }

  revokeSession({ sessionId }) {
    const result = this.db.prepare('UPDATE cli_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(this.nowIso(), sessionId);
    return { revoked: result.changes > 0 };
  }

  revokeAccountSession({ accountId, sessionId }) {
    const result = this.db.prepare('UPDATE cli_sessions SET revoked_at = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL').run(this.nowIso(), sessionId, accountId);
    if (!result.changes) throw new Error('session_not_found');
    return { revoked: true, sessionId };
  }

  listSessions(accountId) {
    return this.db.prepare('SELECT id, scopes, client_name, expires_at, created_at, last_used_at, revoked_at FROM cli_sessions WHERE account_id = ? ORDER BY created_at DESC').all(accountId);
  }

  account(accountId) {
    const user = this.db.prepare(`SELECT u.email FROM cloud_users u JOIN account_members m ON m.user_id = u.id
      WHERE m.account_id = ? AND m.role = 'owner' ORDER BY m.created_at LIMIT 1`).get(accountId);
    return {
      accountId,
      email: user?.email || null,
      balance: { currency: 'USD', availableNanoUsd: this.ledger.available(accountId) },
      grants: this.grants(accountId),
      subscription: this.subscription(accountId),
      sessions: this.listSessions(accountId),
    };
  }

  grants(accountId) {
    return this.db.prepare(`SELECT id, original_nano_usd, remaining_nano_usd, expires_at, source, created_at
      FROM credit_grants WHERE account_id = ? ORDER BY created_at DESC, id DESC`).all(accountId).map(row => ({
      id: row.id,
      originalNanoUsd: Number(row.original_nano_usd),
      remainingNanoUsd: Number(row.remaining_nano_usd),
      expiresAt: row.expires_at,
      source: row.source,
      createdAt: row.created_at,
    }));
  }

  usage(accountId, { limit = 50 } = {}) {
    const bounded = Math.max(1, Math.min(200, Number.isSafeInteger(limit) ? limit : 50));
    return this.db.prepare(`SELECT amount_nano_usd, gateway_request_id, gateway_attempt_id, metadata_json, created_at
      FROM ledger_entries WHERE account_id = ? AND kind = 'charge' ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(accountId, bounded).map(row => {
      let metadata = {};
      try { metadata = JSON.parse(row.metadata_json); } catch { /* invalid historical metadata */ }
      return {
        createdAt: row.created_at,
        alias: typeof metadata.alias === 'string' ? metadata.alias : null,
        inputTokens: Number.isSafeInteger(metadata.inputTokens) ? metadata.inputTokens : null,
        outputTokens: Number.isSafeInteger(metadata.outputTokens) ? metadata.outputTokens : null,
        status: typeof metadata.status === 'string' ? metadata.status : null,
        chargeNanoUsd: Math.abs(Number(row.amount_nano_usd)),
        gatewayRequestId: row.gateway_request_id,
        gatewayAttemptId: row.gateway_attempt_id,
      };
    });
  }

  subscription(accountId) {
    return this.db.prepare('SELECT * FROM subscriptions WHERE account_id = ?').get(accountId) || { account_id: accountId, status: 'none' };
  }

  async createCheckout({ accountId, successUrl, cancelUrl }) {
    if (!this.stripe || !this.stripePriceId) throw new Error('billing_not_configured');
    const current = this.subscription(accountId);
    const session = await this.stripe.createCheckoutSession({
      mode: 'subscription', customer: current.stripe_customer_id || undefined,
      client_reference_id: accountId, line_items: [{ price: this.stripePriceId, quantity: 1 }],
      success_url: successUrl, cancel_url: cancelUrl, metadata: { accountId },
    });
    return { url: session.url, id: session.id };
  }

  async createPortal({ accountId, returnUrl }) {
    if (!this.stripe) throw new Error('billing_not_configured');
    const current = this.subscription(accountId);
    if (!current.stripe_customer_id) throw new Error('stripe_customer_not_found');
    const session = await this.stripe.createPortalSession({ customer: current.stripe_customer_id, return_url: returnUrl });
    return { url: session.url, id: session.id };
  }

  upsertSubscription(accountId, object) {
    const period = object.items?.data?.[0]?.current_period_end ? object.items.data[0] : object;
    this.db.prepare(`INSERT INTO subscriptions
      (account_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status, current_period_start, current_period_end, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET stripe_customer_id=excluded.stripe_customer_id,
      stripe_subscription_id=excluded.stripe_subscription_id, stripe_price_id=excluded.stripe_price_id,
      status=excluded.status, current_period_start=excluded.current_period_start,
      current_period_end=excluded.current_period_end, updated_at=excluded.updated_at`).run(
      accountId, object.customer || null, object.id || null, object.items?.data?.[0]?.price?.id || this.stripePriceId || null,
      object.status || 'unknown', period.current_period_start || null, period.current_period_end || null, this.nowIso()
    );
  }

  processStripeEvent(event) {
    const inserted = this.db.prepare(`INSERT OR IGNORE INTO stripe_events (id, type, status, created_at) VALUES (?, ?, 'processing', ?)`).run(event.id, event.type, this.nowIso());
    if (!inserted.changes) return { duplicate: true };
    try {
      const object = event.data?.object || {};
      const accountId = object.metadata?.accountId || object.client_reference_id || object.subscription_details?.metadata?.accountId;
      if (event.type === 'checkout.session.completed' && accountId) {
        const subscription = { id: object.subscription, customer: object.customer, status: object.payment_status === 'paid' ? 'active' : 'incomplete' };
        this.upsertSubscription(accountId, subscription);
      } else if (event.type.startsWith('customer.subscription.') && accountId) {
        this.upsertSubscription(accountId, object);
      } else if (event.type === 'invoice.paid' && accountId) {
        this.upsertSubscription(accountId, { id: object.subscription, customer: object.customer, status: 'active', current_period_start: object.period_start, current_period_end: object.period_end });
        this.ledger.grant({
          accountId, amountNanoUsd: BUILDER_MONTHLY_NANO_USD,
          idempotencyKey: `stripe-invoice:${object.id}`, expiresAt: object.period_end ? new Date(object.period_end * 1000).toISOString() : null,
          source: 'subscription', metadata: { invoiceId: object.id, subscriptionId: object.subscription || '' },
        });
      } else if (event.type === 'invoice.payment_failed' && accountId) {
        this.upsertSubscription(accountId, { id: object.subscription, customer: object.customer, status: 'past_due' });
      } else if ((event.type === 'charge.refunded' || event.type === 'charge.dispute.created') && accountId) {
        const nano = Math.round(Number(object.amount_refunded || object.amount || 0) * 10_000_000);
        if (nano > 0) this.ledger.appendEntry({ accountId, kind: 'refund', amountNanoUsd: -nano, idempotencyKey: `stripe-reversal:${event.id}`, metadata: { stripeObjectId: object.id, eventType: event.type } });
      }
      this.db.prepare(`UPDATE stripe_events SET status = 'processed', processed_at = ? WHERE id = ?`).run(this.nowIso(), event.id);
      return { duplicate: false, processed: true };
    } catch (error) {
      this.db.prepare('DELETE FROM stripe_events WHERE id = ?').run(event.id);
      throw error;
    }
  }

  handleStripeWebhook({ payload, signature }) {
    verifyStripeSignature(payload, signature, this.stripeWebhookSecret, { now: this.now().getTime() });
    return this.processStripeEvent(JSON.parse(payload));
  }
}

export const CLOUD_PLAN = Object.freeze({
  trialNanoUsd: TRIAL_NANO_USD,
  builderMonthlyNanoUsd: BUILDER_MONTHLY_NANO_USD,
  accessTtlSeconds: ACCESS_TTL_SECONDS,
  refreshTtlSeconds: REFRESH_TTL_SECONDS,
});
