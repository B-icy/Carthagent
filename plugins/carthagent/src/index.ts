import { Plugin } from '@opencode/plugin';
import { Carthagent } from './rpc';
import { registerProviders } from './server/providers';
import { createDeviceAuthController } from './server/device-auth.ts';
import { shipAgentDir } from '../../../lib/ship-auth.mjs';
import { registerSessionControls } from './server/session-controls';
import { registerArchive } from './server/archive-rpc';
import { createShipRpcHandlers } from './server/ship-rpc';

async function cleanup(resources: Array<() => Promise<void>>, originalError?: unknown) {
  const failures: unknown[] = [];
  for (const dispose of resources.reverse()) {
    try { await dispose(); }
    catch (error) { failures.push(error); }
  }
  if (originalError !== undefined && failures.length) {
    throw new AggregateError([originalError, ...failures], 'Plugin setup failed and one or more completed registrations could not be disposed.');
  }
  if (originalError !== undefined) throw originalError;
  if (failures.length) throw new AggregateError(failures, 'One or more plugin registrations could not be disposed.');
}

export default Plugin.define({
  id: 'carthagent',
  async setup(context) {
    const cleanups: Array<() => Promise<void>> = [];
    try {
      let configuredRoots;
      try { configuredRoots = process.env.CTG_NATIVE_ARCHIVE_ROOTS ? JSON.parse(process.env.CTG_NATIVE_ARCHIVE_ROOTS) : undefined; }
      catch { throw new Error('Invalid native archive roots from the CTG host'); }
      const roots = configuredRoots ?? [`${shipAgentDir(process.env).replace(/[\\/]+$/, '')}/sessions`];
      if (!Array.isArray(roots) || roots.some(root => typeof root !== 'string')) throw new Error('Invalid native archive roots from the CTG host');
      const archiveRegistration = await registerArchive(context, { archiveRoots: roots });
      cleanups.push(() => archiveRegistration.dispose());
      cleanups.push(await registerSessionControls(context));
      const deviceAuth = createDeviceAuthController({ env: process.env, agentDir: shipAgentDir() });
      cleanups.push(() => deviceAuth.cleanup());
      const shipHandlers = createShipRpcHandlers(context);
      const rpcRegistration = await context.rpc.register(Carthagent, {
        health: async () => ({
          protocol: 1,
          hostVersion: context.app.version,
          directory: context.location.directory,
        }),
        echo: async input => ({ text: (input as { text: string }).text }),
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
        ...shipHandlers,
      });
      cleanups.push(() => rpcRegistration.dispose());
      cleanups.push(await registerProviders(context, { deviceAuth }));
    } catch (error) {
      await cleanup(cleanups, error);
    }
    return async () => cleanup(cleanups);
  },
});
