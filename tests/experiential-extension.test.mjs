import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const requireEngine = createRequire(import.meta.url);
const { createJiti } = requireEngine('jiti');
const jiti = createJiti(import.meta.url, {
  alias: { '@earendil-works/pi-coding-agent': fileURLToPath(new URL('../vendor/agent/index.js', import.meta.url)) },
});
const factory = await jiti.import(fileURLToPath(new URL('../extensions/experiential.ts', import.meta.url)), { default: true });

test('Cloud extension gives limit-specific recovery without hiding BYOK', () => {
  let handler;
  const registered = [];
  factory({
    registerProvider(id) { registered.push(id); },
    on(name, callback) { if (name === 'message_end') handler = callback; },
  });
  assert.deepEqual(registered, ['carthagent-cloud']);
  assert.equal(typeof handler, 'function');

  const notices = [];
  const ctx = { model: { provider: 'carthagent-cloud' }, ui: { notify: (...args) => notices.push(args) } };
  const event = code => ({ message: { role: 'assistant', provider: 'carthagent-cloud', stopReason: 'error', errorMessage: `429: {"error":{"code":"${code}"}}` } });
  handler(event('daily_limit_reached'), ctx);
  handler(event('monthly_allowance_exhausted'), ctx);
  handler(event('subscription_inactive'), ctx);
  handler(event('unrelated_error'), ctx);

  assert.equal(notices.length, 3);
  assert.match(notices[0][0], /00:00 UTC/);
  assert.match(notices[1][0], /billing portal/);
  assert.match(notices[2][0], /awaiting payment or activation/);
  assert.ok(notices.every(([, tone]) => tone === 'warning'));
  assert.ok(notices.every(([message]) => /\/login/.test(message) && /BYOK|your own provider/.test(message)));
});
