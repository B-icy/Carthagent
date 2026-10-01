import os from 'node:os';
import { CloudClient, cloudControlUrl, oauthCredentials, openBrowser } from '../cloud/client.mjs';
import { streamSimple as streamOpenAiCompletions } from '../../vendor/agent/chunks/openai-completions-EKZT2IH2.js';
import { CARTHAGENT_SHIP_PROVIDER_ID, CARTHAGENT_SHIP_PROVIDER_NAME } from './names.mjs';

const DEFAULT_BASE_URL = 'https://api.experientiallabs.ai/v1';
const PROVIDER_ID = CARTHAGENT_SHIP_PROVIDER_ID;
const MANAGED_CLOUD_NON_RETRYABLE_ERRORS = /\b(?:idempotency_key_reused|request_reconciliation_required)\b/i;

const OPENAI_REASONING_LEVELS = Object.freeze({
  off: 'none', minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max',
});
const REQUIRED_REASONING_LEVEL = Object.freeze({
  off: null, minimal: null, low: null, medium: 'medium', high: null, xhigh: null, max: null,
});
const MERCURY_REASONING_LEVELS = Object.freeze({
  off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: null, max: null,
});
const DEEPSEEK_REASONING_LEVELS = Object.freeze({
  off: null, minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max',
});
// SkyPilot's DeepSeek accepts reasoning off; a non-null off level makes the
// engine send thinking:{type:'disabled'} (the mapped string itself is not
// emitted — 'none' also works upstream, but the wire form is the thinking flag).
const SKYPILOT_DEEPSEEK_LEVELS = Object.freeze({
  off: 'none', minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max',
});
// Kimi K3 and GLM 5.3 always reason; 'off' is unavailable upstream.
const TIERED_REASONING_LEVELS = Object.freeze({
  off: null, minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max',
});

