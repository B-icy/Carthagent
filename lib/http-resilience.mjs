import { setTimeout as delay } from 'node:timers/promises';
import { getLogger } from './logger.mjs';

export const RETRYABLE_STATUSES = Object.freeze(new Set([408, 429, 500, 502, 503, 504]));
const IDEMPOTENT_METHODS = Object.freeze(new Set(['GET', 'HEAD']));
export const DEFAULT_RETRY_POLICY = Object.freeze({ maxAttempts: 3, baseDelayMs: 250, factor: 2, maxDelayMs: 4000, maxRetryAfterMs: 10_000 });
const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CLOSED',
]);

const log = getLogger('http');

/** Full-jitter exponential backoff: a uniform delay in [0, min(max, base * factor^(attempt-1))). */
export function backoffDelay(attempt, policy = DEFAULT_RETRY_POLICY, random = Math.random) {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * policy.factor ** Math.max(0, attempt - 1));
  return Math.floor(random() * ceiling);
}

/** Retry-After as milliseconds (delta-seconds or HTTP-date), or null when absent/invalid. */
export function parseRetryAfter(value, nowMs = Date.now()) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, date - nowMs) : null;
}

/**
 * True for connection-level failures worth retrying (fetch's TypeError, socket
 * and DNS error codes). Aborts, timeouts requested by the caller and ordinary
 * errors are not transient.
 */
export function isTransientNetworkError(error) {
  if (!error || typeof error !== 'object') return false;
  if (error.transient === true) return true;
  if (error.name === 'AbortError' || error.name === 'TimeoutError' || error.name === 'CircuitOpenError') return false;
  const codes = [error.code, error.cause?.code, error.cause?.cause?.code];
  if (codes.some(code => TRANSIENT_CODES.has(code))) return true;
  return error instanceof TypeError && /fetch failed|terminated|network|socket|other side closed/i.test(error.message);
}

export class CircuitOpenError extends Error {
  constructor(host, retryInMs) {
    super(`Network requests to ${host} are paused after repeated failures; retrying in ${Math.ceil(retryInMs / 1000)}s`);
    this.name = 'CircuitOpenError';
    this.code = 'ECIRCUITOPEN';
    this.host = host;
  }
}

/**
 * closed → open after `failureThreshold` consecutive failures within `windowMs`
 * → half-open after `cooldownMs` (one probe at a time) → closed on success, or
 * open again on failure.
 */
export class CircuitBreaker {
  constructor({ host = 'unknown', failureThreshold = 5, windowMs = 60_000, cooldownMs = 30_000, now = Date.now } = {}) {
    Object.assign(this, { host, failureThreshold, windowMs, cooldownMs, now });
    this.state = 'closed';
    this.failures = [];
    this.openedAt = 0;
    this.probeInFlight = false;
  }

  allow() {
    if (this.state === 'open') {
      if (this.now() - this.openedAt < this.cooldownMs) return false;
      this.transition('half-open');
    }
    if (this.state === 'half-open') {
      if (this.probeInFlight) return false;
      this.probeInFlight = true;
    }
    return true;
  }

  retryInMs() {
    return Math.max(0, this.cooldownMs - (this.now() - this.openedAt));
  }

  recordSuccess() {
    this.failures = [];
    this.probeInFlight = false;
    if (this.state !== 'closed') this.transition('closed');
  }

  recordFailure() {
    const at = this.now();
    this.probeInFlight = false;
    if (this.state === 'half-open') return this.open(at);
    this.failures = [...this.failures.filter(time => at - time < this.windowMs), at];
    if (this.failures.length >= this.failureThreshold) this.open(at);
  }

  releaseProbe() {
    this.probeInFlight = false;
  }

  open(at) {
    this.openedAt = at;
    this.failures = [];
    this.transition('open');
  }

  transition(state) {
    if (state === this.state) return;
    const level = state === 'open' ? 'warn' : 'debug';
    log[level]('Circuit breaker state changed', { host: this.host, from: this.state, to: state });
    this.state = state;
  }
}

const BREAKERS = new Map();

function breakerForHost(host) {
  if (!BREAKERS.has(host)) BREAKERS.set(host, new CircuitBreaker({ host }));
  return BREAKERS.get(host);
}

function hostOf(input) {
  try {
    return new URL(input instanceof Request ? input.url : String(input)).host;
  } catch {
    return 'unknown';
  }
}

function resolveBreaker(option, host) {
  if (option === null || option === false) return null;
  if (typeof option === 'function') return option(host);
  return option ?? breakerForHost(host);
}

