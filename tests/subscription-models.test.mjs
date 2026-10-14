import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANTHROPIC_PROVIDER_ID,
  OPENAI_CODEX_PROVIDER_ID,
  anthropicDiscoveryProviderConfig,
  codexDiscoveryProviderConfig,
  codexModelDefinition,
  codexThinkingLevelMap,
  decodeChatGptAccountId,
  mergeDiscoveredModels,
  parseAnthropicModels,
  parseCodexModels,
  registerSubscriptionProviders,
} from '../lib/providers/subscription-models.mjs';

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function fakeJwt(claims) {
  return ['h', Buffer.from(JSON.stringify(claims)).toString('base64url'), 's'].join('.');
}

const signal = () => new AbortController().signal;

test('anthropic discovery fetches /v1/models with the subscription OAuth headers', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return jsonResponse({ data: [
      { type: 'model', id: 'claude-opus-9', display_name: 'Claude Opus 9' },
      { type: 'model', id: 'claude-sonnet-9', display_name: 'Claude Sonnet 9' },
    ], has_more: false });
  };
  const config = anthropicDiscoveryProviderConfig({ fetchImpl });
  const refreshed = await config.refreshModels({
    allowNetwork: true,
    credential: { type: 'oauth', access: 'sk-ant-oat', expires: Date.now() + 60_000 },
    signal: signal(),
    stored: undefined,
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/api\.anthropic\.com\/v1\/models\?/);
  assert.equal(calls[0].options.headers.authorization, 'Bearer sk-ant-oat');
  assert.equal(calls[0].options.headers['anthropic-beta'], 'oauth-2025-04-20');
  assert.equal(calls[0].options.headers['anthropic-version'], '2023-06-01');
  assert.deepEqual(refreshed.map(m => m.id), ['claude-opus-9', 'claude-sonnet-9']);
  assert.equal(refreshed[0].api, 'anthropic-messages');
  assert.equal(refreshed[0].reasoning, true);
});

test('anthropic discovery uses x-api-key for API key credentials and paginates', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (!String(url).includes('after_id')) {
      return jsonResponse({ data: [{ type: 'model', id: 'claude-a' }], has_more: true, last_id: 'claude-a' });
    }
    return jsonResponse({ data: [{ type: 'model', id: 'claude-b' }], has_more: false });
  };
  const config = anthropicDiscoveryProviderConfig({ fetchImpl });
  const refreshed = await config.refreshModels({
    allowNetwork: true,
    credential: { type: 'api_key', key: 'sk-ant-key' },
    signal: signal(),
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers['x-api-key'], 'sk-ant-key');
  assert.equal(calls[0].options.headers.authorization, undefined);
  assert.match(calls[1].url, /after_id=claude-a/);
  assert.deepEqual(refreshed.map(m => m.id), ['claude-a', 'claude-b']);
});

test('codex discovery fetches /codex/models with bearer, account id, and originator', async () => {
  const access = fakeJwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-123' } });
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return jsonResponse({ models: [
      { slug: 'gpt-9-codex', display_name: 'GPT-9 Codex', visibility: 'list', supported_reasoning_levels: ['low', 'medium', 'high', 'xhigh'] },
      { slug: 'gpt-9-internal', visibility: 'hide' },
    ] });
  };
  const config = codexDiscoveryProviderConfig({ fetchImpl });
  const refreshed = await config.refreshModels({
    allowNetwork: true,
    credential: { type: 'oauth', access },
    signal: signal(),
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/chatgpt\.com\/backend-api\/codex\/models/);
  assert.equal(calls[0].options.headers.authorization, `Bearer ${access}`);
  assert.equal(calls[0].options.headers['chatgpt-account-id'], 'acct-123');
  assert.equal(calls[0].options.headers.originator, 'pi');
  assert.deepEqual(refreshed.map(m => m.id), ['gpt-9-codex']);
  const discovered = refreshed[0];
  assert.equal(discovered.api, 'openai-codex-responses');
  assert.equal(discovered.baseUrl, 'https://chatgpt.com/backend-api');
  assert.deepEqual(discovered.thinkingLevelMap, { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: null });
});

test('stored catalog metadata wins over defaults for known ids; new ids get fallbacks', async () => {
  const fetchImpl = async () => jsonResponse({ data: [
    { type: 'model', id: 'claude-opus-4-5', display_name: 'Claude Opus 4.5' },
    { type: 'model', id: 'claude-new-thing', display_name: 'Claude New Thing' },
  ] });
  const config = anthropicDiscoveryProviderConfig({ fetchImpl });
  const stored = { models: [{
    id: 'claude-opus-4-5', name: 'Claude Opus 4.5 (latest)', provider: 'anthropic',
    api: 'anthropic-messages', baseUrl: 'https://api.anthropic.com',
    contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true,
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  }] };
  const refreshed = await config.refreshModels({
    allowNetwork: true,
    credential: { type: 'oauth', access: 'tok' },
    signal: signal(),
    stored,
  });
  const known = refreshed.find(m => m.id === 'claude-opus-4-5');
  assert.equal(known.contextWindow, 1_000_000);
  assert.deepEqual(known.cost, { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 });
  const unknown = refreshed.find(m => m.id === 'claude-new-thing');
  assert.equal(unknown.contextWindow, 200_000);
  assert.equal(unknown.maxTokens, 64_000);
  assert.equal(unknown.name, 'Claude New Thing');
  assert.equal(unknown.cost, undefined);
});

