import type { Context } from '@opencode/plugin/promise/plugin';
import { trimHistoryMedia } from './history-media.mjs';
import type { ConnectionInfo } from '@opencode/client';
import type { Credential } from '@opencode/schema/credential';
import type { SessionModelRequest } from '@opencode/plugin/promise/session';
import type { Form } from '@opencode/schema/form';
import { Model } from '@opencode/schema/model';
import { Provider } from '@opencode/schema/provider';
import { Integration as IntegrationSchema } from '@opencode/schema/integration';
import { Money } from '@opencode/schema/money';
import {
  CloudClient, cloudControlUrl, cloudManagedUsageRecovery, oauthCredentials, openBrowser,
} from '../../../../lib/cloud/client.mjs';
import {
  parseExperientialModels, experientialModelDefinition, cloudGatewayUrl,
  EXPERIENTIAL_API_KEY_ENV, EXPERIENTIAL_GATEWAY_URL_ENV,
  EXPERIENTIAL_PROVIDER_ID, EXPERIENTIAL_PROVIDER_NAME,
  experientialBaseUrl,
} from '../../../../lib/providers/experiential.mjs';
import {
  ANTHROPIC_PROVIDER_ID, OPENAI_CODEX_PROVIDER_ID,
  anthropicModelDefinition, codexModelDefinition,
  fetchAnthropicSubscriptionModels, fetchCodexSubscriptionModels,
  parseAnthropicModels, parseCodexModels,
} from '../../../../lib/providers/subscription-models.mjs';
import { catalogModels } from '../../../../lib/providers/model-catalog.mjs';
import { shipAgentDir } from '../../../../lib/ship-auth.mjs';
import { createHash } from 'node:crypto';
import { legacyOAuthForOpenCode, migrateLegacyShipCredentialIds, nativeCredentialFile, nativeCredentialDatabaseFile, pruneRefreshReceipts, readNativeOAuthCredential, refreshNativeCredential, refreshSingleFlight } from '../../../../lib/opencode/credentials.mjs';
import { createDeviceAuthController } from './device-auth.ts';
import { createSessionIdentity, isManagedShipCredential, sessionRunMode, shipTelemetryHeaders } from './telemetry.ts';
import { nativeLoginProvider } from '../../../../lib/opencode/provider-policy.mjs';

const OAUTH_METHOD = 'carthagent-device';
const SHIP_INTEGRATION_ID = EXPERIENTIAL_PROVIDER_ID;
const DISCOVERY_TIMEOUT = 10_000;
// Must stay well under the host's fixed 5s plugin-activation deadline.
const INITIAL_DISCOVERY_WAIT = 2_000;
const PROFILE_CAP = 200;
const CACHE_KEY = 'ctg.models/subscriptions/';
const RUN_MODE = new Set(['interactive', 'print', 'rpc']);
// Cloudflare abandons an origin that sends no headers within 100 seconds, so a
// managed request still waiting at 120 seconds has stalled on the way there.
const MANAGED_HEADER_TIMEOUT = 120_000;
const MANAGED_RETRY_DELAY = 1_000;
const MANAGED_REPLAY_WINDOW = 15_000;
const MANAGED_DUPLICATE_MESSAGE = 'The connection dropped after Carthagent Cloud received this request, so it was not sent again to avoid a double charge. Send your message again to continue. (idempotency_key_reused)';

/** A transport failure with no HTTP status never received response headers. */
function droppedBeforeResponse(error: { type?: string; status?: number; response?: unknown } | undefined) {
  return error?.type === 'provider.transport' && error.status === undefined && error.response === undefined;
}

