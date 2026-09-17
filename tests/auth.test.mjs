import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  authTypeLabel,
  authTypes,
  applyAuthEvent,
  filterLoginProviders,
  loginProviderList,
  loadAuthRuntime,
  newAuthState,
} from '../lib/tui/auth.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, '..');

/** Minimal stand-in for pi's ModelRuntime. */
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

test('loginProviderList marks configured providers and sorts them first', () => {
  const runtime = fakeRuntime(
    [
      { id: 'zeta', name: 'Zeta', auth: { apiKey: {} } },
      { id: 'alpha', name: 'Alpha', auth: { apiKey: {} } },
      { id: 'beta', name: 'Beta', auth: { apiKey: {} } },
    ],
    { beta: { configured: true } }
  );
  const rows = loginProviderList(runtime);
  assert.deepEqual(rows.map(r => r.id), ['beta', 'alpha', 'zeta']);
  assert.equal(rows[0].configured, true);
  assert.equal(rows[1].configured, false);
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

test('loadAuthRuntime lazily imports vendored engine and discovers OAuth/API providers', async () => {
  const runtime = await loadAuthRuntime();
  assert.ok(runtime && typeof runtime === 'object');
  const providers = loginProviderList(runtime);
  assert.equal(providers.length, 40);
  const oauthProviders = providers.filter(p => p.types.includes('oauth')).map(p => p.id).sort();
  assert.deepEqual(oauthProviders, [
    'anthropic',
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
