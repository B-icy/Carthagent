import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  authTypeLabel,
  authTypes,
  applyAuthEvent,
  createCloudBillingLink,
  filterLoginProviders,
  formatCloudAccount,
  loadCloudAccount,
  loginAndRefresh,
  loginProviderFocus,
  loginProviderList,
  loadAuthRuntime,
  newAuthState,
} from '../lib/tui/auth.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, '..');

/** Minimal stand-in for the engine's ModelRuntime. */
function fakeRuntime(providers, status = {}) {
  return {
    getProviders: () => providers,
    getProviderAuthStatus: id => status[id] || { configured: false },
  };
}

test('authTypes reports advertised methods, subscription first', () => {
  assert.deepEqual(authTypes({ auth: { apiKey: {} } }), ['api_key']);
  assert.deepEqual(authTypes({ auth: { oauth: {} } }), ['oauth']);
  assert.deepEqual(authTypes({ auth: { oauth: {}, apiKey: {} } }), ['oauth', 'api_key']);
  assert.deepEqual(authTypes({}), []);
  assert.deepEqual(authTypes(undefined), []);
});

test('authTypeLabel names the two login methods', () => {
  assert.equal(authTypeLabel('oauth'), 'subscription (OAuth)');
  assert.equal(authTypeLabel('oauth', 'experiential-labs'), 'browser sign-in');
  assert.equal(authTypeLabel('api_key'), 'API key');
});

test('loginProviderList skips providers without a login method', () => {
  const runtime = fakeRuntime([
    { id: 'anthropic', name: 'Anthropic', auth: { oauth: {}, apiKey: {} } },
    { id: 'noauth', name: 'No Auth', auth: {} },
    { id: 'deepseek', name: 'DeepSeek', auth: { apiKey: {} } },
  ]);
  const rows = loginProviderList(runtime);
  assert.deepEqual(rows.map(r => r.id), ['anthropic', 'deepseek']);
  assert.deepEqual(rows[0].types, ['oauth', 'api_key']);
  assert.deepEqual(rows[1].types, ['api_key']);
});

test('loginProviderList keeps stable product ordering regardless of connected state', () => {
  const runtime = fakeRuntime(
    [
      { id: 'zeta', name: 'Zeta', auth: { apiKey: {} } },
      { id: 'openrouter', name: 'OpenRouter', auth: { apiKey: {} } },
      { id: 'experiential-labs', name: 'Carthagent Cloud', auth: { oauth: {}, apiKey: {} } },
      { id: 'anthropic', name: 'Anthropic', auth: { apiKey: {} } },
      { id: 'alpha', name: 'Alpha', auth: { apiKey: {} } },
    ],
    { zeta: { configured: true }, openrouter: { configured: true } }
  );
  const rows = loginProviderList(runtime);
  assert.deepEqual(rows.map(r => r.id), ['experiential-labs', 'anthropic', 'openrouter', 'alpha', 'zeta']);
  assert.equal(rows[0].recommended, true);
  assert.deepEqual(rows[0].types, ['oauth', 'api_key']);
  assert.equal(rows[1].configured, false);
  assert.equal(rows.at(-1).configured, true);
});

test('loginProviderFocus prefers the active provider without reordering rows', () => {
  const rows = [
    { id: 'experiential-labs', recommended: true },
    { id: 'anthropic', recommended: false },
  ];
  assert.equal(loginProviderFocus(rows), 0);
  assert.equal(loginProviderFocus(rows, 'anthropic'), 1);
  assert.deepEqual(rows.map(row => row.id), ['experiential-labs', 'anthropic']);
});

test('loginProviderList tolerates a runtime that throws on auth status', () => {
  const runtime = {
    getProviders: () => [{ id: 'x', name: 'X', auth: { apiKey: {} } }],
    getProviderAuthStatus: () => { throw new Error('boom'); },
  };
  assert.deepEqual(loginProviderList(runtime).map(r => r.id), ['x']);
});

test('filterLoginProviders matches id or name, case-insensitively', () => {
  const rows = [{ id: 'anthropic', name: 'Anthropic' }, { id: 'google', name: 'Google Gemini' }];
  assert.equal(filterLoginProviders(rows, '').length, 2);
  assert.equal(filterLoginProviders(rows, '   ').length, 2);
  assert.deepEqual(filterLoginProviders(rows, 'anth').map(r => r.id), ['anthropic']);
  assert.deepEqual(filterLoginProviders(rows, 'GEM').map(r => r.id), ['google']);
  assert.deepEqual(filterLoginProviders(rows, 'zzz'), []);
});

