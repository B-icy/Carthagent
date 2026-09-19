const DEFAULT_BASE_URL = 'https://api.experientiallabs.ai/v1';
const PROVIDER_ID = 'experiential-labs';

export const EXPERIENTIAL_PROVIDER_ID = PROVIDER_ID;
export const EXPERIENTIAL_PROVIDER_NAME = 'Carthagent Cloud';
export const EXPERIENTIAL_API_KEY_ENV = 'EXPLABS_API_KEY';
export const EXPERIENTIAL_GATEWAY_URL_ENV = 'EXP_GATEWAY_URL';

export function experientialBaseUrl(env = process.env) {
  const override = env?.[EXPERIENTIAL_GATEWAY_URL_ENV]?.trim();
  return (override || DEFAULT_BASE_URL).replace(/\/+$/, '');
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

export function experientialProviderConfig({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const baseUrl = experientialBaseUrl(env);
  return {
    name: EXPERIENTIAL_PROVIDER_NAME,
    baseUrl,
    api: 'openai-completions',
    apiKey: `$${EXPERIENTIAL_API_KEY_ENV}`,
    authHeader: true,
    models: [],
    async refreshModels(context) {
      const storedModels = Array.isArray(context.stored) ? context.stored : (Array.isArray(context.stored?.models) ? context.stored.models : []);
      if (!context.allowNetwork) return storedModels;
      const key = context.credential?.type === 'api_key' ? context.credential.key : '';
      if (!key) return storedModels;
      if (typeof fetchImpl !== 'function') throw new Error('Experiential model discovery requires fetch support.');
      const response = await fetchImpl(`${baseUrl}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${key}` },
        signal: context.signal,
      });
      if (!response.ok) {
        const detail = String(await response.text()).trim().slice(0, 240);
        throw new Error(`Experiential model discovery failed (${response.status})${detail ? `: ${detail}` : ''}`);
      }
      const models = parseExperientialModels(await response.json());
      if (!models.length) throw new Error('Experiential returned no models for this key.');
      return models;
    },
  };
}

export function registerExperientialProvider(runtime, options) {
  if (!runtime || typeof runtime.registerProvider !== 'function') throw new TypeError('A ModelRuntime is required.');
  runtime.registerProvider(PROVIDER_ID, experientialProviderConfig(options));
  return runtime;
}
