export const NATIVE_LOGIN_PROVIDERS = Object.freeze([
  Object.freeze({ id: 'experiential-labs', name: 'Carthagent Ship', aliases: ['ship'], oauth: 'carthagent-device' }),
  Object.freeze({ id: 'anthropic', name: 'Claude / Anthropic', aliases: ['claude', 'claudecode'] }),
  Object.freeze({ id: 'xai', name: 'xAI / Grok', aliases: ['grok', 'xai-code'], oauth: 'device' }),
  Object.freeze({ id: 'openai', name: 'Codex / OpenAI', aliases: ['codex', 'openai-codex'], oauth: 'chatgpt-token-sharing' }),
  Object.freeze({ id: 'google', name: 'Gemini', aliases: ['gemini'] }),
]);

export function nativeLoginProvider(value) {
  const key = String(value || '').trim().toLowerCase();
  return NATIVE_LOGIN_PROVIDERS.find(provider => provider.id === key || provider.name.toLowerCase() === key || provider.aliases.includes(key));
}

export function nativeLoginProviders(integrations) {
  return NATIVE_LOGIN_PROVIDERS.flatMap(provider => {
    const integration = integrations.find(item => item.id === provider.id);
    return integration ? [{ ...integration, name: provider.name }] : [];
  });
}

export function nativeProviderName(value) {
  return nativeLoginProvider(value)?.name ?? String(value || '');
}
