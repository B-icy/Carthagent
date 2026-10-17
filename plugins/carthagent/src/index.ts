import { Plugin } from '@opencode/plugin';
import { resolve } from 'node:path';
import { Carthagent } from './rpc';
import { registerProviders } from './server/providers';
import { createDeviceAuthController } from './server/device-auth.ts';
import { shipAgentDir } from '../../../lib/ship-auth.mjs';
import { registerSessionControls } from './server/session-controls';
import { registerArchive } from './server/archive-rpc';
import { createShipRpcHandlers } from './server/ship-rpc';
import { registerNativeDelivery } from './server/native-delivery';

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

export async function setupCarthagent(context: Parameters<typeof registerSessionControls>[0], options: { delivery?: boolean; deliveryOptions?: Parameters<typeof registerNativeDelivery>[1] } = {}) {
  const cleanups: Array<() => Promise<void>> = [];
  try {
      let configuredRoots;
      try { configuredRoots = process.env.CTG_NATIVE_ARCHIVE_ROOTS ? JSON.parse(process.env.CTG_NATIVE_ARCHIVE_ROOTS) : undefined; }
      catch { throw new Error('Invalid native archive roots from the CTG host'); }
      const roots = configuredRoots ?? [resolve(shipAgentDir(process.env), 'sessions')];
      if (!Array.isArray(roots) || roots.some(root => typeof root !== 'string')) throw new Error('Invalid native archive roots from the CTG host');
      const archiveRegistration = await registerArchive(context, { archiveRoots: roots });
      cleanups.push(() => archiveRegistration.dispose());
      cleanups.push(await registerSessionControls(context));
      if (options.delivery !== false) cleanups.push(await registerNativeDelivery(context, { ...options.deliveryOptions, ...sessionOptionDefaults(context.options) }));
      const deviceAuth = createDeviceAuthController({ env: process.env, agentDir: shipAgentDir() });
      cleanups.push(() => deviceAuth.cleanup());
      const shipHandlers = createShipRpcHandlers(context);
      const rpcRegistration = await context.rpc.register(Carthagent, {
        health: async () => ({
          protocol: 1,
          hostVersion: context.app.version,
          directory: context.location.directory,
          capabilities: options.delivery === false ? [] : ['delivery.session-options.v1', 'delivery.budgets.v1', 'delivery.policy-overrides.v1'],
        }),
        echo: async input => ({ text: (input as { text: string }).text }),
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
      cleanups.push(() => rpcRegistration.dispose());
      cleanups.push(await registerProviders(context, { deviceAuth }));
  } catch (error) {
    await cleanup(cleanups, error);
  }
  return async () => cleanup(cleanups);
}

function sessionOptionDefaults(options: Record<string, unknown>) {
  const allowed = ['maxTools', 'maxSeconds', 'maxRepairs', 'codegraphMaxFiles', 'bashCap', 'workflow', 'validators', 'context', 'strict', 'delivery', 'protectExisting', 'rewriteCap', 'toolOutputCap'];
  return Object.fromEntries(allowed.filter(key => options[key] !== undefined).map(key => [key, options[key]]));
}

export default Plugin.define({
  id: 'carthagent',
  setup: setupCarthagent,
});