function signalWithTimeout(signal: AbortSignal | undefined, timeout: number) {
  const timeoutSignal = AbortSignal.timeout(timeout);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function providerInfo(id: string, name: string, pkg: string, integrationID?: string, settings: Record<string, unknown> = {}): Provider.Info {
  return {
    ...Provider.Info.empty(Provider.ID.make(id)),
    name,
    activation: 'enabled',
    package: pkg,
    settings,
    ...(integrationID ? { integrationID: IntegrationSchema.ID.make(integrationID) } : {}),
  } as Provider.Info;
}

interface CatalogModel {
  id: string;
  modelID?: string;
  name?: string;
  input?: string[];
  output?: string[];
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; tiers?: Array<{ input: number; output: number; inputTokensAbove: number; cacheRead?: number; cacheWrite?: number }> };
  contextWindow?: number;
  maxTokens?: number;
  temperature?: boolean;
  baseUrl?: string;
  compat?: Record<string, unknown>;
}

function modelInfo(providerID: string, profile: CatalogModel, defaultBaseURL: string): Model.Info {
  const input = profile.input ?? ['text'];
  const output = profile.output ?? ['text'];
  const id = Model.ID.make(String(profile.id));
  const price = profile.cost;
  const cost: Model.Cost[] = price && Number.isFinite(price.input) && Number.isFinite(price.output)
    ? [{ input: Money.USDPerMillionTokens.make(price.input!), output: Money.USDPerMillionTokens.make(price.output!),
      cache: { read: Money.USDPerMillionTokens.make(price.cacheRead ?? 0), write: Money.USDPerMillionTokens.make(price.cacheWrite ?? 0) } }]
    : [];
  for (const tier of price?.tiers ?? []) {
    if (!Number.isFinite(tier.input) || !Number.isFinite(tier.output) || !Number.isFinite(tier.inputTokensAbove)) continue;
    cost.push({ tier: { type: 'context', size: tier.inputTokensAbove }, input: Money.USDPerMillionTokens.make(tier.input), output: Money.USDPerMillionTokens.make(tier.output),
      cache: { read: Money.USDPerMillionTokens.make(tier.cacheRead ?? 0), write: Money.USDPerMillionTokens.make(tier.cacheWrite ?? 0) } });
  }
  const base = Model.Info.default(Provider.ID.make(providerID), id);
  return {
    ...base,
    id,
    modelID: Model.ID.make(String(profile.modelID || id)),
    name: profile.name || String(id),
    family: Model.Family.make(String(id).split(/[-/]/)[0]),
    capabilities: { tools: true, input, output, ...(typeof profile.temperature === 'boolean' ? { temperature: profile.temperature } : {}) },
    cost,
    limit: { context: Math.trunc(profile.contextWindow ?? 128_000), output: Math.trunc(profile.maxTokens ?? 16_384) },
    settings: profile.baseUrl || defaultBaseURL ? { baseURL: profile.baseUrl || defaultBaseURL } : {},
    ...(profile.compat ? { compatibility: mapCompatibility(profile.compat) } : {}),
  } as Model.Info;
}

function mapCompatibility(compat: Record<string, unknown>): NonNullable<Model.Info['compatibility']> {
  const keys = [
    'reasoningField', 'requireReasoning', 'reasoningPlaceholder', 'maxTokensField', 'requireFinishReason',
    'requireAssistantAfterTool', 'supportsPromptCacheKey', 'cacheFormat',
    'supportsThinkingBlockBinding', 'supportsEffortUpdates',
  ] as const;
  return Object.fromEntries(keys.flatMap(key => key in compat ? [[key, compat[key]]] : [])) as NonNullable<Model.Info['compatibility']>;
}

