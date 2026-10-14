/**
 * Subscription model discovery for the bundled engine's first-party OAuth
 * providers: `anthropic` (Claude Pro/Max) and `openai-codex` (ChatGPT
 * Plus/Pro). Each provider is overlaid with a `refreshModels` hook that asks
 * the subscription's own model endpoint what the account can actually use, so
 * newly released models appear in the picker without a CLI update.
 *
 * The engine's `ModelsImpl.refresh` runs every provider through two phases:
 * an offline phase carrying the stored credential, then — when the refresh
 * allows network — an online phase with the resolved credential. The overlay
 * replaces the whole visible catalog when it returns an array, so each phase
 * rebuilds the discovered list the same way:
 *
 *   online  — fetch the endpoint, merge discovered ids over the stored
 *             catalog, and persist the discovery to a credential-keyed cache.
 *   offline — restore the last cached discovery for the same credential so
 *             previously discovered models do not vanish between refreshes.
 *
 * Returning `undefined` leaves the builtin/remote catalog untouched.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const ANTHROPIC_PROVIDER_ID = 'anthropic';
export const OPENAI_CODEX_PROVIDER_ID = 'openai-codex';
export const SUBSCRIPTION_PROVIDER_IDS = [ANTHROPIC_PROVIDER_ID, OPENAI_CODEX_PROVIDER_ID];

const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_MODELS_PATH = '/v1/models';
const ANTHROPIC_VERSION = '2023-06-01';
// Same beta flag the engine sends on OAuth requests; required for
// subscription tokens on the platform endpoints.
const ANTHROPIC_OAUTH_BETA = 'oauth-2025-04-20';
const ANTHROPIC_MAX_PAGES = 5;

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api';
const CODEX_MODELS_PATH = '/codex/models';
const CODEX_JWT_CLAIM_PATH = 'https://api.openai.com/auth';
// Matches the engine's codex-responses requests.
const CODEX_ORIGINATOR = 'pi';

const DISCOVERY_TIMEOUT_MS = 10_000;
const CACHE_FILE_NAME = 'subscription-models.json';

function discoverySignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs ?? DISCOVERY_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function readJson(response, label) {
  if (!response.ok) {
    const detail = String(await response.text()).trim().slice(0, 240);
    throw new Error(`${label} model discovery failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  return response.json();
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

/**
 * Stable fingerprint of the credential the discovery belongs to. The cache is
 * only restored for the same account/key, so models from another subscription
 * are never shown. OAuth prefers `accountId`, then the refresh token (stable
 * across access-token rotation); API keys hash the key itself.
 */
export function credentialKey(credential) {
  if (credential?.type === 'oauth') {
    if (typeof credential.accountId === 'string' && credential.accountId) return `oauth:${credential.accountId}`;
    if (typeof credential.refresh === 'string' && credential.refresh) return `oauth:rt:${sha256(credential.refresh)}`;
    if (typeof credential.access === 'string' && credential.access) return `oauth:at:${sha256(credential.access)}`;
    return null;
  }
  if (credential?.type === 'api_key' && typeof credential.key === 'string' && credential.key) {
    return `key:${sha256(credential.key)}`;
  }
  return null;
}

/** ChatGPT account id is a JWT claim; the stored codex credential also carries it. */
export function decodeChatGptAccountId(token) {
  try {
    const claims = JSON.parse(Buffer.from(String(token || '').split('.')[1] || '', 'base64url').toString('utf8'));
    const accountId = claims?.[CODEX_JWT_CLAIM_PATH]?.chatgpt_account_id;
    return typeof accountId === 'string' && accountId ? accountId : null;
  } catch {
    return null;
  }
}

/**
 * GET api.anthropic.com/v1/models — works for both API keys (x-api-key) and
 * Claude subscription OAuth tokens (Bearer + oauth beta).
 */
