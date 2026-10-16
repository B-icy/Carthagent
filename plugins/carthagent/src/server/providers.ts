import type { Context } from '@opencode/plugin/promise/plugin';
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
import { shipInstallId } from '../../../../lib/ship-telemetry.mjs';
import { packageVersion } from '../../../../lib/update.mjs';
import { createHash } from 'node:crypto';
import { legacyOAuthForOpenCode, refreshSingleFlight } from '../../../../lib/opencode/credentials.mjs';
import { createSessionIdentity, isManagedShipCredential, shipTelemetryHeaders } from './telemetry.ts';

const OAUTH_METHOD = 'carthagent-device';
const SHIP_INTEGRATION_ID = 'carthagent-ship';
const DISCOVERY_TIMEOUT = 10_000;
const PROFILE_CAP = 200;
const CACHE_KEY = 'ctg.models/subscriptions/';
const RUN_MODE = new Set(['interactive', 'print', 'rpc']);

function signalWithTimeout(signal: AbortSignal | undefined, timeout: number) {
  const timeoutSignal = AbortSignal.timeout(timeout);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function providerInfo(id: string, name: string, pkg: string, integrationID?: string, settings: Record<string, unknown> = {}) {
  return {
    id, name, activation: 'enabled', package: pkg, settings,
    headers: {}, body: {}, ...(integrationID ? { integrationID } : {}),
  };
}

function modelInfo(providerID: string, source: any, defaultBaseURL: string) {
  const profile = source;
  const input = Array.isArray(profile.input) ? profile.input : ['text'];
  const output = Array.isArray(profile.output) ? profile.output : ['text'];
  const id = String(profile.id);
  const price = profile.cost;
  const cost: any[] = price && Number.isFinite(price.input) && Number.isFinite(price.output)
    ? [{ input: price.input, output: price.output,
      cache: { read: price.cacheRead ?? 0, write: price.cacheWrite ?? 0 } }]
    : [];
  for (const tier of price?.tiers ?? []) {
    if (!Number.isFinite(tier.input) || !Number.isFinite(tier.output) || !Number.isFinite(tier.inputTokensAbove)) continue;
    cost.push({ tier: { type: 'context', size: tier.inputTokensAbove }, input: tier.input, output: tier.output,
      cache: { read: tier.cacheRead ?? 0, write: tier.cacheWrite ?? 0 } });
  }
  return {
    id, modelID: String(profile.modelID || id), providerID, name: String(profile.name || id), family: id.split(/[-/]/)[0],
    status: 'active', enabled: true, time: { released: 0 },
    capabilities: { tools: true, input, output, ...(typeof profile.temperature === 'boolean' ? { temperature: profile.temperature } : {}) },
    cost,
    limit: { context: profile.contextWindow ?? 128_000, output: profile.maxTokens ?? 16_384 },
    settings: {}, headers: {}, body: {}, variants: [],
    ...(profile.compat ? { compatibility: profile.compat } : {}),
    ...(profile.baseUrl || defaultBaseURL ? { settings: { baseURL: profile.baseUrl || defaultBaseURL } } : {}),
  };
}

function withCatalogModels(editor: any, providerID: string, source: any[], baseURL: string) {
  const definitions = source.length
    ? source.map(model => ({ ...catalogModels(providerID).find((known: any) => known.id === model.id), ...model }))
    : catalogModels(providerID);
  editor.models.set(providerID, definitions.map(model => modelInfo(providerID, model, baseURL)));
}

function oauthMethod({ env, fetchImpl, sleep, now, openBrowserImpl, agentDir }: any) {
  const client = new CloudClient({ baseUrl: cloudControlUrl(env), fetchImpl, sleep });
  return {
    integrationID: SHIP_INTEGRATION_ID,
    method: { id: OAUTH_METHOD, type: 'oauth', label: 'Sign in with Carthagent Ship' },
    authorize: async (answer: any) => {
      const legacy = await legacyOAuthForOpenCode({ agentDir });
      if (legacy) {
        return {
          mode: 'auto',
          url: 'https://api.carthagent.xyz',
          instructions: 'A legacy Carthagent Ship credential was found and will be migrated into OpenCode integration storage.',
          callback: legacy,
        };
      }
      const response = await client.createDeviceAuthorization({
        clientName: `Carthagent OpenCode (${process.env.HOSTNAME || 'device'})`,
        installId: shipInstallId({ agentDir }),
      });
      const url = response.verificationUriComplete || response.verificationUri;
      Promise.resolve(openBrowserImpl(url)).catch(() => false);
      const poll = async () => {
        const deadline = Date.now() + Number(response.expiresIn || 600) * 1000;
        const interval = Math.max(1000, Number(response.interval || 5) * 1000);
        while (Date.now() < deadline) {
          try {
            const token = await client.pollDeviceToken({ deviceCode: response.deviceCode });
            return { type: 'oauth', methodID: OAUTH_METHOD, ...oauthCredentials(token, now()) };
          } catch (error: any) {
            if (error?.code !== 'authorization_pending') throw error;
          }
          await sleep(interval, answer?.signal);
        }
        throw new Error('expired_token');
      };
      return {
        mode: 'auto', url,
        instructions: `Approve device code ${response.userCode} in your browser.`,
        expiresAt: now() + Number(response.expiresIn || 600) * 1000,
        callback: poll(),
      };
    },
    refresh: (credential: any) => refreshSingleFlight(
      `${credential.methodID}:${credential.refresh}`,
      async () => ({ type: 'oauth', methodID: OAUTH_METHOD,
        ...oauthCredentials(await client.refresh({ refreshToken: credential.refresh }), now()),
        ...(credential.metadata ? { metadata: credential.metadata } : {}) }),
    ),
    label: () => 'Carthagent Ship',
  };
}

function integrationDefinitions(editor: any, options: any) {
  // OpenCode 2.0.32 permits plugins to update existing integration metadata
  // and methods, but does not permit defining a new Integration.Info. Keep the
  // auth method registration explicit and non-throwing: the CTG host may
  // contribute the integration record before this adapter initializes.
  if (!editor.get(SHIP_INTEGRATION_ID)) return false;
  editor.update(SHIP_INTEGRATION_ID, (item: any) => { item.name = EXPERIENTIAL_PROVIDER_NAME; });
  editor.method.update(oauthMethod(options));
  editor.method.update({ integrationID: SHIP_INTEGRATION_ID, method: { type: 'key', label: 'Use an Experiential API key' } });
  return true;
}

function asModelInfo(providerID: string, model: any, baseURL: string) {
  const fixed = experientialModelDefinition(model);
  return modelInfo(providerID, fixed, baseURL);
}

async function loadShipModels({ ctx, fetchImpl, env, baseURL, signal }: any) {
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
export async function registerProviders(ctx: Context, options: any = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));
  const agentDir = options.agentDir ?? shipAgentDir(env);
  const openBrowserImpl = options.openBrowser ?? openBrowser;
  const requestIdentity = options.sessionIdentity;
  const identity = options.telemetryIdentity ?? createSessionIdentity();
  const requestSecret = options.requestSecret ?? `${ctx.location?.project?.id || ctx.location?.directory || 'ctg'}:request-v1`;
  const registrations: any[] = [];
  let integrationAvailable = false;
  const integration = await ctx.integration.transform((editor: any) => {
    integrationAvailable = integrationDefinitions(editor, {
    env, fetchImpl, sleep, now, openBrowserImpl, agentDir,
    });
  });
  registrations.push(integration);

  const baseURL = experientialBaseUrl(env);
  const shipModels: any[] = [];
  let shipConnection: any;
  const subscriptions: Record<string, any[]> = { [ANTHROPIC_PROVIDER_ID]: [], [OPENAI_CODEX_PROVIDER_ID]: [] };
  const subscriptionConnections: Record<string, any> = {};
  const providerRegistration = await ctx.provider.transform((editor: any) => {
    editor.add({ info: providerInfo(EXPERIENTIAL_PROVIDER_ID, EXPERIENTIAL_PROVIDER_NAME,
      '@opencode/ai/providers/openai-compatible', SHIP_INTEGRATION_ID,
      { baseURL: baseURL, apiKey: `{env:${EXPERIENTIAL_API_KEY_ENV}}` }), models: shipModels,
      ...(shipConnection ? { sourceConnection: shipConnection } : {}) });
    // Subscription IDs already exist in the native catalog. Overlay only the
    // definitions and retain catalog cost/capability metadata.
    for (const [providerID, baseURL] of [
      [ANTHROPIC_PROVIDER_ID, 'https://api.anthropic.com'],
      [OPENAI_CODEX_PROVIDER_ID, 'https://chatgpt.com/backend-api'],
    ] as const) {
      const existing = editor.get(providerID);
      const models = subscriptions[providerID].length
        ? subscriptions[providerID]
        : (existing ? [...existing.models.values()] : catalogModels(providerID).map((model: any) => modelInfo(providerID, model, baseURL)));
      if (existing && subscriptionConnections[providerID]) {
        editor.add({ info: existing.provider, models, sourceConnection: subscriptionConnections[providerID] });
      } else if (subscriptions[providerID].length) {
        editor.models.set(providerID, models);
      }
    }
  });
  registrations.push(providerRegistration);

  const providerHook = await ctx.session.hook('http.request', async (event: any) => {
    if (event.model.providerID !== EXPERIENTIAL_PROVIDER_ID) return;
    let credential: any;
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
      ...(requestIdentity ? { requestID: requestIdentity(event) } : {}), requestSecret,
    });
    for (const [name, value] of Object.entries(telemetry)) headers.set(name, String(value));
    headers.set('Idempotency-Key', telemetry['x-carthagent-request-id']);
    headers.set('X-Client-Request-Id', telemetry['x-carthagent-request-id']);
    event.request = new Request(event.request, { headers });
  }, { providerID: EXPERIENTIAL_PROVIDER_ID });
  registrations.push(providerHook);

  const routeHook = await ctx.session.hook('model.request', async (event: any) => {
    if (event.model.providerID !== EXPERIENTIAL_PROVIDER_ID) return;
    const active = await ctx.integration.connection.active(SHIP_INTEGRATION_ID).catch(() => undefined);
    if (!active) return;
    const credential = await ctx.integration.connection.resolve(active).catch(() => undefined);
    if (isManagedShipCredential(credential)) event.baseURL = cloudGatewayUrl(env);
  }, { providerID: EXPERIENTIAL_PROVIDER_ID });
  registrations.push(routeHook);

  const noUnsafeRetry = await ctx.session.hook('retry', async (event: any) => {
    if (event.model.providerID !== EXPERIENTIAL_PROVIDER_ID) return;
    const active = await ctx.integration.connection.active(SHIP_INTEGRATION_ID).catch(() => undefined);
    const credential = active ? await ctx.integration.connection.resolve(active).catch(() => undefined) : undefined;
    if (!isManagedShipCredential(credential)) return;
    // Gateway idempotency currently reserves before dispatch and cannot replay
    // an existing operation, so retries must not duplicate managed usage.
    event.decision = { retry: false };
  }, { providerID: EXPERIENTIAL_PROVIDER_ID });
  registrations.push(noUnsafeRetry);

  const recoveryHook = await ctx.session.hook('http.response', async (event: any) => {
    if (event.model.providerID !== EXPERIENTIAL_PROVIDER_ID || event.response.ok) return;
    const body = await event.response.clone().text().catch(() => '');
    const recovery = cloudManagedUsageRecovery(body);
    if (recovery) options.onRecovery?.(recovery, { sessionID: event.sessionID, kind: event.kind });
  }, { providerID: EXPERIENTIAL_PROVIDER_ID });
  registrations.push(recoveryHook);

  let disposed = false;
  const refresh = async (signal?: AbortSignal) => {
    if (!integrationAvailable) return;
    const inventory = await loadShipModels({ ctx, fetchImpl, env, baseURL, signal });
    if (inventory?.models) {
      shipConnection = inventory.connection;
      shipModels.splice(0, shipModels.length, ...inventory.models.map((model: any) => asModelInfo(EXPERIENTIAL_PROVIDER_ID, model,
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
        ? await fetchAnthropicSubscriptionModels(credential, { fetchImpl, signal: signalWithTimeout(signal, DISCOVERY_TIMEOUT) })
        : await fetchCodexSubscriptionModels(credential, { fetchImpl, signal: signalWithTimeout(signal, DISCOVERY_TIMEOUT), clientVersion: packageVersion() });
      const discovered = result.models.slice(0, PROFILE_CAP);
      const current = await ctx.integration.connection.active(providerID);
      if (!current || !('id' in active) || !('id' in current) || current.id !== active.id) continue;
      const cacheKey = `${CACHE_KEY}${providerID}`;
      const prior = await ctx.storage.get(cacheKey) as any;
      const accountMetadata = credential && 'metadata' in credential ? credential.metadata as Record<string, unknown> | undefined : undefined;
      const accountKey = createHash('sha256').update(String(('id' in active ? active.id : '') || accountMetadata?.accountId || (credential?.type === 'oauth' ? credential.access : credential?.type === 'key' ? credential.key : '') || '')).digest('hex');
      if (prior?.account !== accountKey) {
        subscriptions[providerID].splice(0, subscriptions[providerID].length);
      }
      const known = new Map([
        ...catalogModels(providerID).map((model: any) => [model.id, model]),
        ...(Array.isArray(prior?.models) ? prior.models : []).map((model: any) => [model.id, model]),
      ]);
      const converted = discovered.map((model: any) => {
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
  const controller = new AbortController();
  void refresh(controller.signal).catch(() => {});
  const onConnection = async (event: any) => {
    if (event.type === 'integration.updated' || event.type === 'credential.updated' || event.type === 'credential.switched') {
      void refresh(controller.signal).catch(() => {});
    }
  };
  const eventTask = (async () => {
    try { for await (const event of ctx.event.subscribe({ signal: controller.signal })) await onConnection(event); }
    catch { /* abort/disconnect ends the watcher */ }
  })();

  return async () => {
    if (disposed) return;
    disposed = true;
    controller.abort();
    await eventTask;
    for (const registration of registrations.reverse()) await registration.dispose?.();
  };
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
