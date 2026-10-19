import test from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE_LOGIN_PROVIDERS, nativeLoginProvider, nativeLoginProviders, nativeProviderName } from '../lib/opencode/provider-policy.mjs';
import { cliHelp } from '../lib/opencode/cli.mjs';

test('native login policy stays small, named, ordered and excludes upstream providers', () => {
  assert.deepEqual(NATIVE_LOGIN_PROVIDERS.map(provider => provider.id), ['experiential-labs', 'anthropic', 'xai', 'openai', 'google']);
  assert.equal(nativeLoginProvider('opencode'), undefined);
  assert.equal(nativeLoginProvider('opencode-go'), undefined);
  assert.equal(nativeLoginProvider('openrouter'), undefined);
  assert.equal(nativeProviderName('ship'), 'Carthagent Ship');
  assert.equal(nativeLoginProvider('claudecode').id, 'anthropic');
  assert.equal(nativeLoginProvider('codex').id, 'openai');
  assert.equal(nativeLoginProvider('gemini').id, 'google');
  assert.equal(nativeProviderName('xai-code'), 'xAI / Grok');
});

test('curated login rows preserve actual methods and do not invent subscription support', () => {
  const anthropic = { id: 'anthropic', name: 'Anthropic', methods: [{ type: 'key' }] };
  const ship = { id: 'experiential-labs', name: 'internal', methods: [{ type: 'oauth', id: 'carthagent-device' }] };
  const rows = nativeLoginProviders([{ id: 'opencode', methods: [] }, anthropic, ship]);
  assert.deepEqual(rows.map(row => row.id), ['experiential-labs', 'anthropic']);
  assert.equal(rows[0].name, 'Carthagent Ship');
  assert.deepEqual(rows[1].methods, [{ type: 'key' }]);
  assert.equal(anthropic.name, 'Anthropic');
  assert.equal(ship.name, 'internal');
});

test('native CLI help uses Carthagent branding', () => {
  assert.doesNotMatch(cliHelp('test'), /opencode/i);
});