export async function fetchAnthropicSubscriptionModels(credential, { baseUrl = ANTHROPIC_BASE_URL, fetchImpl = globalThis.fetch, signal } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Anthropic model discovery requires fetch support.');
  const headers = { accept: 'application/json', 'anthropic-version': ANTHROPIC_VERSION };
  if (credential?.type === 'oauth') {
    headers.authorization = `Bearer ${credential.access}`;
    headers['anthropic-beta'] = ANTHROPIC_OAUTH_BETA;
  } else if (credential?.type === 'api_key') {
    headers['x-api-key'] = credential.key;
  } else {
    return { models: [], hiddenIds: new Set() };
  }
  const models = [];
  let afterId = '';
  for (let page = 0; page < ANTHROPIC_MAX_PAGES; page++) {
    const url = new URL(`${String(baseUrl).replace(/\/+$/, '')}${ANTHROPIC_MODELS_PATH}`);
    url.searchParams.set('limit', '1000');
    if (afterId) url.searchParams.set('after_id', afterId);
    const payload = await readJson(await fetchImpl(url, { headers, signal }), 'Anthropic');
    models.push(...parseAnthropicModels(payload));
    if (!payload?.has_more || typeof payload?.last_id !== 'string' || !payload.last_id) break;
    afterId = payload.last_id;
  }
  return { models, hiddenIds: new Set() };
}

export function parseAnthropicModels(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const seen = new Set();
  const models = [];
  for (const entry of data) {
    const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
    if (!id || seen.has(id) || (entry.type !== undefined && entry.type !== 'model')) continue;
    seen.add(id);
    const name = typeof entry.display_name === 'string' && entry.display_name.trim() ? entry.display_name.trim() : id;
    models.push({ id, name });
  }
  return models;
}

/**
 * GET chatgpt.com/backend-api/codex/models — the same endpoint the Codex CLI
 * reads for the account's model list. OAuth only.
 */
