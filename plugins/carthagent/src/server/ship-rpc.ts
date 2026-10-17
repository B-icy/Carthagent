import { CloudClient, cloudControlUrl } from '../../../../lib/cloud/client.mjs';
import type { Context } from '@opencode/plugin/promise/plugin';
import type { ConnectionInfo } from '@opencode/client';

type ShipContext = Pick<Context, 'integration'>;
type ActiveCredential = Extract<ConnectionInfo, { type: 'credential' }>;

type CloudClientPort = Pick<CloudClient, 'account' | 'checkout' | 'portal' | 'revokeCurrent' | 'revokeSession'>;

/** Create profile-scoped Ship RPC handlers; injection keeps cloud behavior testable offline. */
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
    shipAccount: async (_input: unknown, call: import('@opencode/plugin/promise/rpc').RpcCallContext<typeof import('../rpc').Carthagent.methods.shipAccount>) => {
      call.signal.throwIfAborted();
      let token: string;
      try { ({ token } = await access()); }
      catch { return call.error('unauthenticated', 'An active Carthagent Ship OAuth connection is required.', {}); }
      return { account: await cloud.account({ accessToken: token, signal: call.signal }) };
    },
    shipBilling: async (input: unknown, call: import('@opencode/plugin/promise/rpc').RpcCallContext<typeof import('../rpc').Carthagent.methods.shipBilling>) => {
      call.signal.throwIfAborted();
      let token: string;
      try { ({ token } = await access()); }
      catch { return call.error('unauthenticated', 'An active Carthagent Ship OAuth connection is required.', {}); }
      const action = (input as { action: 'checkout' | 'portal' }).action;
      if (action !== 'checkout' && action !== 'portal') throw new Error('Unsupported Ship billing action.');
      const returnUrl = `${options.cloudUrl ?? cloudControlUrl()}/account`;
      const result = action === 'portal'
        ? await cloud.portal({ accessToken: token, returnUrl, signal: call.signal })
        : await cloud.checkout({ accessToken: token, successUrl: returnUrl, cancelUrl: returnUrl, signal: call.signal });
      return { url: result.url };
    },
    shipLogout: async (input: unknown, call: import('@opencode/plugin/promise/rpc').RpcCallContext<typeof import('../rpc').Carthagent.methods.shipLogout>) => {
      call.signal.throwIfAborted();
      let active: ActiveCredential;
      let token: string;
      try { ({ active, token } = await access()); }
      catch { return call.error('unauthenticated', 'An active Carthagent Ship OAuth connection is required.', {}); }
      const session = (input as { session?: string }).session;
      if (session) {
        await cloud.revokeSession({ accessToken: token, sessionId: session, signal: call.signal });
        return { revoked: true };
      }
      await cloud.revokeCurrent({ accessToken: token, signal: call.signal });
      return { revoked: true, credentialID: active.id };
    },
  };
}