// Experiential's /models response is intentionally OpenAI-compatible and often
// identity-only. Keep the capability facts needed by the engine here rather
// than guessing from the selected model at request time.
const EXPERIENTIAL_MODEL_PROFILES = Object.freeze({
  'gpt-5.6-luna': { name: 'GPT-5.6 Luna', reasoning: true, thinkingLevelMap: OPENAI_REASONING_LEVELS, contextWindow: 1_050_000, maxTokens: 128_000, input: ['text', 'image'], compat: { supportsReasoningEffort: true } },
  'gpt-5.6-luna-pro': { name: 'GPT-5.6 Luna Pro', reasoning: true, thinkingLevelMap: OPENAI_REASONING_LEVELS, contextWindow: 1_050_000, maxTokens: 128_000, input: ['text', 'image'], compat: { supportsReasoningEffort: true } },
  'gpt-5.6-sol': { name: 'GPT-5.6 Sol', reasoning: true, thinkingLevelMap: OPENAI_REASONING_LEVELS, contextWindow: 1_050_000, maxTokens: 128_000, input: ['text', 'image'], compat: { supportsReasoningEffort: true } },
  'gpt-5.6-terra': { name: 'GPT-5.6 Terra', reasoning: true, thinkingLevelMap: OPENAI_REASONING_LEVELS, contextWindow: 1_050_000, maxTokens: 128_000, input: ['text', 'image'], compat: { supportsReasoningEffort: true } },
  'gpt-6-astra': { name: 'GPT-6 Astra', reasoning: true, thinkingLevelMap: { ...OPENAI_REASONING_LEVELS, off: null }, contextWindow: 1_050_000, maxTokens: 128_000, input: ['text', 'image'], compat: { supportsReasoningEffort: true } },
  'gpt-6-luna': { name: 'GPT-6 Luna', reasoning: true, thinkingLevelMap: OPENAI_REASONING_LEVELS, contextWindow: 1_050_000, maxTokens: 128_000, input: ['text', 'image'], compat: { supportsReasoningEffort: true } },
  'deepseek-v4-flash': { name: 'DeepSeek V4 Flash', reasoning: true, thinkingLevelMap: DEEPSEEK_REASONING_LEVELS, contextWindow: 1_000_000, maxTokens: 384_000, input: ['text'], compat: { supportsDeveloperRole: false, supportsReasoningEffort: true, thinkingFormat: 'deepseek' } },
  'gpt-6-sol': { name: 'GPT-6 Sol', reasoning: true, thinkingLevelMap: OPENAI_REASONING_LEVELS, contextWindow: 1_050_000, maxTokens: 128_000, input: ['text', 'image'], compat: { supportsReasoningEffort: true } },
  'mercury-2': { name: 'Mercury 2', reasoning: true, thinkingLevelMap: MERCURY_REASONING_LEVELS, contextWindow: 128_000, maxTokens: 50_000, input: ['text'], compat: { supportsReasoningEffort: true } },
  'kimi-k2-thinking': { name: 'Kimi K2 Thinking', reasoning: true, thinkingLevelMap: REQUIRED_REASONING_LEVEL, contextWindow: 262_144, maxTokens: 98_304, input: ['text'], compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, thinkingFormat: 'deepseek' } },
  'qwen3-max-thinking': { name: 'Qwen3 Max Thinking', reasoning: true, thinkingLevelMap: REQUIRED_REASONING_LEVEL, contextWindow: 262_144, maxTokens: 65_536, input: ['text'], compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, thinkingFormat: 'qwen' } },
  'sonar-reasoning-pro': { name: 'Sonar Reasoning Pro', reasoning: true, thinkingLevelMap: REQUIRED_REASONING_LEVEL, input: ['text'], compat: { supportsDeveloperRole: false, supportsReasoningEffort: false } },
  'deepseek-v4.1-flash': { name: 'DeepSeek V4.1 Flash', reasoning: true, thinkingLevelMap: SKYPILOT_DEEPSEEK_LEVELS, contextWindow: 1_048_576, maxTokens: 32_768, input: ['text', 'image'], compat: { supportsDeveloperRole: false, supportsReasoningEffort: true, thinkingFormat: 'deepseek' } },
  'glm-5.3-flash': { name: 'GLM 5.3 Flash', reasoning: true, thinkingLevelMap: TIERED_REASONING_LEVELS, contextWindow: 1_048_576, maxTokens: 32_768, input: ['text', 'image'], compat: { supportsReasoningEffort: true, thinkingFormat: 'zai' } },
  'glm-5.3': { name: 'GLM 5.3', reasoning: true, thinkingLevelMap: TIERED_REASONING_LEVELS, contextWindow: 1_048_576, maxTokens: 32_768, input: ['text'], compat: { supportsReasoningEffort: true, thinkingFormat: 'zai' } },
  'kimi-k3': { name: 'Kimi K3', reasoning: true, thinkingLevelMap: TIERED_REASONING_LEVELS, contextWindow: 1_048_576, maxTokens: 32_768, input: ['text'], compat: { supportsDeveloperRole: false, supportsReasoningEffort: true, thinkingFormat: 'deepseek' } },
});

const MODEL_METADATA_FIELDS = ['reasoning', 'thinkingLevelMap', 'contextWindow', 'maxTokens', 'input', 'output', 'compat'];

export const EXPERIENTIAL_PROVIDER_ID = PROVIDER_ID;
export const EXPERIENTIAL_PROVIDER_NAME = CARTHAGENT_SHIP_PROVIDER_NAME;
export const EXPERIENTIAL_API_KEY_ENV = 'EXPLABS_API_KEY';
export const EXPERIENTIAL_GATEWAY_URL_ENV = 'EXP_GATEWAY_URL';

export function experientialBaseUrl(env = process.env) {
  const gatewayOverride = env?.[EXPERIENTIAL_GATEWAY_URL_ENV]?.trim();
  return (gatewayOverride || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

export function cloudGatewayUrl(env = process.env) {
  return `${cloudControlUrl(env).replace(/\/v1$/, '')}/v1`;
}

export function isCloudAccessToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return false;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof claims.sub === 'string' && typeof claims.sid === 'string'
      && String(claims.scope || '').split(' ').includes('gateway:invoke');
  } catch { return false; }
}

export function createCloudOperationIdentity(id = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)) {
  if (typeof id !== 'function') throw new Error('Managed Cloud requests require UUID support.');
  const operationKey = id();
  if (typeof operationKey !== 'string' || !operationKey.trim()) throw new Error('Managed Cloud operation identity is invalid.');
  return operationKey.trim();
}

