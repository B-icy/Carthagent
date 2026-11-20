import test from 'node:test';
import assert from 'node:assert/strict';
import {
  backoffDelay,
  CircuitBreaker,
  CircuitOpenError,
  DEFAULT_RETRY_POLICY,
  fetchWithRetry,
  isTransientNetworkError,
  parseRetryAfter,
  retryAsync,
} from '../lib/http-resilience.mjs';

const URL_A = 'https://api.example.test/repos/x';

function harness(responses, { start = 1_000_000 } = {}) {
  const clock = { now: start };
  const calls = [];
  const sleeps = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (next instanceof Error) throw next;
    return next();
  };
  const options = {
    fetchImpl,
    now: () => clock.now,
    random: () => 0.5,
    sleep: async ms => {
      sleeps.push(ms);
      clock.now += ms;
    },
    breaker: null,
  };
  return { clock, calls, sleeps, options };
}

const networkError = () => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) });
const status =
  (code, headers = {}) =>
  () =>
    new Response(`status ${code}`, { status: code, headers });

test('full-jitter backoff grows exponentially and is capped', () => {
  const policy = { ...DEFAULT_RETRY_POLICY, baseDelayMs: 100, factor: 2, maxDelayMs: 1000 };
  assert.equal(
    backoffDelay(1, policy, () => 0.999),
    99,
  );
  assert.equal(
    backoffDelay(2, policy, () => 0.999),
    199,
  );
  assert.equal(
    backoffDelay(3, policy, () => 0.5),
    200,
  );
  assert.equal(
    backoffDelay(10, policy, () => 0.999),
    999,
  );
  assert.equal(
    backoffDelay(3, policy, () => 0),
    0,
  );
});

test('Retry-After accepts delta seconds and HTTP dates', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(parseRetryAfter('3', now), 3000);
  assert.equal(parseRetryAfter('Thu, 01 Jan 2026 00:00:05 GMT', now), 5000);
  assert.equal(parseRetryAfter('Wed, 31 Dec 2025 23:59:00 GMT', now), 0);
  assert.equal(parseRetryAfter('soon', now), null);
  assert.equal(parseRetryAfter(null, now), null);
});

test('transient network errors are recognized; aborts and ordinary errors are not', () => {
  assert.equal(isTransientNetworkError(networkError()), true);
  assert.equal(isTransientNetworkError(new TypeError('terminated')), true);
  assert.equal(isTransientNetworkError(Object.assign(new Error('x'), { code: 'EAI_AGAIN' })), true);
  assert.equal(isTransientNetworkError(Object.assign(new Error('x'), { transient: true })), true);
  assert.equal(isTransientNetworkError(new DOMException('aborted', 'AbortError')), false);
  assert.equal(isTransientNetworkError(new DOMException('timeout', 'TimeoutError')), false);
  assert.equal(isTransientNetworkError(new Error('offline')), false);
  assert.equal(isTransientNetworkError(new TypeError('Invalid URL')), false);
  assert.equal(isTransientNetworkError(new CircuitOpenError('h', 1000)), false);
});

test('retries network errors and retryable statuses up to maxAttempts, then returns the last response', async () => {
  const h = harness([networkError(), status(503), status(200)]);
  const response = await fetchWithRetry(URL_A, {}, h.options);
  assert.equal(response.status, 200);
  assert.equal(h.calls.length, 3);
  assert.deepEqual(h.sleeps, [125, 250]);

  const exhausted = harness([status(502)]);
  const last = await fetchWithRetry(URL_A, {}, exhausted.options);
  assert.equal(last.status, 502);
  assert.equal(await last.text(), 'status 502');
  assert.equal(exhausted.calls.length, 3);

  const failing = harness([networkError()]);
  await assert.rejects(fetchWithRetry(URL_A, {}, { ...failing.options, policy: { maxAttempts: 4 } }), /fetch failed/);
  assert.equal(failing.calls.length, 4);
});

