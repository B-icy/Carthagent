import os from 'node:os';
import { CloudClient, cloudControlUrl, oauthCredentials, openBrowser } from '../cloud/client.mjs';
import { streamSimple as streamOpenAiCompletions } from '../../vendor/agent/chunks/openai-completions-EKZT2IH2.js';

const DEFAULT_BASE_URL = 'https://api.experientiallabs.ai/v1';
const PROVIDER_ID = 'experiential-labs';

export const EXPERIENTIAL_PROVIDER_ID = PROVIDER_ID;
export const EXPERIENTIAL_PROVIDER_NAME = 'Carthagent Cloud';
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

export function experientialModelDefinition(model) {
  const id = typeof model === 'string' ? model : model?.id;
  if (typeof id !== 'string' || !id.trim()) return null;
  const name = typeof model === 'object' && typeof model.name === 'string' && model.name.trim()
    ? model.name.trim()
    : id.trim();
  // GET /v1/models is identity-only. Do not infer capability, context-window,
  // token-limit, or pricing fields from an upstream-looking model name.
  return { id: id.trim(), name };
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
    name: 'Carthagent Cloud account',
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
  return {
    name: EXPERIENTIAL_PROVIDER_NAME,
    baseUrl,
    api: 'openai-completions',
    apiKey: `$${EXPERIENTIAL_API_KEY_ENV}`,
    authHeader: true,
    oauth,
    streamSimple(model, context, options = {}) {
      const managed = isCloudAccessToken(options.apiKey);
      const requestOptions = managed ? {
        ...options,
        onPayload: async (payload, activeModel) => {
          const next = await options.onPayload?.(payload, activeModel);
          const body = next ?? payload;
          return { ...body, metadata: { ...body.metadata, operation_key: globalThis.crypto.randomUUID() } };
        },
      } : options;
      return streamOpenAiCompletions(managed ? { ...model, baseUrl: cloudGatewayUrl(env) } : model, context, requestOptions);
    },
    models: [],
    async refreshModels(context) {
      const storedModels = Array.isArray(context.stored) ? context.stored : (Array.isArray(context.stored?.models) ? context.stored.models : []);
      if (!context.allowNetwork) return storedModels;
      const managed = context.credential?.type === 'oauth';
      const key = context.credential?.type === 'api_key' ? context.credential.key
        : managed ? context.credential.access : '';
      if (!key) return storedModels;
      if (typeof fetchImpl !== 'function') throw new Error('Experiential model discovery requires fetch support.');
      const response = await fetchImpl(`${managed ? cloudGatewayUrl(env) : baseUrl}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${key}` },
        signal: context.signal,
      });
      if (!response.ok) {
        const detail = String(await response.text()).trim().slice(0, 240);
        throw new Error(`Experiential model discovery failed (${response.status})${detail ? `: ${detail}` : ''}`);
      }
      const models = parseExperientialModels(await response.json());
      if (!models.length) throw new Error('Experiential returned no models for this account.');
      return models;
    },
  };
}

export function registerExperientialProvider(runtime, options) {
  if (!runtime || typeof runtime.registerProvider !== 'function') throw new TypeError('A ModelRuntime is required.');
  runtime.registerProvider(PROVIDER_ID, experientialProviderConfig(options));
  return runtime;
}