export function isManagedCloudNonRetryableError(message) {
  return MANAGED_CLOUD_NON_RETRYABLE_ERRORS.test(String(message || ''));
}

export function managedCloudRequestOptions(options = {}, id) {
  const operationKey = createCloudOperationIdentity(id);
  const inheritedHeaders = options.requestHeaders && typeof options.requestHeaders === 'object'
    ? options.requestHeaders : {};
  return {
    ...options,
    // The gateway currently reserves before dispatch but cannot replay or wait
    // for an existing operation. Retrying this identity would therefore return
    // idempotency_key_reused/request_reconciliation_required instead of the
    // original result. Keep one physical HTTP attempt until replay exists.
    maxRetries: 0,
    requestHeaders: {
      ...inheritedHeaders,
      'Idempotency-Key': operationKey,
      'X-Client-Request-Id': operationKey,
    },
    onPayload: async (payload, activeModel) => {
      const next = await options.onPayload?.(payload, activeModel);
      const body = { ...(next ?? payload), metadata: { ...(next ?? payload).metadata, operation_key: operationKey } };
      // The engine emits thinking:{type:'disabled'} whenever no effort is
      // selected, but always-reasoning upstreams (off level unavailable,
      // thinkingLevelMap.off === null) reject it outright. Omit the field so
      // the model reasons at its default instead.
      if (body.thinking?.type === 'disabled' && activeModel?.thinkingLevelMap?.off === null) {
        delete body.thinking;
      }
      return body;
    },
  };
}

export function experientialModelDefinition(model) {
  const id = typeof model === 'string' ? model : model?.id;
  if (typeof id !== 'string' || !id.trim()) return null;
  const normalizedId = id.trim();
  // Managed aliases may be namespace-qualified (for example openai/gpt-6-luna)
  // while direct Experiential discovery returns the upstream id.
  const profileId = normalizedId.split('/').at(-1);
  const profile = EXPERIENTIAL_MODEL_PROFILES[normalizedId] || EXPERIENTIAL_MODEL_PROFILES[profileId] || {};
  const suppliedName = typeof model === 'object' && typeof model.name === 'string' && model.name.trim()
    ? model.name.trim() : '';
  const definition = { id: normalizedId, name: suppliedName || profile.name || normalizedId, ...profile };

  // Preserve authoritative metadata if a future Experiential response starts
  // publishing it. Stored catalogs also pass through here during offline load.
  if (model && typeof model === 'object') {
    for (const field of MODEL_METADATA_FIELDS) if (model[field] !== undefined) definition[field] = model[field];
    // Managed aliases publish their operating caps (contextWindow = the usable
    // input window, maxTokens = the output ceiling). The model profile may
    // declare a smaller real capability, so keep the stricter value: engine
    // auto-compaction and the output budget then respect both bounds.
    for (const field of ['contextWindow', 'maxTokens']) {
      if (typeof model[field] === 'number' && typeof profile[field] === 'number') {
        definition[field] = Math.min(model[field], profile[field]);
      }
    }
  }

  // Cover explicit fixed-thinking aliases that can be added to the provider
  // before this curated table is updated. This is capability resolution, not
  // context/pricing inference: the name itself declares that reasoning is on.
  if (definition.reasoning === undefined && /(?:^|[-_.])(?:thinking|reasoning)(?:$|[-_.])/i.test(normalizedId)) {
    definition.reasoning = true;
    definition.thinkingLevelMap = REQUIRED_REASONING_LEVEL;
  }
  return definition;
}