test('every retryable status is retried; other 4xx and 5xx are returned at once', async () => {
  for (const code of [408, 429, 500, 502, 503, 504]) {
    const h = harness([status(code), status(200)]);
    assert.equal((await fetchWithRetry(URL_A, {}, h.options)).status, 200, String(code));
    assert.equal(h.calls.length, 2);
  }
  for (const code of [400, 401, 403, 404, 409, 422, 501]) {
    const h = harness([status(code), status(200)]);
    assert.equal((await fetchWithRetry(URL_A, {}, h.options)).status, code);
    assert.equal(h.calls.length, 1, String(code));
  }
  const ordinary = harness([new Error('request leaked secret')]);
  await assert.rejects(fetchWithRetry(URL_A, {}, ordinary.options), /leaked/);
  assert.equal(ordinary.calls.length, 1);
});

test('custom retryStatuses narrow what is retried', async () => {
  const h = harness([status(503), status(200)]);
  const response = await fetchWithRetry(URL_A, {}, { ...h.options, retryStatuses: new Set([500]) });
  assert.equal(response.status, 503);
  assert.equal(h.calls.length, 1);
});

test('POST and other non-idempotent methods are never retried', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) {
    const h = harness([status(503), status(200)]);
    assert.equal((await fetchWithRetry(URL_A, { method }, h.options)).status, 503);
    assert.equal(h.calls.length, 1, method);
    const failing = harness([networkError(), status(200)]);
    await assert.rejects(fetchWithRetry(URL_A, { method }, failing.options), /fetch failed/);
    assert.equal(failing.calls.length, 1);
  }
  const head = harness([status(503), status(200)]);
  assert.equal((await fetchWithRetry(URL_A, { method: 'HEAD' }, head.options)).status, 200);
});

test('Retry-After is honored, and a wait beyond the cap returns the response instead', async () => {
  const h = harness([status(429, { 'retry-after': '2' }), status(200)]);
  assert.equal((await fetchWithRetry(URL_A, {}, h.options)).status, 200);
  assert.deepEqual(h.sleeps, [2000]);

  const date = harness([status(503, { 'retry-after': new Date(1_000_000 + 3000).toUTCString() }), status(200)], { start: 1_000_000 });
  await fetchWithRetry(URL_A, {}, date.options);
  assert.ok(date.sleeps[0] > 1000 && date.sleeps[0] <= 3000, String(date.sleeps[0]));

  const long = harness([status(429, { 'retry-after': '3600' }), status(200)]);
  assert.equal((await fetchWithRetry(URL_A, {}, long.options)).status, 429);
  assert.equal(long.calls.length, 1);
  assert.deepEqual(long.sleeps, []);
});

test('an overall deadline stops retries that would not fit', async () => {
  const h = harness([status(503)]);
  const response = await fetchWithRetry(URL_A, {}, { ...h.options, deadlineMs: 200, policy: { baseDelayMs: 300, maxAttempts: 5 } });
  assert.equal(response.status, 503);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.sleeps, [150]);
});

test('an aborted signal stops before the next attempt and is not counted as a network failure', async () => {
  const controller = new AbortController();
  const h = harness([status(503), status(200)]);
  h.options.sleep = async () => controller.abort(new Error('cancelled by user'));
  await assert.rejects(fetchWithRetry(URL_A, { signal: controller.signal }, h.options), /cancelled by user/);
  assert.equal(h.calls.length, 1);

  const pre = new AbortController();
  pre.abort(new Error('already cancelled'));
  const none = harness([status(200)]);
  await assert.rejects(fetchWithRetry(URL_A, { signal: pre.signal }, none.options), /already cancelled/);
  assert.equal(none.calls.length, 0);

  const during = new AbortController();
  const breaker = new CircuitBreaker({ failureThreshold: 1 });
  const aborting = harness([]);
  aborting.options.fetchImpl = async () => {
    during.abort();
    throw new DOMException('aborted', 'AbortError');
  };
  await assert.rejects(fetchWithRetry(URL_A, { signal: during.signal }, { ...aborting.options, breaker }), { name: 'AbortError' });
  assert.equal(breaker.state, 'closed');
});

