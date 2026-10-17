import { CloudClient, cloudControlUrl } from '../../../../lib/cloud/client.mjs';
import type { Context } from '@opencode/plugin/promise/plugin';
import type { ConnectionInfo } from '@opencode/client';

type ShipContext = Pick<Context, 'integration'>;
type ActiveCredential = Extract<ConnectionInfo, { type: 'credential' }>;
type CloudClientPort = Pick<CloudClient, 'account' | 'checkout' | 'portal' | 'revokeCurrent' | 'revokeSession'>;

/** Published #140 Ship contract, kept injectable for offline handler tests. */
export function createShipRpcHandlers(ctx: ShipContext, options: {
  cloudClient?: CloudClientPort;
  baseUrl?: string;
  cloudUrl?: string;
} = {}) {
  const cloud = options.cloudClient ?? new CloudClient({ baseUrl: options.baseUrl ?? cloudControlUrl() });
  async function access() {
    const active = await ctx.integration.connection.active('experiential-labs');
    if (!active || active.type !== 'credential' || active.method !== 'oauth') throw new Error('An active Carthagent Ship OAuth connection is required.');
    const credential = await ctx.integration.connection.resolve(active);
    if (credential?.type !== 'oauth' || credential.methodID !== 'carthagent-device' || !credential.access) {
      throw new Error('An active Carthagent Ship OAuth connection is required.');
    }
    return { active: active as ActiveCredential, token: credential.access };
  }
  return {
    shipAccount: async (_input: unknown, call: { signal: AbortSignal }) => {
      call.signal.throwIfAborted();
      const { token } = await access();
      return { account: await cloud.account({ accessToken: token, signal: call.signal }) };
    },
    shipBilling: async (input: unknown, call: { signal: AbortSignal }) => {
      call.signal.throwIfAborted();
      const { token } = await access();
      const action = (input as { action: 'checkout' | 'portal' }).action;
      if (action !== 'checkout' && action !== 'portal') throw new Error('Unsupported Ship billing action.');
      const returnUrl = `${options.cloudUrl ?? cloudControlUrl()}/account`;
      const result = action === 'portal'
        ? await cloud.portal({ accessToken: token, returnUrl, signal: call.signal })
        : await cloud.checkout({ accessToken: token, successUrl: returnUrl, cancelUrl: returnUrl, signal: call.signal });
      return { url: result.url };
    },
    shipLogout: async (input: unknown, call: { signal: AbortSignal }) => {
      call.signal.throwIfAborted();
      const { active, token } = await access();
      const session = (input as { session?: string }).session;
      if (session) {
        await cloud.revokeSession({ accessToken: token, sessionId: session, signal: call.signal });
        return { revoked: true };
      }
      await cloud.revokeCurrent({ accessToken: token, signal: call.signal });
      await ctx.integration.transform((editor) => editor.remove(active.id));
      return { revoked: true, credentialID: active.id };
    },
  };
}