test('stored catalog entries the endpoint did not return stay visible', async () => {
  const fetchImpl = async () => jsonResponse({ data: [{ type: 'model', id: 'claude-b' }] });
  const config = anthropicDiscoveryProviderConfig({ fetchImpl });
  const refreshed = await config.refreshModels({
    allowNetwork: true,
    credential: { type: 'oauth', access: 'tok' },
    signal: signal(),
    stored: { models: [
      { id: 'claude-a', name: 'Claude A', provider: 'anthropic' },
      { id: 'claude-b', name: 'Claude B stored', provider: 'anthropic', contextWindow: 42 },
      { id: 'claude-c', name: 'Claude C', provider: 'anthropic' },
    ] },
  });
  assert.deepEqual(refreshed.map(m => m.id), ['claude-b', 'claude-a', 'claude-c']);
  assert.equal(refreshed[0].contextWindow, 42);
});

test('offline refreshes and missing credentials leave the catalog untouched', async () => {
  let called = 0;
  const fetchImpl = async () => { called++; return jsonResponse({ data: [{ id: 'x' }] }); };
  const config = anthropicDiscoveryProviderConfig({ fetchImpl });
  assert.equal(await config.refreshModels({ allowNetwork: false, credential: { type: 'api_key', key: 'k' }, signal: signal() }), undefined);
  assert.equal(await config.refreshModels({ allowNetwork: true, signal: signal() }), undefined);
  assert.equal(await config.refreshModels({ allowNetwork: true, credential: { type: 'other' }, signal: signal() }), undefined);
  assert.equal(called, 0);
});

test('empty discovery result keeps the existing catalog', async () => {
  const config = anthropicDiscoveryProviderConfig({ fetchImpl: async () => jsonResponse({ data: [] }) });
  const refreshed = await config.refreshModels({
    allowNetwork: true,
    credential: { type: 'api_key', key: 'k' },
    signal: signal(),
  });
  assert.equal(refreshed, undefined);
});

test('codex discovery requires an OAuth credential', async () => {
  let called = 0;
  const fetchImpl = async () => { called++; return jsonResponse({ models: [] }); };
  const config = codexDiscoveryProviderConfig({ fetchImpl });
  const refreshed = await config.refreshModels({
    allowNetwork: true,
    credential: { type: 'api_key', key: 'sk-not-a-subscription' },
    signal: signal(),
  });
  assert.equal(refreshed, undefined);
  assert.equal(called, 0);
});

test('parsers dedupe, skip non-model entries, and tolerate odd shapes', () => {
  assert.deepEqual(parseAnthropicModels({ data: [
    { type: 'model', id: 'claude-a', display_name: 'A' },
    { type: 'model', id: 'claude-a' },
    { type: 'other', id: 'not-a-model' },
    { id: 'claude-b' },
    { type: 'model' },
    null,
  ] }).map(m => m.id), ['claude-a', 'claude-b']);
  assert.deepEqual(parseCodexModels({ models: [
    { slug: 'gpt-a', display_name: 'A' },
    { slug: 'gpt-a' },
    { id: 'gpt-b' },
    'gpt-c',
    { slug: '' },
  ] }).map(m => m.id), ['gpt-a', 'gpt-b', 'gpt-c']);
  assert.deepEqual(parseCodexModels({}), []);
  assert.deepEqual(parseCodexModels(null), []);
});

test('codexThinkingLevelMap mirrors the endpoint levels; absent input stays unset', () => {
  assert.equal(codexThinkingLevelMap(undefined), undefined);
  assert.equal(codexThinkingLevelMap([]), undefined);
  assert.deepEqual(codexThinkingLevelMap(['low', 'high']), {
    off: null, minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: null,
  });
  assert.equal(codexThinkingLevelMap(['none']).off, 'none');
  const definition = codexModelDefinition({ id: 'gpt-x', name: 'X', reasoningLevels: ['medium'] }, new Map());
  assert.deepEqual(definition.thinkingLevelMap.medium, 'medium');
});

test('decodeChatGptAccountId reads the claim and ignores malformed tokens', () => {
  const token = fakeJwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct' } });
  assert.equal(decodeChatGptAccountId(token), 'acct');
  assert.equal(decodeChatGptAccountId('not-a-jwt'), null);
  assert.equal(decodeChatGptAccountId(fakeJwt({})), null);
});

test('mergeDiscoveredModels keeps upstream order and appends unseen stored entries', () => {
  const merged = mergeDiscoveredModels(
    [{ id: 'a' }, { id: 'b' }],
    [{ id: 'b', x: 1 }, { id: 'c' }],
  );
  assert.deepEqual(merged.map(m => m.id), ['b', 'c', 'a']);
  assert.equal(merged[0].x, 1);
});

test('registerSubscriptionProviders overlays both builtin providers', () => {
  const registrations = [];
  registerSubscriptionProviders({ registerProvider: (id, config) => registrations.push([id, config]) });
  assert.deepEqual(registrations.map(([id]) => id), [ANTHROPIC_PROVIDER_ID, OPENAI_CODEX_PROVIDER_ID]);
  for (const [, config] of registrations) {
    assert.equal(typeof config.refreshModels, 'function');
    assert.equal(typeof config.api, 'string');
    assert.equal(typeof config.baseUrl, 'string');
  }
});
