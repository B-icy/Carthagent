import { Plugin } from '@opencode/plugin';
import { Carthagent } from './rpc';
import { registerSessionControls } from './server/session-controls';
import { registerWorkspaceRpc } from './server/workspace-rpc';
import { registerPullRequests } from './server/pull-request-rpc';
import { registerArchive } from './server/archive-rpc';
import { registerProviders } from './server/providers';
import { createDeviceAuthController } from './server/device-auth.ts';
import { shipAgentDir } from '../../../lib/ship-auth.mjs';

export default Plugin.define({
  id: 'carthagent',
  async setup(context) {
    const cleanups: Array<() => Promise<void>> = [];
    const dispose = async () => {
      const failures: unknown[] = [];
      for (const cleanup of cleanups.splice(0).reverse()) {
        try { await cleanup(); }
        catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, 'Carthagent plugin cleanup failed');
    };
    const deviceAuth = createDeviceAuthController({ env: process.env, agentDir: shipAgentDir() });
    cleanups.push(() => deviceAuth.cleanup());
    try {
      cleanups.push(await registerProviders(context, { deviceAuth }));
      cleanups.push(await registerSessionControls(context));
      cleanups.push(await registerWorkspaceRpc(context, context.options));
      cleanups.push(await registerPullRequests(context));
      const archive = await registerArchive(context, context.options);
      cleanups.push(() => archive.dispose());
      const registration = await context.rpc.register(Carthagent, {
        health: async () => ({
          protocol: 1,
          hostVersion: context.app.version,
          directory: context.location.directory,
        }),
        echo: async (input) => ({ text: (input as { text: string }).text }),
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
      cleanups.push(() => registration.dispose());
      return dispose;
    } catch (error) {
      try { await dispose(); }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Carthagent plugin setup failed'); }
      throw error;
    }
  },
});
