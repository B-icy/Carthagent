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

/** Auth methods a provider advertises, in display order (subscription first). */
export function authTypes(provider) {
  const out = [];
  if (provider?.auth?.oauth) out.push('oauth');
  if (provider?.auth?.apiKey) out.push('api_key');
  return out;
}

export function authTypeLabel(type) {
  return type === 'oauth' ? 'subscription (OAuth)' : 'API key';
}

/**
 * Rows the login popup can show: `{ id, name, types, configured }`.
 * Providers without a login method are skipped; configured ones sort first.
 */
export function loginProviderList(runtime) {
  const rows = [];
  for (const provider of runtime.getProviders()) {
    const types = authTypes(provider);
    if (!types.length) continue;
    let configured = false;
    try { configured = !!runtime.getProviderAuthStatus(provider.id).configured; } catch { /* unknown */ }
    rows.push({ id: provider.id, name: provider.name || provider.id, types, configured });
  }
  rows.sort((a, b) => (a.configured === b.configured) ? a.name.localeCompare(b.name) : (a.configured ? -1 : 1));
  return rows;
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
      .then(pi => pi.ModelRuntime.create({}))
      .catch(error => { runtimePromise = null; throw error; });
  }
  return runtimePromise;
}

/** Start a provider login; `prompt`/`notify`/`signal` follow pi's contract. */
export function startLogin(runtime, providerId, type, interaction) {
  return runtime.login(providerId, type, interaction);
}
