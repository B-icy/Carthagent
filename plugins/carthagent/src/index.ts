import { Plugin } from '@opencode/plugin';
import { resolve } from 'node:path';
import { Carthagent } from './rpc';
import { registerSessionControls } from './server/session-controls';
import { registerWorkspaceRpc } from './server/workspace-rpc';
import { registerPullRequests } from './server/pull-request-rpc';
import { registerArchive } from './server/archive-rpc';
import { registerProviders } from './server/providers';
import { createDeviceAuthController } from './server/device-auth.ts';
import { shipAgentDir } from '../../../lib/ship-auth.mjs';
import { registerNativeDelivery } from './server/native-delivery';
import { createShipRpcHandlers } from './server/ship-rpc';

export async function setupCarthagent(
  context: Parameters<typeof registerSessionControls>[0],
  options: { delivery?: boolean; deliveryOptions?: Parameters<typeof registerNativeDelivery>[1] } = {},
) {
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
      if (options.delivery !== false) cleanups.push(await registerNativeDelivery(context, { ...sessionOptionDefaults(context.options), ...options.deliveryOptions }));
      let configuredRoots;
      try { configuredRoots = process.env.CTG_NATIVE_ARCHIVE_ROOTS ? JSON.parse(process.env.CTG_NATIVE_ARCHIVE_ROOTS) : undefined; }
      catch { throw new Error('Invalid native archive roots from the CTG host'); }
      const roots = context.options.archiveRoots ?? configuredRoots ?? [resolve(shipAgentDir(process.env), 'sessions')];
      if (!Array.isArray(roots) || roots.some(root => typeof root !== 'string')) throw new Error('Invalid native archive roots from the CTG host');
      const archive = await registerArchive(context, { ...context.options, archiveRoots: roots });
      cleanups.push(() => archive.dispose());
      const shipHandlers = createShipRpcHandlers(context);
      const registration = await context.rpc.register(Carthagent, {
        health: async () => ({
          protocol: 1,
          hostVersion: context.app.version,
          directory: context.location.directory,
          capabilities: options.delivery === false ? [] : ['delivery.session-options.v1', 'delivery.budgets.v1', 'delivery.policy-overrides.v1'],
        }),
        echo: async (input) => ({ text: (input as { text: string }).text }),
        budgetStatus: async (input, call) => {
          call.signal.throwIfAborted();
          const { sessionID } = input as { sessionID: string };
          const session = await context.session.get({ sessionID }, { signal: call.signal });
          if (session.location.directory !== context.location.directory) return call.error('budgetUnavailable', 'Session is outside this workspace location.', { reason: 'wrong-location' });
          const saved = await context.storage.get(`session/${sessionID}`) as { budget?: { tools: number; repairs: number; startedAt: number; limits: { tools: number; seconds: number; repairs: number }; stopped: string | null } } | undefined;
          const budget = saved?.budget;
          if (!budget) return call.error('budgetUnavailable', 'Session budget has not been initialized.', { reason: 'not-initialized' });
          return {
            tools: budget.tools, maxTools: budget.limits.tools, seconds: Math.max(0, Math.floor((Date.now() - budget.startedAt) / 1000)),
            maxSeconds: budget.limits.seconds, repairs: budget.repairs, maxRepairs: budget.limits.repairs, stopped: budget.stopped,
          };
        },
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
      cleanups.push(() => registration.dispose());
      return dispose;
    } catch (error) {
      try { await dispose(); }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Carthagent plugin setup failed'); }
      throw error;
    }
}

export default Plugin.define({ id: 'carthagent', setup: setupCarthagent });

function sessionOptionDefaults(options: Record<string, unknown>) {
  const allowed = ['maxTools', 'maxSeconds', 'maxRepairs', 'codegraphMaxFiles', 'bashCap', 'workflow', 'validators', 'context', 'strict', 'delivery', 'protectExisting', 'rewriteCap', 'toolOutputCap'];
  return Object.fromEntries(allowed.filter(key => options[key] !== undefined).map(key => [key, options[key]]));
}