test('the default sleep is interrupted by abort', async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = fetchWithRetry(
    URL_A,
    { signal: controller.signal },
    {
      breaker: null,
      policy: { baseDelayMs: 60_000, maxDelayMs: 60_000 },
      random: () => 0.99,
      fetchImpl: async () => {
        calls++;
        return status(503)();
      },
    },
  );
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('circuit breaker opens after consecutive failures, half-opens after cooldown, and closes on success', () => {
  const clock = { now: 0 };
  const breaker = new CircuitBreaker({ host: 'h', failureThreshold: 3, windowMs: 1000, cooldownMs: 5000, now: () => clock.now });
  assert.equal(breaker.allow(), true);
  breaker.recordFailure();
  breaker.recordFailure();
  breaker.recordSuccess();
  breaker.recordFailure();
  breaker.recordFailure();
  assert.equal(breaker.state, 'closed', 'a success resets the consecutive count');
  clock.now = 2000;
  breaker.recordFailure();
  assert.equal(breaker.state, 'closed', 'failures outside the window do not count');
  breaker.recordFailure();
  breaker.recordFailure();
  assert.equal(breaker.state, 'open');
  assert.equal(breaker.allow(), false);
  assert.equal(breaker.retryInMs(), 5000);
  clock.now += 5000;
  assert.equal(breaker.allow(), true, 'one probe after cooldown');
  assert.equal(breaker.state, 'half-open');
  assert.equal(breaker.allow(), false, 'only one probe at a time');
  breaker.recordFailure();
  assert.equal(breaker.state, 'open', 'a failed probe reopens');
  clock.now += 5000;
  assert.equal(breaker.allow(), true);
  breaker.releaseProbe();
  assert.equal(breaker.allow(), true, 'a neutral outcome frees the probe slot');
  breaker.recordSuccess();
  assert.equal(breaker.state, 'closed');
  assert.equal(breaker.allow(), true);
});

test('fetchWithRetry feeds the breaker and fails fast while it is open', async () => {
  const clock = { now: 0 };
  const breaker = new CircuitBreaker({ host: 'api.example.test', failureThreshold: 3, cooldownMs: 1000, now: () => clock.now });
  const h = harness([status(503)]);
  h.options.now = () => clock.now;
  h.options.breaker = host => {
    assert.equal(host, 'api.example.test');
    return breaker;
  };
  assert.equal((await fetchWithRetry(URL_A, {}, h.options)).status, 503);
  assert.equal(breaker.state, 'open');
  await assert.rejects(fetchWithRetry(URL_A, {}, h.options), error => {
    assert.ok(error instanceof CircuitOpenError);
    assert.match(error.message, /Network requests to api\.example\.test are paused/);
    return true;
  });
  assert.equal(h.calls.length, 3);
  clock.now += 1000;
  const ok = harness([status(200)]);
  assert.equal((await fetchWithRetry(URL_A, {}, { ...ok.options, breaker })).status, 200);
  assert.equal(breaker.state, 'closed');
  const notFound = harness([status(404)]);
  await fetchWithRetry(URL_A, {}, { ...notFound.options, breaker });
  assert.equal(breaker.failures.length, 0, 'a reachable host answering 4xx is healthy');
});

test('retryAsync restarts a whole operation on retryable errors only', async () => {
  const sleeps = [];
  const options = { random: () => 0.5, sleep: async ms => sleeps.push(ms) };
  let attempts = 0;
  const value = await retryAsync(async attempt => {
    attempts = attempt;
    if (attempt < 3) throw new TypeError('terminated');
    return 'done';
  }, options);
  assert.equal(value, 'done');
  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [125, 250]);

  let fatal = 0;
  await assert.rejects(
    retryAsync(async () => {
      fatal++;
      throw new Error('checksum mismatch');
    }, options),
    /checksum mismatch/,
  );
  assert.equal(fatal, 1);

  sleeps.length = 0;
  let statusAttempts = 0;
  await assert.rejects(
    retryAsync(
      async () => {
        statusAttempts++;
        throw Object.assign(new Error('HTTP 503'), { status: 503, retryAfterMs: 1500 });
      },
      { ...options, shouldRetry: error => error.status === 503 },
    ),
    /HTTP 503/,
  );
  assert.equal(statusAttempts, 3);
  assert.deepEqual(sleeps, [1500, 1500]);
});
