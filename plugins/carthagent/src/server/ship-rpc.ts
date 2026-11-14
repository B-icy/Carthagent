import { CloudClient, cloudControlUrl } from '../../../../lib/cloud/client.mjs';
import type { Context } from '@opencode/plugin/promise/plugin';
import type { ConnectionInfo } from '@opencode/client';

type ShipContext = Pick<Context, 'integration'>;
type ActiveCredential = Extract<ConnectionInfo, { type: 'credential' }>;
type CloudClientPort = Pick<CloudClient, 'account' | 'usage' | 'quote' | 'checkout' | 'portal' | 'revokeCurrent' | 'revokeSession'>;

const BILLING_ERRORS: Record<string, string> = {
  stripe_customer_not_found: 'No paid Cloud subscription to manage yet: the billing portal is for existing subscribers. Use `ctg billing checkout` (or /billing checkout) to choose a plan.',
  billing_not_configured: 'Cloud billing is temporarily unavailable. Your starter credit and your own providers still work; try again later.',
};

/** Map control-plane billing error codes to user-facing guidance. */
export function billingErrorMessage(error: unknown) {
  const code = (error as { code?: unknown })?.code;
  const message = error instanceof Error ? error.message : String(error ?? '');
  const key = typeof code === 'string' && code in BILLING_ERRORS ? code : Object.keys(BILLING_ERRORS).find(name => message.includes(name));
  return key ? BILLING_ERRORS[key] : undefined;
}

export const SESSION_ENDED = 'Your Carthagent Cloud session expired or was revoked. Run `ctg login` again and choose Carthagent Cloud.';

/** A Cloud 401 (expired, revoked or unknown token) rather than any other failure. */
export function cloudSessionEnded(error: unknown) {
  const { status, code } = (error ?? {}) as { status?: unknown; code?: unknown };
  return status === 401 || ['unauthorized', 'invalid_token', 'revoked_token', 'reauthentication_required'].includes(String(code));
}

/** Create profile-scoped Ship RPC handlers; injection keeps cloud behavior testable offline. */
export function createShipRpcHandlers(ctx: ShipContext, options: {
  cloudClient?: CloudClientPort;
  baseUrl?: string;
  cloudUrl?: string;
} = {}) {
  const cloud = options.cloudClient ?? new CloudClient({ baseUrl: options.baseUrl ?? cloudControlUrl() });
  async function access() {
    const active = await ctx.integration.connection.active('carthagent-cloud');
    if (!active || active.type !== 'credential' || active.method !== 'oauth') throw new Error('An active Carthagent Cloud OAuth connection is required.');
    const credential = await ctx.integration.connection.resolve(active);
    if (credential?.type !== 'oauth' || credential.methodID !== 'carthagent-device' || !credential.access) {
      throw new Error('An active Carthagent Cloud OAuth connection is required.');
    }
    return { active: active as ActiveCredential, token: credential.access };
  }
  return {
    shipAccount: async (_input: unknown, call: import('@opencode/plugin/promise/rpc').RpcCallContext<typeof import('../rpc').Carthagent.methods.shipAccount>) => {
      call.signal.throwIfAborted();
      let token: string;
      try { ({ token } = await access()); }
      catch { return call.error('unauthenticated', 'An active Carthagent Cloud OAuth connection is required.', {}); }
      // A revoked session must say so, not surface as a generic "RPC call failed".
      try { return { account: await cloud.account({ accessToken: token, signal: call.signal }) }; }
      catch (error) {
        if (cloudSessionEnded(error)) return call.error('unauthenticated', SESSION_ENDED, {});
        throw error;
      }
    },
    shipUsage: async (input: unknown, call: { signal: AbortSignal }) => {
      call.signal.throwIfAborted();
      const { token } = await access();
      const requested = (input as { limit?: number }).limit ?? 50;
       if (!Number.isSafeInteger(requested) || requested < 1 || requested > 200) throw new Error('Cloud usage limit must be between 1 and 200.');
      return { usage: await cloud.usage({ accessToken: token, limit: requested, signal: call.signal } as Parameters<CloudClient['usage']>[0]) };
    },
    shipBilling: async (input: unknown, call: import('@opencode/plugin/promise/rpc').RpcCallContext<typeof import('../rpc').Carthagent.methods.shipBilling>) => {
      call.signal.throwIfAborted();
      let token: string;
      try { ({ token } = await access()); }
      catch { return call.error('unauthenticated', 'An active Carthagent Cloud OAuth connection is required.', {}); }
      const { action, plan = 'builder' } = input as { action: 'checkout' | 'portal' | 'quote'; plan?: string };
      if (!['checkout', 'portal', 'quote'].includes(action)) throw new Error('Unsupported Cloud billing action.');
      if (!['builder', 'pro', 'max'].includes(plan)) throw new Error('Choose Builder, Pro, or Max.');
      if (action === 'quote') {
        try { return { quote: await cloud.quote({ accessToken: token, plan, signal: call.signal }) }; }
        catch (error) {
          if (cloudSessionEnded(error)) return call.error('unauthenticated', SESSION_ENDED, {});
          throw error;
        }
      }
      const returnUrl = `${options.cloudUrl ?? cloudControlUrl()}/account`;
      let result: { url: string };
      try {
        result = action === 'portal'
          ? await cloud.portal({ accessToken: token, returnUrl, signal: call.signal })
          : await cloud.checkout({ accessToken: token, priceId: plan, successUrl: `${options.cloudUrl ?? cloudControlUrl()}/v1/browser/billing/complete`, cancelUrl: `${options.cloudUrl ?? cloudControlUrl()}/v1/browser/billing/cancelled?plan=${plan}`, signal: call.signal });
      } catch (error) {
        if (cloudSessionEnded(error)) return call.error('unauthenticated', SESSION_ENDED, {});
        const friendly = billingErrorMessage(error);
        if (friendly) throw new Error(friendly, { cause: error });
        throw error;
      }
      return { url: result.url };
    },
    shipLogout: async (input: unknown, call: import('@opencode/plugin/promise/rpc').RpcCallContext<typeof import('../rpc').Carthagent.methods.shipLogout>) => {
      call.signal.throwIfAborted();
      let active: ActiveCredential;
      let token: string;
      try { ({ active, token } = await access()); }
      catch { return call.error('unauthenticated', 'An active Carthagent Cloud OAuth connection is required.', {}); }
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