function retryPlan({ attempt, maxAttempts, policy, random, retryAfterMs, remainingMs }) {
  if (attempt >= maxAttempts) return null;
  if (retryAfterMs !== null && retryAfterMs > policy.maxRetryAfterMs) return null;
  const wait = retryAfterMs ?? backoffDelay(attempt, policy, random);
  return wait < remainingMs ? wait : null;
}

const nextWait = (attempt, run, retryAfterMs) => retryPlan({ attempt, ...run, retryAfterMs, remainingMs: run.deadline - run.now() });

const errorSummary = error => (error ? { name: error.name, code: error.code ?? error.cause?.code } : undefined);

const responseRetryAfter = (response, now) => (response ? parseRetryAfter(response.headers?.get?.('retry-after'), now) : null);

// Not awaited: cancelling one branch of a tee()d body only settles once the
// other branch is cancelled too.
function cancelBody(response) {
  response?.body?.cancel?.().catch(() => {});
}

function settings(init, options) {
  const policy = { ...DEFAULT_RETRY_POLICY, ...options.policy };
  const method = String(init.method ?? 'GET').toUpperCase();
  const retryMethods = options.retryMethods ?? IDEMPOTENT_METHODS;
  const now = options.now ?? Date.now;
  return {
    policy,
    maxAttempts: retryMethods.has(method) ? Math.max(1, policy.maxAttempts) : 1,
    retryStatuses: options.retryStatuses ?? RETRYABLE_STATUSES,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    signal: options.signal ?? init.signal,
    sleep: options.sleep ?? ((ms, signal) => delay(ms, undefined, signal ? { signal } : {})),
    random: options.random ?? Math.random,
    now,
    deadline: Number.isFinite(options.deadlineMs) ? now() + options.deadlineMs : Infinity,
  };
}

async function attemptFetch(url, init, run, breaker) {
  if (breaker && !breaker.allow()) throw new CircuitOpenError(breaker.host, breaker.retryInMs());
  try {
    const response = await run.fetchImpl(url, init);
    if (run.retryStatuses.has(response.status)) breaker?.recordFailure();
    else breaker?.recordSuccess();
    return { response };
  } catch (error) {
    if (isTransientNetworkError(error) && !run.signal?.aborted) {
      breaker?.recordFailure();
      return { error };
    }
    breaker?.releaseProbe();
    throw error;
  }
}

/**
 * fetch() with bounded retries for idempotent requests. Retries network errors
 * and 408/429/5xx responses with full-jitter exponential backoff, honoring
 * Retry-After up to `policy.maxRetryAfterMs`, the caller's AbortSignal and an
 * optional overall `deadlineMs`. Non-idempotent methods get exactly one
 * attempt. When retries are exhausted the last response is returned (or the
 * last error thrown) unchanged, so callers keep their own error handling. A
 * per-host circuit breaker short-circuits with CircuitOpenError while open.
 */
export async function fetchWithRetry(url, init = {}, options = {}) {
  const run = settings(init, options);
  const host = hostOf(url);
  const breaker = resolveBreaker(options.breaker, host);
  for (let attempt = 1; ; attempt++) {
    run.signal?.throwIfAborted();
    const { response, error } = await attemptFetch(url, init, run, breaker);
    if (response && !run.retryStatuses.has(response.status)) return response;
    const wait = nextWait(attempt, run, responseRetryAfter(response, run.now()));
    if (wait === null) {
      if (error) throw error;
      return response;
    }
    cancelBody(response);
    log.debug('Retrying HTTP request', {
      host,
      attempt,
      status: response?.status,
      error: errorSummary(error),
      delayMs: wait,
    });
    await run.sleep(wait, run.signal);
  }
}

/**
 * Run an idempotent multi-step operation (for example a streamed download that
 * must restart from scratch) with the same backoff policy. `shouldRetry(error)`
 * decides which failures are retried; `error.retryAfterMs` is honored.
 */
export async function retryAsync(operation, options = {}) {
  const run = settings({}, options);
  const shouldRetry = options.shouldRetry ?? isTransientNetworkError;
  for (let attempt = 1; ; attempt++) {
    run.signal?.throwIfAborted();
    try {
      return await operation(attempt);
    } catch (error) {
      if (run.signal?.aborted || !shouldRetry(error)) throw error;
      const wait = nextWait(attempt, run, Number.isFinite(error?.retryAfterMs) ? error.retryAfterMs : null);
      if (wait === null) throw error;
      log.debug('Retrying operation', {
        operation: options.name,
        attempt,
        error: errorSummary(error),
        delayMs: wait,
      });
      await run.sleep(wait, run.signal);
    }
  }
}