export async function fetchCodexSubscriptionModels(credential, { baseUrl = CODEX_BASE_URL, fetchImpl = globalThis.fetch, signal, clientVersion } = {}) {
  if (credential?.type !== 'oauth' || typeof credential.access !== 'string' || !credential.access) {
    return { models: [], hiddenIds: new Set() };
  }
  if (typeof fetchImpl !== 'function') throw new Error('OpenAI model discovery requires fetch support.');
  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${credential.access}`,
    originator: CODEX_ORIGINATOR,
  };
  const accountId = (typeof credential.accountId === 'string' && credential.accountId) || decodeChatGptAccountId(credential.access);
  if (accountId) headers['chatgpt-account-id'] = accountId;
  const url = new URL(`${String(baseUrl).replace(/\/+$/, '')}${CODEX_MODELS_PATH}`);
  if (clientVersion) url.searchParams.set('client_version', clientVersion);
  const payload = await readJson(await fetchImpl(url, { headers, signal }), 'OpenAI');
  return parseCodexModels(payload);
}

export function parseCodexModels(payload) {
  const entries = Array.isArray(payload?.models) ? payload.models
    : Array.isArray(payload?.data) ? payload.data : [];
  const seen = new Set();
  const hiddenIds = new Set();
  const models = [];
  for (const entry of entries) {
    const rawId = typeof entry === 'string' ? entry : entry?.slug ?? entry?.id;
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (entry && typeof entry === 'object' && entry.visibility === 'hide') {
      hiddenIds.add(id);
      continue;
    }
    const display = typeof entry === 'object' ? entry.display_name ?? entry.name : undefined;
    const levels = Array.isArray(entry?.supported_reasoning_levels)
      ? entry.supported_reasoning_levels.filter(level => typeof level === 'string')
      : undefined;
    models.push({ id, name: typeof display === 'string' && display.trim() ? display.trim() : id, reasoningLevels: levels });
  }
  return { models, hiddenIds };
}

/** Engine thinking levels derived from the codex endpoint's supported_reasoning_levels. */
export function codexThinkingLevelMap(levels) {
  if (!Array.isArray(levels) || !levels.length) return undefined;
  const supported = new Set(levels);
  const map = { off: supported.has('none') || supported.has('off') ? 'none' : null };
  for (const level of ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
    map[level] = supported.has(level) ? level : null;
  }
  return map;
}

/**
 * Full model definition for a discovered id. `base` is the richest definition
 * the runtime already knows for this id (persisted remote-catalog entry first,
 * then the builtin catalog), so a discovered model keeps its real cost,
 * context window, and thinking levels instead of the conservative fallbacks.
 */
export function anthropicModelDefinition(model, base) {
  return {
    api: 'anthropic-messages',
    baseUrl: ANTHROPIC_BASE_URL,
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 200_000,
    maxTokens: 64_000,
    compat: { supportsStrictTools: true },
    ...base,
    id: model.id,
    name: base?.name ?? model.name ?? model.id,
  };
}

export function codexModelDefinition(model, base) {
  const definition = {
    api: 'openai-codex-responses',
    baseUrl: CODEX_BASE_URL,
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 272_000,
    maxTokens: 128_000,
    compat: { supportsOpenAIGrammarTools: true },
    thinkingLevelMap: codexThinkingLevelMap(model.reasoningLevels),
    ...base,
    id: model.id,
    name: base?.name ?? model.name ?? model.id,
  };
  if (!definition.thinkingLevelMap) delete definition.thinkingLevelMap;
  return definition;
}

/**
 * Discovered models first (the subscription's authoritative order), then any
 * stored catalog entries the endpoint did not return so aliases and remote
 * catalog extras stay visible. `excludeIds` drops stored entries the endpoint
 * now reports hidden.
 */
export function mergeDiscoveredModels(storedModels, discovered, { excludeIds } = {}) {
  const merged = [...discovered];
  const seen = new Set(discovered.map(model => model.id));
  for (const model of Array.isArray(storedModels) ? storedModels : []) {
    if (model && typeof model.id === 'string' && !seen.has(model.id) && !excludeIds?.has(model.id)) {
      seen.add(model.id);
      merged.push(model);
    }
  }
  return merged;
}

/** File-backed discovery cache, one entry per provider keyed by credential. */
export function fileSubscriptionCache(agentDir) {
  if (!agentDir) return undefined;
  const file = join(agentDir, CACHE_FILE_NAME);
  const readAll = async () => {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  };
  return {
    file,
    async read(providerId) {
      const entry = (await readAll())[providerId];
      return entry && typeof entry === 'object' ? entry : null;
    },
    async write(providerId, entry) {
      const all = await readAll();
      all[providerId] = entry;
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(all, null, 2));
    },
  };
}

// Lazily-built, read-only runtime used to resolve builtin catalog definitions
// (real cost/context/thinking levels) for ids the endpoint already knows.
// A fresh runtime with refreshOnCreate:false never touches network or disk.
let builtinRuntimePromise;
function builtinModelsRuntime() {
  builtinRuntimePromise ??= import('../../vendor/agent/index.js')
    .then(engine => engine.ModelRuntime.create({ refreshOnCreate: false }))
    .catch(() => null);
  return builtinRuntimePromise;
}

async function knownModelsById(providerId, knownModels) {
  const loader = knownModels ?? (async id => (await builtinModelsRuntime())?.getModels?.(id) ?? []);
  const entries = await loader(providerId);
  return new Map((Array.isArray(entries) ? entries : []).filter(model => model?.id).map(model => [model.id, model]));
}

function envApiKeyCredential(name) {
  const key = process.env[name];
  return typeof key === 'string' && key.trim() ? { type: 'api_key', key: key.trim() } : undefined;
}

async function subscriptionModelRefresh(context, { providerId, fetchModels, toDefinition, knownModels, cache, offlineCredential }) {
  if (context?.signal?.aborted) return undefined;
  // Offline refreshes only carry the stored credential; env API keys reach the
  // hook through `offlineCredential` so the cache can still be keyed to them.
  const credential = context.credential ?? (context.allowNetwork ? undefined : offlineCredential?.());
  const key = credentialKey(credential);
  if (!key) return undefined;
  const stored = Array.isArray(context.stored?.models) ? context.stored.models : [];
  const storedById = new Map(stored.filter(model => model?.id).map(model => [model.id, model]));

  if (!context.allowNetwork) {
    const cached = await cache?.read(providerId).catch(() => null);
    if (!cached || cached.credential !== key || !Array.isArray(cached.discovered) || !cached.discovered.length) return undefined;
    const knownById = await knownModelsById(providerId, knownModels);
    const defs = cached.discovered.map(model => toDefinition(model, storedById.get(model.id) ?? knownById.get(model.id)));
    return mergeDiscoveredModels(stored, defs, { excludeIds: new Set(cached.hiddenIds ?? []) });
  }

  const result = await fetchModels(credential);
  const discovered = Array.isArray(result?.models) ? result.models : [];
  if (context.signal?.aborted || !discovered.length) return undefined;
  const hiddenIds = result.hiddenIds instanceof Set ? result.hiddenIds : new Set(result.hiddenIds ?? []);
  const knownById = await knownModelsById(providerId, knownModels);
  const defs = discovered.map(model => toDefinition(model, storedById.get(model.id) ?? knownById.get(model.id)));
  await cache?.write(providerId, {
    credential: key,
    checkedAt: Date.now(),
    discovered,
    hiddenIds: [...hiddenIds],
  }).catch(() => {});
  return mergeDiscoveredModels(stored, defs, { excludeIds: hiddenIds });
}

/** Overlay config for the builtin `anthropic` provider (subscription + API key). */
export function anthropicDiscoveryProviderConfig({ baseUrl = ANTHROPIC_BASE_URL, fetchImpl = globalThis.fetch, timeoutMs, knownModels, cache } = {}) {
  return {
    api: 'anthropic-messages',
    baseUrl,
    refreshModels: context => subscriptionModelRefresh(context, {
      providerId: ANTHROPIC_PROVIDER_ID,
      fetchModels: credential => fetchAnthropicSubscriptionModels(credential, {
        baseUrl,
        fetchImpl,
        signal: discoverySignal(context.signal, timeoutMs),
      }),
      toDefinition: anthropicModelDefinition,
      knownModels,
      cache,
      offlineCredential: () => envApiKeyCredential('ANTHROPIC_API_KEY'),
    }),
  };
}

/** Overlay config for the builtin `openai-codex` provider (ChatGPT subscription). */
export function codexDiscoveryProviderConfig({ baseUrl = CODEX_BASE_URL, fetchImpl = globalThis.fetch, timeoutMs, clientVersion, knownModels, cache } = {}) {
  return {
    api: 'openai-codex-responses',
    baseUrl,
    refreshModels: context => subscriptionModelRefresh(context, {
      providerId: OPENAI_CODEX_PROVIDER_ID,
      fetchModels: credential => fetchCodexSubscriptionModels(credential, {
        baseUrl,
        fetchImpl,
        clientVersion,
        signal: discoverySignal(context.signal, timeoutMs),
      }),
      toDefinition: codexModelDefinition,
      knownModels,
      cache,
    }),
  };
}

/**
 * Register both overlays on a ModelRuntime (or the extension API, which
 * exposes the same registerProvider signature). `agentDir` enables the
 * credential-keyed on-disk cache used to restore discovered models during
 * offline refreshes.
 */
export function registerSubscriptionProviders(runtime, options = {}) {
  if (!runtime || typeof runtime.registerProvider !== 'function') throw new TypeError('A ModelRuntime is required.');
  const shared = { ...options, cache: options.cache ?? fileSubscriptionCache(options.agentDir) };
  runtime.registerProvider(ANTHROPIC_PROVIDER_ID, anthropicDiscoveryProviderConfig(shared));
  runtime.registerProvider(OPENAI_CODEX_PROVIDER_ID, codexDiscoveryProviderConfig(shared));
  return runtime;
}