function oauthMethod({ env, fetchImpl, sleep, now, openBrowserImpl, agentDir, startDeviceFlow, credentialFile, coordinationFile, legacyImportAvailable }: {
  env: NodeJS.ProcessEnv;
  legacyImportAvailable: boolean;
  fetchImpl: typeof fetch;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  now: () => number;
  openBrowserImpl: typeof openBrowser;
  agentDir: string;
  startDeviceFlow: () => Promise<{ authorization: { userCode: string; verificationUri: string; verificationUriComplete?: string; expiresIn: number; interval: number; deviceCode: string }; callback: Promise<Credential.OAuth> }>;
  credentialFile: string;
  coordinationFile: string;
}) {
  const client = new CloudClient({ baseUrl: cloudControlUrl(env), fetchImpl, sleep: ms => sleep(ms) });
  return {
    integrationID: IntegrationSchema.ID.make(SHIP_INTEGRATION_ID),
    method: {
      id: OAUTH_METHOD, type: 'oauth' as const, label: 'Continue with Carthagent Cloud',
      // Offer one-way import only when a usable stable/Pi sign-in exists, so
      // fresh users keep a single browser sign-in flow.
      ...(legacyImportAvailable ? { form: [{ type: 'boolean' as const, key: 'importLegacy', title: 'Import an existing stable Carthagent Cloud sign-in?', default: false }] satisfies Form.Fields } : {}),
    },
    authorize: async (answer: Form.Answer) => {
      // The legacy file intentionally survives migration. Never let its presence
      // short-circuit an explicit sign-in or recovery from revoked/old scopes.
      const legacy = legacyImportAvailable && answer.importLegacy === true ? await legacyOAuthForOpenCode({ agentDir }) : undefined;
      if (legacy) {
        return {
          mode: 'auto' as const,
          url: 'https://api.carthagent.xyz',
          instructions: 'A legacy Carthagent Cloud credential was found and will be migrated into native integration storage.',
          callback: Promise.resolve({
            type: 'oauth' as const,
            methodID: IntegrationSchema.MethodID.make(OAUTH_METHOD),
            access: legacy.access,
            refresh: legacy.refresh,
            expires: Math.trunc(legacy.expires),
          } as Credential.OAuth),
        };
      }
      const { authorization: response, callback } = await startDeviceFlow();
      const url = response.verificationUriComplete || response.verificationUri;
      Promise.resolve(openBrowserImpl(url)).catch(() => false);
      return {
        mode: 'auto' as const, url,
        instructions: `Sign in and connect this terminal using code ${response.userCode}. Check the account shown in your browser, then return here. If the code expires, start login again.`,
        expiresAt: now() + Number(response.expiresIn || 600) * 1000,
        callback,
      };
    },
    refresh: (credential: Credential.OAuth) => refreshSingleFlight(
      `${coordinationFile}:${credential.methodID}:${credential.refresh}`,
      async () => {
        const credentialID = await readNativeOAuthCredential({ credentialFile,
          integrationID: SHIP_INTEGRATION_ID, methodID: credential.methodID, refreshToken: credential.refresh });
        return refreshNativeCredential({
          credential,
          credentialFile: coordinationFile,
          credentialID,
          reread: () => readNativeOAuthCredential({ credentialFile, credentialID,
            integrationID: SHIP_INTEGRATION_ID, methodID: credential.methodID }),
          refresh: async (current: Credential.OAuth) => ({ type: 'oauth' as const, methodID: IntegrationSchema.MethodID.make(OAUTH_METHOD),
            ...oauthCredentials(await client.refresh({ refreshToken: current.refresh, signal: AbortSignal.timeout(10_000) }), now()),
            ...(current.metadata ? { metadata: current.metadata } : {}) }),
        });
      },
    ),
    label: () => 'Carthagent Cloud',
  };
}

function integrationDefinitions(editor: Parameters<Context['integration']['transform']>[0] extends (editor: infer E) => void ? E : never, options: Parameters<typeof oauthMethod>[0]) {
  editor.method.update(oauthMethod(options));
  if (options.env.CARTHAGENT_ADVANCED_AUTH === '1') {
    editor.method.update({ integrationID: IntegrationSchema.ID.make(SHIP_INTEGRATION_ID), method: { type: 'key', label: 'Advanced: use an Experiential API key' } });
  }
  editor.method.update({ integrationID: IntegrationSchema.ID.make(SHIP_INTEGRATION_ID), method: { type: 'env', names: [EXPERIENTIAL_API_KEY_ENV] } });
  editor.update(SHIP_INTEGRATION_ID, integration => { integration.name = EXPERIENTIAL_PROVIDER_NAME; });
}

