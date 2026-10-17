import type { Context } from '@opencode/plugin/promise/plugin';
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
import { legacyOAuthForOpenCode, nativeCredentialFile, refreshNativeCredential, refreshSingleFlight } from '../../../../lib/opencode/credentials.mjs';
import { createDeviceAuthController } from './device-auth.ts';
import { createSessionIdentity, isManagedShipCredential, shipTelemetryHeaders } from './telemetry.ts';

const OAUTH_METHOD = 'carthagent-device';
const SHIP_INTEGRATION_ID = EXPERIENTIAL_PROVIDER_ID;
const DISCOVERY_TIMEOUT = 10_000;
const PROFILE_CAP = 200;
const CACHE_KEY = 'ctg.models/subscriptions/';
const RUN_MODE = new Set(['interactive', 'print', 'rpc']);

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
    'reasoningField', 'requireReasoning', 'maxTokensField', 'requireFinishReason',
    'requireAssistantAfterTool', 'supportsPromptCacheKey', 'cacheFormat',
    'supportsThinkingBlockBinding', 'supportsEffortUpdates',
  ] as const;
  return Object.fromEntries(keys.flatMap(key => key in compat ? [[key, compat[key]]] : [])) as NonNullable<Model.Info['compatibility']>;
}

function oauthMethod({ env, fetchImpl, sleep, now, openBrowserImpl, agentDir, startDeviceFlow, rereadCredential, credentialFile }: {
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  now: () => number;
  openBrowserImpl: typeof openBrowser;
  agentDir: string;
  startDeviceFlow: () => Promise<{ authorization: { userCode: string; verificationUri: string; verificationUriComplete?: string; expiresIn: number; interval: number; deviceCode: string }; callback: Promise<Credential.OAuth> }>;
  rereadCredential: () => Promise<Credential.OAuth | undefined>;
  credentialFile: string;
}) {
  const client = new CloudClient({ baseUrl: cloudControlUrl(env), fetchImpl, sleep: ms => sleep(ms) });
  return {
    integrationID: IntegrationSchema.ID.make(SHIP_INTEGRATION_ID),
    method: { id: OAUTH_METHOD, type: 'oauth' as const, label: 'Sign in with Carthagent Ship' },
    authorize: async (_answer: Form.Answer) => {
      const legacy = await legacyOAuthForOpenCode({ agentDir });
      if (legacy) {
        return {
          mode: 'auto' as const,
          url: 'https://api.carthagent.xyz',
          instructions: 'A legacy Carthagent Ship credential was found and will be migrated into OpenCode integration storage.',
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
        instructions: `Approve device code ${response.userCode} in your browser.`,
        expiresAt: now() + Number(response.expiresIn || 600) * 1000,
        callback,
      };
    },
    refresh: (credential: Credential.OAuth) => refreshSingleFlight(
      `${credential.methodID}:${credential.refresh}`,
      () => refreshNativeCredential({
        credential,
        credentialFile,
        reread: rereadCredential,
        refresh: async (current: Credential.OAuth) => ({ type: 'oauth' as const, methodID: IntegrationSchema.MethodID.make(OAUTH_METHOD),
          ...oauthCredentials(await client.refresh({ refreshToken: current.refresh }), now()),
          ...(current.metadata ? { metadata: current.metadata } : {}) }),
      }),
    ),
    label: () => 'Carthagent Ship',
  };
}

function integrationDefinitions(editor: Parameters<Context['integration']['transform']>[0] extends (editor: infer E) => void ? E : never, options: Parameters<typeof oauthMethod>[0]) {
  editor.method.update(oauthMethod(options));
  editor.method.update({ integrationID: IntegrationSchema.ID.make(SHIP_INTEGRATION_ID), method: { type: 'key', label: 'Use an Experiential API key' } });
  editor.method.update({ integrationID: IntegrationSchema.ID.make(SHIP_INTEGRATION_ID), method: { type: 'env', names: [EXPERIENTIAL_API_KEY_ENV] } });
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
  if (!response.ok) throw new Error(`Carthagent Ship model discovery failed (${response.status}).`);
  const models = parseExperientialModels(await response.json()).slice(0, PROFILE_CAP);
  if (connection && managed) return { connection, models, managed };
  return { connection, models, managed };
}

/** Register CTG Ship plus subscription inventory on OpenCode's native provider
 * engine. OpenCode owns all inference transport; hooks only add metadata and
 * idempotency identity to native HTTP requests. */
interface ProviderRegistrationOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  agentDir?: string;
  credentialFile?: string;
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
  const rereadCredential = async (): Promise<Credential.OAuth | undefined> => {
    const active = await ctx.integration.connection.active(SHIP_INTEGRATION_ID);
    if (!active) return undefined;
    const value = await ctx.integration.connection.resolve(active);
    return value?.type === 'oauth' && value.methodID === OAUTH_METHOD ? value : undefined;
  };
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
  const integration = await ctx.integration.transform(editor => {
    integrationDefinitions(editor, {
    env, fetchImpl, sleep, now, openBrowserImpl, agentDir, startDeviceFlow: deviceAuth.start,
    rereadCredential,
    credentialFile: options.credentialFile ?? nativeCredentialFile(env),
    });
  });
  registrations.push(integration);

  const baseURL = experientialBaseUrl(env);
  const shipModels: Model.Info[] = [];
  const subscriptions: Record<string, Model.Info[]> = { [ANTHROPIC_PROVIDER_ID]: [], [OPENAI_CODEX_PROVIDER_ID]: [] };
  const subscriptionConnections: Partial<Record<string, ConnectionInfo>> = {};
  const providerRegistration = await ctx.provider.transform(editor => {
    editor.add({ info: providerInfo(EXPERIENTIAL_PROVIDER_ID, EXPERIENTIAL_PROVIDER_NAME,
      '@opencode/ai/providers/openai-compatible', SHIP_INTEGRATION_ID,
      { baseURL, apiKey: `$${EXPERIENTIAL_API_KEY_ENV}` }), models: shipModels });
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
      identity,
      requestID: event.request.headers.get('x-carthagent-request-id') || identity.request(event.sessionID, event.kind),
      requestSecret,
    });
    for (const [name, value] of Object.entries(telemetry)) headers.set(name, String(value));
    headers.set('Idempotency-Key', telemetry['x-carthagent-request-id']);
    headers.set('X-Client-Request-Id', telemetry['x-carthagent-request-id']);
    event.request = new Request(event.request, { headers });
  }, { providerID: EXPERIENTIAL_PROVIDER_ID });
  registrations.push(providerHook);

  const routeHook = await ctx.session.hook('model.request', async event => {
    if (event.model.providerID !== EXPERIENTIAL_PROVIDER_ID) return;
    event.headers['x-carthagent-request-id'] = requestIdentity
      ? requestIdentity(event)
      : identity.request(event.sessionID, event.kind);
    const active = await ctx.integration.connection.active(SHIP_INTEGRATION_ID).catch(() => undefined);
    if (!active) return;
    const credential = await ctx.integration.connection.resolve(active).catch(() => undefined);
    if (isManagedShipCredential(credential)) event.baseURL = cloudGatewayUrl(env);
  }, { providerID: EXPERIENTIAL_PROVIDER_ID });
  registrations.push(routeHook);

  const noUnsafeRetry = await ctx.session.hook('retry', async event => {
    if (event.model.providerID !== EXPERIENTIAL_PROVIDER_ID) return;
    const active = await ctx.integration.connection.active(SHIP_INTEGRATION_ID).catch(() => undefined);
    const credential = active ? await ctx.integration.connection.resolve(active).catch(() => undefined) : undefined;
    if (!isManagedShipCredential(credential)) return;
    // Gateway idempotency currently reserves before dispatch and cannot replay
    // an existing operation, so retries must not duplicate managed usage.
    event.decision = { retry: false };
  }, { providerID: EXPERIENTIAL_PROVIDER_ID });
  registrations.push(noUnsafeRetry);

  const recoveryHook = await ctx.session.hook('http.response', async event => {
    if (event.model.providerID !== EXPERIENTIAL_PROVIDER_ID || event.response.ok) return;
    const body = await event.response.clone().text().catch(() => '');
    const recovery = cloudManagedUsageRecovery(body);
    if (recovery) options.onRecovery?.(recovery, { sessionID: event.sessionID, kind: event.kind });
  }, { providerID: EXPERIENTIAL_PROVIDER_ID });
  registrations.push(recoveryHook);

  let disposed = false;
  const refresh = async (signal?: AbortSignal): Promise<void> => {
    const inventory = await loadShipModels({ ctx, fetchImpl, env, baseURL, signal });
    if (inventory?.models) {
      shipModels.splice(0, shipModels.length, ...inventory.models.map(model => asModelInfo(EXPERIENTIAL_PROVIDER_ID, model,
        inventory.managed ? cloudGatewayUrl(env) : baseURL)));
      await ctx.provider.reload();
    }
    for (const providerID of [ANTHROPIC_PROVIDER_ID, OPENAI_CODEX_PROVIDER_ID]) {
      if (signal?.aborted) return;
      const active = await ctx.integration.connection.active(providerID);
      if (!active) {
        if (subscriptionConnections[providerID]) {
          delete subscriptionConnections[providerID];
          subscriptions[providerID].splice(0, subscriptions[providerID].length);
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
        subscriptions[providerID].splice(0, subscriptions[providerID].length);
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
      subscriptions[providerID].splice(0, subscriptions[providerID].length, ...converted);
      subscriptionConnections[providerID] = active;
      await ctx.storage.set(cacheKey, { account: accountKey, models: discovered, checkedAt: now() });
      await ctx.provider.reload();
    }
  };
  void refresh(controller.signal).catch(() => {});
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
