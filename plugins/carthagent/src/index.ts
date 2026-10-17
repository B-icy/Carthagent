import { Plugin } from '@opencode/plugin';
import { Carthagent } from './rpc';
import { registerProviders } from './server/providers';
import { createDeviceAuthController } from './server/device-auth.ts';
import { shipAgentDir } from '../../../lib/ship-auth.mjs';
import { registerSessionControls } from './server/session-controls';

export default Plugin.define({
  id: 'carthagent',
  async setup(context) {
    const disposeControls = await registerSessionControls(context);
    const deviceAuth = createDeviceAuthController({ env: process.env, agentDir: shipAgentDir() });
    const rpcRegistration = await context.rpc.register(Carthagent, {
      health: async () => ({
        protocol: 1,
        hostVersion: context.app.version,
        directory: context.location.directory,
      }),
      authStart: async (_input, call) => {
        call.signal.throwIfAborted();
        const flow = await deviceAuth.start(call.signal);
        const cancel = () => deviceAuth.cancel(flow.flowId);
        if (call.signal.aborted) cancel();
        else call.signal.addEventListener('abort', cancel, { once: true });
        return {
          flowId: flow.flowId,
          userCode: flow.authorization.userCode,
          verificationUri: flow.authorization.verificationUriComplete || flow.authorization.verificationUri,
          expiresAt: flow.expiresAt,
        };
      },
      authCancel: async (input, call) => {
        call.signal.throwIfAborted();
        return { cancelled: deviceAuth.cancel((input as { flowId: string }).flowId) };
      },
    });
    let providerCleanup: (() => Promise<void>) | undefined;
    try {
      providerCleanup = await registerProviders(context, { deviceAuth });
    } catch (error) {
      await deviceAuth.cleanup();
      await rpcRegistration.dispose();
      await disposeControls();
      throw error;
    }
    return async () => {
      try { await providerCleanup?.(); }
      finally {
        try { await deviceAuth.cleanup(); }
        finally {
          try { await rpcRegistration.dispose(); }
          finally { await disposeControls(); }
        }
      }
    };
  },
});
