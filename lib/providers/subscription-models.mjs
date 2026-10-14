/**
 * Subscription model discovery for the bundled engine's first-party OAuth
 * providers: `anthropic` (Claude Pro/Max) and `openai-codex` (ChatGPT
 * Plus/Pro). Each provider is overlaid with a `refreshModels` hook that asks
 * the subscription's own model endpoint what the account can actually use, so
 * newly released models appear in the picker without a CLI update.
 *
 * The overlay runs after the builtin catalog refresh on every runtime refresh
 * (engine startup, post-login refresh). Its return value replaces the visible
 * catalog, so the hook returns the discovered list merged over the stored
 * catalog — enriched with stored metadata for known ids and conservative
 * defaults for brand-new ones. Returning `undefined` (offline, no credential,
 * empty response) leaves the builtin/remote catalog untouched.
 */

export const ANTHROPIC_PROVIDER_ID = 'anthropic';
export const OPENAI_CODEX_PROVIDER_ID = 'openai-codex';

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
    return [];
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
  return models;
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
  if (credential?.type !== 'oauth' || typeof credential.access !== 'string' || !credential.access) return [];
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
  const models = [];
  for (const entry of entries) {
    const rawId = typeof entry === 'string' ? entry : entry?.slug ?? entry?.id;
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!id || seen.has(id)) continue;
    if (entry && typeof entry === 'object' && entry.visibility === 'hide') continue;
    seen.add(id);
    const display = typeof entry === 'object' ? entry.display_name ?? entry.name : undefined;
    const levels = Array.isArray(entry?.supported_reasoning_levels)
      ? entry.supported_reasoning_levels.filter(level => typeof level === 'string')
      : undefined;
    models.push({ id, name: typeof display === 'string' && display.trim() ? display.trim() : id, reasoningLevels: levels });
  }
  return models;
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
 * Full model definition for a discovered id. Stored catalog entries (the
 * remote catalog persisted by the engine) carry authoritative metadata, so
 * they win over the conservative fallbacks used for brand-new ids.
 */
export function anthropicModelDefinition(model, storedById) {
  const stored = storedById?.get(model.id);
  return {
    api: 'anthropic-messages',
    baseUrl: ANTHROPIC_BASE_URL,
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 200_000,
    maxTokens: 64_000,
    compat: { supportsStrictTools: true },
    ...stored,
    id: model.id,
    name: model.name || stored?.name || model.id,
  };
}

export function codexModelDefinition(model, storedById) {
  const stored = storedById?.get(model.id);
  const definition = {
    api: 'openai-codex-responses',
    baseUrl: CODEX_BASE_URL,
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 272_000,
    maxTokens: 128_000,
    compat: { supportsOpenAIGrammarTools: true },
    ...stored,
    id: model.id,
    name: model.name || stored?.name || model.id,
  };
  const thinkingLevelMap = codexThinkingLevelMap(model.reasoningLevels) ?? stored?.thinkingLevelMap;
  if (thinkingLevelMap) definition.thinkingLevelMap = thinkingLevelMap;
  return definition;
}

/**
 * Discovered models first (the subscription's authoritative order), then any
 * stored catalog entries the endpoint did not return so aliases and remote
 * catalog extras stay visible.
 */
export function mergeDiscoveredModels(storedModels, discovered) {
  const merged = [...discovered];
  const seen = new Set(discovered.map(model => model.id));
  for (const model of Array.isArray(storedModels) ? storedModels : []) {
    if (model && typeof model.id === 'string' && !seen.has(model.id)) {
      seen.add(model.id);
      merged.push(model);
    }
  }
  return merged;
}

async function subscriptionModelRefresh(context, { fetchModels, toDefinition }) {
  if (!context?.allowNetwork || context.signal?.aborted || !context.credential) return undefined;
  const stored = Array.isArray(context.stored?.models) ? context.stored.models : [];
  const storedById = new Map(stored.filter(model => model?.id).map(model => [model.id, model]));
  const discovered = await fetchModels(context.credential);
  if (context.signal?.aborted || !discovered.length) return undefined;
  return mergeDiscoveredModels(stored, discovered.map(model => toDefinition(model, storedById)));
}

/** Overlay config for the builtin `anthropic` provider (subscription + API key). */
export function anthropicDiscoveryProviderConfig({ baseUrl = ANTHROPIC_BASE_URL, fetchImpl = globalThis.fetch, timeoutMs } = {}) {
  return {
    api: 'anthropic-messages',
    baseUrl,
    refreshModels: context => subscriptionModelRefresh(context, {
      fetchModels: credential => fetchAnthropicSubscriptionModels(credential, {
        baseUrl,
        fetchImpl,
        signal: discoverySignal(context.signal, timeoutMs),
      }),
      toDefinition: anthropicModelDefinition,
    }),
  };
}

/** Overlay config for the builtin `openai-codex` provider (ChatGPT subscription). */
export function codexDiscoveryProviderConfig({ baseUrl = CODEX_BASE_URL, fetchImpl = globalThis.fetch, timeoutMs, clientVersion } = {}) {
  return {
    api: 'openai-codex-responses',
    baseUrl,
    refreshModels: context => subscriptionModelRefresh(context, {
      fetchModels: credential => fetchCodexSubscriptionModels(credential, {
        baseUrl,
        fetchImpl,
        clientVersion,
        signal: discoverySignal(context.signal, timeoutMs),
      }),
      toDefinition: codexModelDefinition,
    }),
  };
}

/**
 * Register both overlays on a ModelRuntime (or the extension API, which
 * exposes the same registerProvider signature).
 */
export function registerSubscriptionProviders(runtime, options = {}) {
  if (!runtime || typeof runtime.registerProvider !== 'function') throw new TypeError('A ModelRuntime is required.');
  runtime.registerProvider(ANTHROPIC_PROVIDER_ID, anthropicDiscoveryProviderConfig(options));
  runtime.registerProvider(OPENAI_CODEX_PROVIDER_ID, codexDiscoveryProviderConfig(options));
  return runtime;
}