export function parseExperientialModels(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const seen = new Set();
  const models = [];
  for (const item of data) {
    const model = experientialModelDefinition(item);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

export function cloudOAuth({ env = process.env, fetchImpl = globalThis.fetch, sleep, now = Date.now, openBrowserImpl = openBrowser } = {}) {
  const client = new CloudClient({ baseUrl: cloudControlUrl(env), fetchImpl, sleep });
  return {
    name: 'Carthagent Ship account',
    async login(interaction) {
      const tokens = await client.authorizeDevice({
        clientName: `Carthagent CLI (${os.hostname()})`,
        signal: interaction.signal,
        notify: event => {
          if (event.type === 'device_code') interaction.onDeviceCode?.({
            userCode: event.userCode,
            verificationUri: event.verificationUri,
            intervalSeconds: event.intervalSeconds,
            expiresInSeconds: event.expiresInSeconds,
          });
          else if (event.type === 'auth_url') {
            Promise.resolve(openBrowserImpl?.(event.url)).catch(() => false);
            interaction.onAuth?.({ url: event.url, instructions: `${event.instructions} The URL is also shown if Carthagent cannot open it automatically.` });
          }
          else if (event.type === 'progress') interaction.onProgress?.(event.message);
        },
      });
      return oauthCredentials(tokens, now());
    },
    async refreshToken(credentials, signal) {
      return oauthCredentials(await client.refresh({ refreshToken: credentials.refresh, signal }), now());
    },
    getApiKey(credentials) { return credentials.access; },
  };
}

export function experientialProviderConfig({ env = process.env, fetchImpl = globalThis.fetch, sleep, now, openBrowserImpl } = {}) {
  const oauth = cloudOAuth({ env, fetchImpl, sleep, now, openBrowserImpl });
  const baseUrl = experientialBaseUrl(env);
  const dynamicModels = [];
  const installModels = models => {
    dynamicModels.splice(0, dynamicModels.length, ...models);
  };
  return {
    name: EXPERIENTIAL_PROVIDER_NAME,
    baseUrl,
    api: 'openai-completions',
    apiKey: `$${EXPERIENTIAL_API_KEY_ENV}`,
    authHeader: true,
    oauth,
    streamSimple(model, context, options = {}) {
      const managed = isCloudAccessToken(options.apiKey);
      const requestOptions = managed ? managedCloudRequestOptions(options) : options;
      const stream = streamOpenAiCompletions(managed ? { ...model, baseUrl: cloudGatewayUrl(env) } : model, context, requestOptions);
      if (!managed) return stream;
      const result = stream.result.bind(stream);
      stream.result = async () => {
        const message = await result();
        if (message?.stopReason === 'error' && isManagedCloudNonRetryableError(message.errorMessage)) {
          message.errorMessage = `Carthagent Ship cannot safely replay this operation yet. ${message.errorMessage}`;
        }
        return message;
      };
      return stream;
    },
    models: dynamicModels,
    async refreshModels(context) {
      const storedModels = Array.isArray(context.stored) ? context.stored : (Array.isArray(context.stored?.models) ? context.stored.models : []);
      if (storedModels.length) {
        const restored = storedModels.map(experientialModelDefinition).filter(Boolean);
        if (context.publish) await context.publish({ update: () => installModels(restored) });
        else installModels(restored);
      }
      if (!context.allowNetwork) return storedModels;
      const managed = context.credential?.type === 'oauth';
      const key = context.credential?.type === 'api_key' ? context.credential.key
        : managed ? context.credential.access : '';
      if (!key) return storedModels;
      if (typeof fetchImpl !== 'function') throw new Error('Carthagent Ship model discovery requires fetch support.');
      const response = await fetchImpl(`${managed ? cloudGatewayUrl(env) : baseUrl}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${key}` },
        signal: context.signal,
      });
      if (!response.ok) {
        const detail = String(await response.text()).trim().slice(0, 240);
        throw new Error(`Carthagent Ship model discovery failed (${response.status})${detail ? `: ${detail}` : ''}`);
      }
      const models = parseExperientialModels(await response.json());
      if (!models.length) throw new Error('Carthagent Ship returned no models for this account.');
      if (context.publish) {
        await context.publish({
          persist: { models, checkedAt: Date.now() },
          update: () => installModels(models),
        });
      } else installModels(models);
      return models;
    },
  };
}

export function registerExperientialProvider(runtime, options) {
  if (!runtime || typeof runtime.registerProvider !== 'function') throw new TypeError('A ModelRuntime is required.');
  runtime.registerProvider(PROVIDER_ID, experientialProviderConfig(options));
  return runtime;
}