function asModelInfo(providerID: string, model: { id: string }, baseURL: string) {
  const fixed = experientialModelDefinition(model);
  return modelInfo(providerID, fixed, baseURL);
}

async function loadShipModels({ ctx, fetchImpl, env, baseURL, signal }: {
  ctx: Context; fetchImpl: typeof fetch; env: NodeJS.ProcessEnv; baseURL: string; signal?: AbortSignal;
}): Promise<{ models: ReturnType<typeof parseExperientialModels>; connection: ConnectionInfo | undefined; managed: boolean }> {
  const connection = await ctx.integration.connection.active(SHIP_INTEGRATION_ID);
  if (!connection) return { models: [], connection: undefined, managed: false };
  const credential = await ctx.integration.connection.resolve(connection);
  const key = credential?.type === 'key' ? credential.key : credential?.type === 'oauth' ? credential.access : '';
  if (!key) return { models: [], connection, managed: false };
  const managed = isManagedShipCredential(credential);
  const response = await fetchImpl(`${managed ? cloudGatewayUrl(env) : baseURL}/models`, {
    headers: { authorization: `Bearer ${key}` }, signal: signalWithTimeout(signal, DISCOVERY_TIMEOUT),
  });
  if (!response.ok) throw new Error(`Carthagent Cloud model discovery failed (${response.status}).`);
  const models = parseExperientialModels(await response.json()).slice(0, PROFILE_CAP);
  if (connection && managed) return { connection, models, managed };
  return { connection, models, managed };
}

/** Register CTG Ship plus subscription inventory on OpenCode's native provider
 * engine. OpenCode owns all inference transport; hooks only add metadata and
 * idempotency identity to native HTTP requests. */
interface ProviderRegistrationOptions {
  env?: NodeJS.ProcessEnv;
  /** Upper bound on waiting for the first Cloud model discovery at startup. */
  initialDiscoveryWaitMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  agentDir?: string;
  credentialFile?: string;
  vaultFile?: string;
  openBrowser?: typeof openBrowser;
  telemetryIdentity?: ReturnType<typeof createSessionIdentity>;
  sessionIdentity?: (event: SessionModelRequest) => string;
  requestSecret?: string;
  onRecovery?: (recovery: unknown, context: { sessionID: string; kind: string }) => void;
  deviceAuth?: ReturnType<typeof import('./device-auth').createDeviceAuthController>;
}