test('applyAuthEvent folds login notify events into popup fields', () => {
  const state = newAuthState();
  applyAuthEvent(state, { type: 'auth_url', url: 'https://x/y', instructions: 'do it' });
  assert.equal(state.url, 'https://x/y');
  assert.equal(state.instructions, 'do it');
  assert.match(state.message, /authorization URL/i);

  applyAuthEvent(state, { type: 'device_code', userCode: 'ABCD-1234', verificationUri: 'https://verify' });
  assert.deepEqual(state.deviceCode, { userCode: 'ABCD-1234', verificationUri: 'https://verify' });

  applyAuthEvent(state, { type: 'progress', message: 'working' });
  assert.equal(state.message, 'working');

  applyAuthEvent(state, { type: 'info', message: 'note', links: [{ url: 'https://l', label: 'L' }] });
  assert.equal(state.message, 'note');
  assert.equal(state.links.length, 1);

  // unknown / empty events are harmless
  applyAuthEvent(state, null);
  applyAuthEvent(state, undefined);
  applyAuthEvent(state, { type: 'mystery' });
  assert.equal(state.url, 'https://x/y');
});

test('newAuthState starts in the provider-picking phase', () => {
  const state = newAuthState();
  assert.equal(state.phase, 'providers');
  assert.deepEqual(state.providers, []);
  assert.equal(state.error, '');
  assert.equal(state.busy, false);
});

test('loginAndRefresh exposes dynamic provider models immediately after login', async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const runtime = {
    login: async (...args) => { calls.push(['login', ...args]); return { type: 'api_key', key: 'k' }; },
    refresh: async options => { calls.push(['refresh', options]); },
  };
  const result = await loginAndRefresh(runtime, 'experiential-labs', 'api_key', { signal });
  assert.equal(result.key, 'k');
  assert.equal(calls[0][0], 'login');
  assert.deepEqual(calls[1][1], { providers: ['experiential-labs'], allowNetwork: true, signal });
});

test('Cloud account helpers use the runtime OAuth credential for account and billing actions', async () => {
  const calls = [];
  const runtime = {
    isUsingOAuth: id => id === 'experiential-labs',
    getAuth: async () => ({ auth: { apiKey: 'access-token' } }),
  };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(url.endsWith('/account')
      ? { accountId: 'acct', balance: { availableNanoUsd: 1_000_000_000 }, subscription: { status: 'none' }, sessions: [] }
      : { url: 'https://stripe.test' }), { status: 200 });
  };
  const env = { CARTHAGENT_CLOUD_URL: 'https://cloud.test' };
  const account = await loadCloudAccount(runtime, { env, fetchImpl });
  const billing = await createCloudBillingLink(runtime, 'checkout', { env, fetchImpl });
  assert.equal(account.accountId, 'acct');
  assert.equal(billing.url, 'https://stripe.test');
  assert.ok(calls.every(call => call.options.headers.authorization === 'Bearer access-token'));
  assert.match(formatCloudAccount(account), /Credit: \$1\.00/);
  await assert.rejects(loadCloudAccount({ isUsingOAuth: () => false }, { env, fetchImpl }), /cloud_login_required/);
});

test('loadAuthRuntime lazily imports vendored engine and discovers OAuth/API providers', async () => {
  const runtime = await loadAuthRuntime();
  assert.ok(runtime && typeof runtime === 'object');
  const providers = loginProviderList(runtime);
  assert.equal(providers.length, 41);
  assert.equal(providers[0].id, 'experiential-labs');
  assert.equal(providers[0].recommended, true);
  const oauthProviders = providers.filter(p => p.types.includes('oauth')).map(p => p.id).sort();
  assert.deepEqual(oauthProviders, [
    'anthropic',
    'experiential-labs',
    'github-copilot',
    'kimi-coding',
    'openai-codex',
    'openrouter',
    'radius',
    'xai',
  ]);
});

test('vendor engine does not depend on unbundled @earendil-works/chord', () => {
  const chunkPath = join(root, 'vendor', 'agent', 'chunks', 'chunk-JVUZSMYM.js');
  const content = readFileSync(chunkPath, 'utf8');
  assert.doesNotMatch(content, /from\s*['"]@earendil-works\/chord/);
  assert.match(content, /from\s*['"]\.\/chord-context\.js['"]/);
});
