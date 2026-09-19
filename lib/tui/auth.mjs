/**
 * Provider authentication for the carthagent console.
 *
 * pi ships a programmatic `ModelRuntime.login(providerId, type, interaction)`
 * API (see `readStoredCredential` / `ModelRuntime` in the bundled engine).
 * This module wraps it so the TUI can drive login as an in-console popup
 * instead of handing the terminal over to pi's interactive mode.
 *
 * The pure helpers here are unit-tested in tests/auth.test.mjs; the runtime
 * loader imports the (heavy) bundled engine lazily, only when auth is opened.
 */
import { CloudClient, cloudControlUrl, formatCloudAccount } from '../cloud/client.mjs';
import { EXPERIENTIAL_PROVIDER_ID, registerExperientialProvider } from '../providers/experiential.mjs';

const PROVIDER_ORDER = new Map([
  ['experiential-labs', 0],
  ['anthropic', 10],
  ['openai-codex', 20],
  ['openai', 21],
  ['openrouter', 30],
]);

/** Auth methods a provider advertises, in display order (subscription first). */
export function authTypes(provider) {
  const out = [];
  if (provider?.auth?.oauth) out.push('oauth');
  if (provider?.auth?.apiKey) out.push('api_key');
  return out;
}

export function authTypeLabel(type, providerId) {
  if (type === 'oauth' && providerId === EXPERIENTIAL_PROVIDER_ID) return 'browser sign-in';
  return type === 'oauth' ? 'subscription (OAuth)' : 'API key';
}

/**
 * Rows the shared provider picker can show. Ordering is product policy, not
 * connection state: Experiential stays first, recommended providers retain
 * fixed positions, and every other provider follows alphabetically.
 */
export function loginProviderList(runtime, { activeProviderId } = {}) {
  const rows = [];
  for (const provider of runtime.getProviders()) {
    const types = authTypes(provider);
    if (!types.length) continue;
    let configured = false;
    try { configured = !!runtime.getProviderAuthStatus(provider.id).configured; } catch { /* unknown */ }
    rows.push({
      id: provider.id,
      name: provider.name || provider.id,
      types,
      configured,
      recommended: provider.id === 'experiential-labs',
      priority: PROVIDER_ORDER.get(provider.id) ?? 1000,
    });
  }
  rows.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  if (activeProviderId) rows.forEach(row => { row.active = row.id === activeProviderId; });
  return rows;
}

/** New installs focus the recommended row; returning users focus their active provider. */
export function loginProviderFocus(rows, activeProviderId) {
  const active = activeProviderId ? rows.findIndex(row => row.id === activeProviderId) : -1;
  if (active >= 0) return active;
  const recommended = rows.findIndex(row => row.recommended);
  return recommended >= 0 ? recommended : 0;
}

/** Case-insensitive filter over provider id/name. */
export function filterLoginProviders(rows, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(r => r.id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
}

/**
 * Fold one `notify(event)` from `runtime.login` into popup-facing fields.
 * `state` is mutated and returned for convenience. The popup owns `message`.
 */
export function applyAuthEvent(state, event) {
  if (!event || typeof event !== 'object') return state;
  switch (event.type) {
    case 'auth_url':
      state.url = event.url || '';
      state.instructions = event.instructions || '';
      state.message = 'Open the authorization URL in your browser';
      break;
    case 'device_code':
      state.deviceCode = { userCode: event.userCode || '', verificationUri: event.verificationUri || '' };
      state.message = 'Enter the code at the verification URL';
      break;
    case 'info':
      if (event.message) state.message = event.message;
      if (Array.isArray(event.links)) state.links = event.links;
      break;
    case 'progress':
      if (event.message) state.message = event.message;
      break;
    default:
      break;
  }
  return state;
}

/** Fresh popup state in the provider-picking phase. */
export function newAuthState() {
  return {
    phase: 'providers', // providers | type | prompt | waiting
    providers: [],
    filter: '',
    sel: 0,
    typeSel: 0,
    promptSel: 0,
    provider: null,
    type: null,
    prompt: null,
    input: '',
    message: '',
    instructions: '',
    url: '',
    links: [],
    deviceCode: null,
    error: '',
    busy: false,
  };
}

let runtimePromise = null;

/** Lazily create a ModelRuntime bound to carthagent's isolated agent directory. */
export function loadAuthRuntime() {
  if (!runtimePromise) {
    runtimePromise = import('../../vendor/agent/index.js')
      .then(async pi => registerExperientialProvider(await pi.ModelRuntime.create({})))
      .catch(error => { runtimePromise = null; throw error; });
  }
  return runtimePromise;
}

/** Start a provider login; `prompt`/`notify`/`signal` follow pi's contract. */
export function startLogin(runtime, providerId, type, interaction) {
  return runtime.login(providerId, type, interaction);
}

/** Authenticate, then refresh that provider so dynamic model discovery is immediate. */
export async function loginAndRefresh(runtime, providerId, type, interaction) {
  const result = await startLogin(runtime, providerId, type, interaction);
  await runtime.refresh?.({ providers: [providerId], allowNetwork: true, signal: interaction?.signal });
  return result;
}

async function cloudAccessToken(runtime) {
  if (!runtime?.isUsingOAuth?.(EXPERIENTIAL_PROVIDER_ID)) throw new Error('cloud_login_required');
  const resolution = await runtime.getAuth(EXPERIENTIAL_PROVIDER_ID);
  const accessToken = resolution?.auth?.apiKey;
  if (!accessToken) throw new Error('cloud_login_required');
  return accessToken;
}

export async function loadCloudAccount(runtime, { env = process.env, fetchImpl = globalThis.fetch, signal } = {}) {
  const accessToken = await cloudAccessToken(runtime);
  return new CloudClient({ baseUrl: cloudControlUrl(env), fetchImpl }).account({ accessToken, signal });
}

export async function createCloudBillingLink(runtime, action, { env = process.env, fetchImpl = globalThis.fetch, signal } = {}) {
  const accessToken = await cloudAccessToken(runtime);
  const client = new CloudClient({ baseUrl: cloudControlUrl(env), fetchImpl });
  const returnUrl = `${cloudControlUrl(env)}/account`;
  if (action === 'checkout') return client.checkout({ accessToken, successUrl: returnUrl, cancelUrl: returnUrl, signal });
  if (action === 'portal') return client.portal({ accessToken, returnUrl, signal });
  throw new Error('unknown_billing_action');
}

export async function revokeCloudSession(runtime, sessionId, { env = process.env, fetchImpl = globalThis.fetch, signal } = {}) {
  const accessToken = await cloudAccessToken(runtime);
  return new CloudClient({ baseUrl: cloudControlUrl(env), fetchImpl }).revokeSession({ accessToken, sessionId, signal });
}

export { formatCloudAccount };