export async function registerProviders(ctx: Context, options: ProviderRegistrationOptions = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));
  const agentDir = options.agentDir ?? shipAgentDir(env);
  const openBrowserImpl = options.openBrowser ?? openBrowser;
  const deviceAuth = options.deviceAuth ?? createDeviceAuthController({ env, fetchImpl, agentDir, now, sleep });
  // credentialFile historically selects the coordination namespace. Retain
  // the fixture shorthand (one explicit path for both) unless vaultFile is set.
  const coordinationFile = options.credentialFile ?? nativeCredentialFile(env);
  const credentialFile = options.vaultFile ?? options.credentialFile ?? nativeCredentialDatabaseFile(env, ctx.app.channel);
  // Fold credentials stored under the pre-rename 'experiential-labs' provider
  // id into 'carthagent-cloud' so existing sign-ins keep working.
  await migrateLegacyShipCredentialIds({ credentialFile }).catch(() => 0);
  const legacyImportAvailable = Boolean(await legacyOAuthForOpenCode({ agentDir }).catch(() => undefined));
  // Awaited so the vault handle is closed before startup continues (Windows).
  await pruneRefreshReceipts({ coordinationFile, vaultFile: credentialFile }).catch(() => 0);
  const requestIdentity = options.sessionIdentity;
  const identity = options.telemetryIdentity ?? createSessionIdentity();
  const requestSecret = options.requestSecret ?? `${ctx.location?.project?.id || ctx.location?.directory || 'ctg'}:request-v1`;
  const registrations: Array<{ dispose: () => Promise<void> }> = [];
  const controller = new AbortController();
  let eventTask: Promise<void> | undefined;
  const disposeRegistrations = async () => {
    const failures: unknown[] = [];
    for (const registration of registrations.splice(0).reverse()) {
      try { await registration.dispose?.(); }
      catch (error) { failures.push(error); }
    }
    return failures;
  };
  try {
  const excludedIntegrations = new Set<string>();
  const integration = await ctx.integration.transform(editor => {
    integrationDefinitions(editor, {
    env, fetchImpl, sleep, now, openBrowserImpl, agentDir, startDeviceFlow: deviceAuth.start,
    credentialFile,
    coordinationFile,
    legacyImportAvailable,
    });
    for (const integration of editor.list()) {
      const supported = nativeLoginProvider(integration.id);
      if (supported) editor.update(integration.id, item => { item.name = supported.name; });
      else {
        excludedIntegrations.add(integration.id);
        editor.remove(integration.id);
      }
    }
  });
  registrations.push(integration);

  const baseURL = experientialBaseUrl(env);
  let shipModels: Model.Info[] = [];
  let shipConnection: ConnectionInfo | undefined;
  let shipManaged = false;
  const subscriptions: Record<string, Model.Info[]> = { [ANTHROPIC_PROVIDER_ID]: [], [OPENAI_CODEX_PROVIDER_ID]: [] };
  const subscriptionConnections: Partial<Record<string, ConnectionInfo>> = {};
  const providerRegistration = await ctx.provider.transform(editor => {
    for (const { provider } of editor.list()) {
      if (provider.id.startsWith('opencode') || excludedIntegrations.has(provider.integrationID ?? provider.id)) editor.remove(provider.id);
    }
    editor.add({ info: providerInfo(EXPERIENTIAL_PROVIDER_ID, EXPERIENTIAL_PROVIDER_NAME,
      '@opencode/ai/providers/openai-compatible', SHIP_INTEGRATION_ID,
      { baseURL, apiKey: `$${EXPERIENTIAL_API_KEY_ENV}`, ...(shipManaged ? { headerTimeout: MANAGED_HEADER_TIMEOUT } : {}) }),
      models: shipModels, sourceConnection: shipConnection });
    // Subscription IDs already exist in the native catalog. Overlay only the
    // definitions and retain catalog cost/capability metadata.
    for (const [providerID, baseURL] of [
      [ANTHROPIC_PROVIDER_ID, 'https://api.anthropic.com'],
      [OPENAI_CODEX_PROVIDER_ID, 'https://chatgpt.com/backend-api'],
    ] as const) {
      const existing = editor.get(providerID);
      const models: readonly Model.Info[] = subscriptions[providerID].length
        ? subscriptions[providerID]
        : (existing ? [...existing.models.values()] : catalogModels(providerID).map((model: CatalogModel) => modelInfo(providerID, model, baseURL)));
      if (existing && subscriptionConnections[providerID]) {
        editor.add({ info: existing.provider, models, sourceConnection: subscriptionConnections[providerID] });
      } else if (subscriptions[providerID].length) {
        editor.models.set(providerID, models);
      }
    }
  });
  registrations.push(providerRegistration);

  // Run mode is per session (the service env is shared by TUI and headless
  // launches); analytics only, so a lookup failure falls back silently.
  const runModes = new Map<string, string>();
  const runModeFor = async (sessionID: string) => {
    const key = String(sessionID || '');
    const cached = runModes.get(key);
    if (cached) return cached;
    const session = key && typeof ctx.session.get === 'function'
      ? await Promise.resolve().then(() => ctx.session.get({ sessionID: key })).catch(() => undefined)
      : undefined;
    const mode = sessionRunMode(session as { metadata?: Record<string, unknown> } | undefined, env);
    if (session) {
      if (runModes.size >= 1000) runModes.delete(runModes.keys().next().value as string);
      runModes.set(key, mode);
    }
    return mode;
  };

  // Managed requests sent without response headers yet, the one request ID a
  // session retry may reuse, and IDs that were already retried once.
  const unanswered = new Map<string, { id: string; kind: string }>();
  const replays = new Map<string, { id: string; kind: string; at: number }>();
  const retried = new Map<string, true>();
  const remember = <T>(map: Map<string, T>, key: string, value: T) => {
    map.delete(key);
    if (map.size >= 1000) map.delete(map.keys().next().value as string);
    map.set(key, value);
  };

  const providerHook = await ctx.session.hook('http.request', async event => {
    if (event.model.providerID !== EXPERIENTIAL_PROVIDER_ID) return;
    let credential;
    try {
      const active = await ctx.integration.connection.active(SHIP_INTEGRATION_ID);
      if (active) credential = await ctx.integration.connection.resolve(active);
    } catch { return; }
    if (!isManagedShipCredential(credential)) return;
    const body = await event.request.clone().text().catch(() => '');
    const headers = new Headers(event.request.headers);
    const telemetry = shipTelemetryHeaders({
      sessionID: event.sessionID, kind: event.kind, body, env, agentDir,
      identity, runMode: await runModeFor(event.sessionID),
      requestID: event.request.headers.get('x-carthagent-request-id') || identity.request(event.sessionID, event.kind),
      requestSecret,
    });
    for (const [name, value] of Object.entries(telemetry)) headers.set(name, String(value));
    headers.set('Idempotency-Key', telemetry['x-carthagent-request-id']);
    headers.set('X-Client-Request-Id', telemetry['x-carthagent-request-id']);
    event.request = new Request(event.request, { headers });
    // Only agent-loop requests go through the session retry decision.
    if (event.kind === 'primary') remember(unanswered, String(event.sessionID), { id: telemetry['x-carthagent-request-id'], kind: event.kind });
  }, { providerID: EXPERIENTIAL_PROVIDER_ID });
  registrations.push(providerHook);

  const routeHook = await ctx.session.hook('model.request', async event => {
    if (event.model.providerID !== EXPERIENTIAL_PROVIDER_ID) return;
    if (event.kind === 'primary') unanswered.delete(String(event.sessionID));
    const pending = replays.get(String(event.sessionID));
    if (pending?.kind === event.kind) replays.delete(String(event.sessionID));
    // A retry that did not start promptly (the user stopped it) is not reused.
    const replay = pending?.kind === event.kind && now() - pending.at < MANAGED_REPLAY_WINDOW ? pending : undefined;
    event.headers['x-carthagent-request-id'] = replay ? replay.id
      : requestIdentity ? requestIdentity(event)
      : identity.request(event.sessionID, event.kind);
    const active = await ctx.integration.connection.active(SHIP_INTEGRATION_ID).catch(() => undefined);
    if (!active) return;
    const credential = await ctx.integration.connection.resolve(active).catch(() => undefined);
    if (isManagedShipCredential(credential)) event.baseURL = cloudGatewayUrl(env);
  }, { providerID: EXPERIENTIAL_PROVIDER_ID });
  registrations.push(routeHook);

  // Cloud rejects requests over the model's byte budget (request_too_large);
  // old inline screenshots would otherwise be resent on every later turn.
  const mediaBudget = await ctx.session.hook('context', async event => {
    if (event.model.providerID !== EXPERIENTIAL_PROVIDER_ID) return;
    const trimmed = trimHistoryMedia(event.messages);
    if (trimmed.omitted) event.messages = trimmed.messages;
  }, { providerID: EXPERIENTIAL_PROVIDER_ID });
  registrations.push(mediaBudget);

  const managedRetry = await ctx.session.hook('retry', async event => {
    if (event.model.providerID !== EXPERIENTIAL_PROVIDER_ID) return;
    const active = await ctx.integration.connection.active(SHIP_INTEGRATION_ID).catch(() => undefined);
    const credential = active ? await ctx.integration.connection.resolve(active).catch(() => undefined) : undefined;
    if (!isManagedShipCredential(credential)) return;
    // The gateway cannot replay an admitted operation, so only a request that
    // never got response headers is sent once more, under the same
    // Idempotency-Key. If the gateway did admit it, the repeat is rejected as
    // idempotency_key_reused instead of being charged twice.
    const key = String(event.sessionID);
    const dropped = unanswered.get(key);
    unanswered.delete(key);
    if (!dropped || retried.has(dropped.id) || !droppedBeforeResponse(event.error)) {
      event.decision = { retry: false };
      return;
    }
    remember(retried, dropped.id, true);
    remember(replays, key, { ...dropped, at: now() });
    event.decision = { retry: true, delay: MANAGED_RETRY_DELAY };
  }, { providerID: EXPERIENTIAL_PROVIDER_ID });
  registrations.push(managedRetry);

  const recoveryHook = await ctx.session.hook('http.response', async event => {
    if (event.model.providerID !== EXPERIENTIAL_PROVIDER_ID) return;
    const requestID = event.request.headers.get('Idempotency-Key');
    if (requestID && unanswered.get(String(event.sessionID))?.id === requestID) unanswered.delete(String(event.sessionID));
    if (event.response.ok) return;
    const body = await event.response.clone().text().catch(() => '');
    if (requestID && retried.has(requestID) && /\bidempotency_key_reused\b/.test(body)) {
      event.response = new Response(JSON.stringify({ error: {
        message: MANAGED_DUPLICATE_MESSAGE, type: 'invalid_request_error', code: 'idempotency_key_reused',
      } }), { status: event.response.status, headers: { 'content-type': 'application/json' } });
      return;
    }
    const recovery = cloudManagedUsageRecovery(body);
    if (recovery) options.onRecovery?.(recovery, { sessionID: event.sessionID, kind: event.kind });
  }, { providerID: EXPERIENTIAL_PROVIDER_ID });
  registrations.push(recoveryHook);

  let disposed = false;
  const refresh = async (signal?: AbortSignal): Promise<void> => {
    const inventory = await loadShipModels({ ctx, fetchImpl, env, baseURL, signal });
    if (inventory?.models) {
      shipConnection = inventory.connection;
      shipManaged = inventory.managed;
      // The host indexes immutable model arrays by identity.
      shipModels = inventory.models.map(model => asModelInfo(EXPERIENTIAL_PROVIDER_ID, model,
        inventory.managed ? cloudGatewayUrl(env) : baseURL));
      await ctx.provider.reload();
    }
    for (const providerID of [ANTHROPIC_PROVIDER_ID, OPENAI_CODEX_PROVIDER_ID]) {
      if (signal?.aborted) return;
      const active = await ctx.integration.connection.active(providerID);
      if (!active) {
        if (subscriptionConnections[providerID]) {
          delete subscriptionConnections[providerID];
          subscriptions[providerID] = [];
          await ctx.provider.reload();
        }
        continue;
      }
      const credential = await ctx.integration.connection.resolve(active);
      const result = providerID === ANTHROPIC_PROVIDER_ID
        ? await fetchAnthropicSubscriptionModels(credential, { fetchImpl })
        : await fetchCodexSubscriptionModels(credential, { fetchImpl });
      const discovered = result.models.slice(0, PROFILE_CAP);
      const current = await ctx.integration.connection.active(providerID);
      if (!current || !('id' in active) || !('id' in current) || current.id !== active.id) continue;
      const cacheKey = `${CACHE_KEY}${providerID}`;
      const prior = await ctx.storage.get(cacheKey) as { account?: string; models?: CatalogModel[] } | undefined;
      const accountMetadata = credential && 'metadata' in credential ? credential.metadata as Record<string, unknown> | undefined : undefined;
      const accountKey = createHash('sha256').update(String(('id' in active ? active.id : '') || accountMetadata?.accountId || (credential?.type === 'oauth' ? credential.access : credential?.type === 'key' ? credential.key : '') || '')).digest('hex');
      if (prior?.account !== accountKey) {
        subscriptions[providerID] = [];
      }
      const known = new Map([
        ...catalogModels(providerID).map((model: CatalogModel) => [model.id, model] as const),
        ...(Array.isArray(prior?.models) ? prior.models : []).map(model => [model.id, model] as const),
      ]);
      const converted = discovered.map(model => {
        const base = known.get(model.id);
        return modelInfo(providerID, providerID === ANTHROPIC_PROVIDER_ID
          ? anthropicModelDefinition(model, base) : codexModelDefinition(model, base),
        providerID === ANTHROPIC_PROVIDER_ID ? 'https://api.anthropic.com' : 'https://chatgpt.com/backend-api');
      });
      subscriptions[providerID] = converted;
      subscriptionConnections[providerID] = active;
      await ctx.storage.set(cacheKey, { account: accountKey, models: discovered, checkedAt: now() });
      await ctx.provider.reload();
    }
  };
  // Bound the first discovery so plugin activation (which model.list awaits)
  // normally includes Cloud models, avoiding a cold-start 'Model unavailable'
  // race for headless runs; a slow Cloud never blocks startup indefinitely.
  const initialRefresh = refresh(controller.signal).catch(() => {});
  let discoveryTimer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([initialRefresh, new Promise<void>(resolve => {
    discoveryTimer = setTimeout(resolve, options.initialDiscoveryWaitMs ?? INITIAL_DISCOVERY_WAIT);
  })]);
  clearTimeout(discoveryTimer);
  const onConnection = async (event: { type: string }) => {
    if (event.type === 'integration.updated' || event.type === 'credential.updated' || event.type === 'credential.switched') {
      void refresh(controller.signal).catch(() => {});
    }
  };
  eventTask = (async () => {
    try { for await (const event of ctx.event.subscribe({ signal: controller.signal })) await onConnection(event); }
    catch { /* abort/disconnect ends the watcher */ }
  })();

  return async () => {
    if (disposed) return;
    disposed = true;
    controller.abort();
    const failures: unknown[] = [];
    try { await eventTask; } catch (error) { failures.push(error); }
    try { await deviceAuth.cleanup(); } catch (error) { failures.push(error); }
    failures.push(...await disposeRegistrations());
    if (failures.length) throw new AggregateError(failures, 'Carthagent provider cleanup did not complete cleanly.');
  };
  } catch (error) {
    controller.abort();
    const failures: unknown[] = [];
    if (eventTask) {
      try { await eventTask; } catch (cleanupError) { failures.push(cleanupError); }
    }
    try { await deviceAuth.cleanup(); } catch (cleanupError) { failures.push(cleanupError); }
    failures.push(...await disposeRegistrations());
    if (failures.length) throw new AggregateError([error, ...failures], 'Carthagent provider registration failed and rollback was incomplete.', { cause: error });
    throw error;
  }
}

export const providerConstants = Object.freeze({
  SHIP_PROVIDER_ID: EXPERIENTIAL_PROVIDER_ID,
  SHIP_PROVIDER_NAME: EXPERIENTIAL_PROVIDER_NAME,
  SHIP_INTEGRATION_ID,
  ANTHROPIC_PROVIDER_ID,
  OPENAI_CODEX_PROVIDER_ID,
  OAUTH_METHOD,
  EXPERIENTIAL_GATEWAY_URL_ENV,
  RUN_MODES: [...RUN_MODE],
  parseExperientialModels,
  parseAnthropicModels,
  parseCodexModels,
});
