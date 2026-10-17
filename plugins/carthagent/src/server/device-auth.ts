import type { Credential } from '@opencode/schema/credential';
import { Integration as IntegrationSchema } from '@opencode/schema/integration';
import { randomUUID } from 'node:crypto';
import { CloudClient, cloudControlUrl, oauthCredentials } from '../../../../lib/cloud/client.mjs';
import { shipInstallId } from '../../../../lib/ship-telemetry.mjs';

const METHOD_ID = 'carthagent-device';
const MAX_EXPIRY_MS = 15 * 60_000;

type Flow = {
  controller: AbortController;
  authorization: Awaited<ReturnType<CloudClient['createDeviceAuthorization']>>;
  callback: Promise<Credential.OAuth>;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
};

export function createDeviceAuthController({ env = process.env, fetchImpl = globalThis.fetch, agentDir, now = Date.now, sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
}) }: {
  env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; agentDir: string; now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}) {
  const client = new CloudClient({ baseUrl: cloudControlUrl(env), fetchImpl, sleep: ms => sleep(ms) });
  const flows = new Map<string, Flow>();
  const remove = (id: string) => {
    const flow = flows.get(id);
    if (!flow) return false;
    clearTimeout(flow.timer);
    flows.delete(id);
    return true;
  };
  const start = async (signal?: AbortSignal) => {
    // Bound active generations; expired callbacks are aborted by their timer.
    for (const [id, flow] of flows) if (flow.expiresAt <= now()) { flow.controller.abort(new Error('expired_token')); remove(id); }
    if (flows.size >= 4) throw new Error('too_many_auth_flows');
    const request = client.request as unknown as (path: string, options: { method: string; body: unknown; signal?: AbortSignal }) => Promise<{
      userCode: string; verificationUri: string; verificationUriComplete?: string; expiresIn: number; interval: number; deviceCode: string;
    }>;
    const createAuthorization = (input: { clientName: string; installId: string }, signal?: AbortSignal) => request.call(client, '/v1/device/authorizations', {
      method: 'POST', body: input, signal,
    });
    const authorization = await createAuthorization({
      clientName: `Carthagent OpenCode (${process.env.HOSTNAME || 'device'})`,
      installId: shipInstallId({ agentDir }),
    }, signal);
    const flowId = randomUUID();
    const controller = new AbortController();
    const expiresAt = now() + Math.min(MAX_EXPIRY_MS, Math.max(1, Number(authorization.expiresIn) || 600) * 1000);
    const timer = setTimeout(() => controller.abort(new Error('expired_token')), Math.max(1, expiresAt - now()));
    const flow: Flow = { controller, authorization, callback: Promise.resolve({} as Credential.OAuth), expiresAt, timer };
    flows.set(flowId, flow);
    const callback = (async () => {
      try {
        const interval = Math.max(1000, Number(authorization.interval || 5) * 1000);
        while (now() < expiresAt) {
          controller.signal.throwIfAborted();
          try {
            const tokens = await client.pollDeviceToken({ deviceCode: authorization.deviceCode, signal: controller.signal });
            return { type: 'oauth', methodID: IntegrationSchema.MethodID.make(METHOD_ID), ...oauthCredentials(tokens, now()) } as Credential.OAuth;
          } catch (error) {
            if (!(error instanceof Error) || !('code' in error) || error.code !== 'authorization_pending') throw error;
          }
          await sleep(interval, controller.signal);
        }
        throw new Error('expired_token');
      } finally { remove(flowId); }
    })();
    // Avoid unhandled rejection for RPC-only starts; native authorize still
    // awaits this same promise and receives the original rejection.
    void callback.catch(() => {});
    flow.callback = callback;
    return { flowId, authorization, callback, expiresAt };
  };
  return {
    start,
    cancel(flowId: string) {
      const flow = flows.get(flowId);
      if (!flow) return false;
      flow.controller.abort(new Error('cancelled'));
      return remove(flowId);
    },
    async cleanup() {
      for (const flow of flows.values()) { clearTimeout(flow.timer); flow.controller.abort(new Error('plugin_unloaded')); }
      flows.clear();
      await Promise.resolve();
    },
  };
}
