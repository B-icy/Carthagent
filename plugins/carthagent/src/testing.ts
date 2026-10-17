import { registerSessionControls } from './server/session-controls';
import { registerNativeDelivery } from './server/native-delivery';
import { Carthagent } from './rpc';
import type { Context } from '@opencode/plugin/promise/plugin';
import type { ShellHooks } from '@opencode/plugin/promise/shell';

const TestDiagnostics = {
  id: 'carthagent-test',
  methods: {
    state: {
      input: { type: 'object', properties: { sessionID: { type: 'string', minLength: 1 } }, required: ['sessionID'], additionalProperties: false },
      output: { type: 'object', properties: {
        budget: { type: ['object', 'null'], additionalProperties: true },
        delivery: { type: ['object', 'null'], additionalProperties: true },
        invocations: { type: 'array', items: { type: 'object', additionalProperties: true } },
      }, required: ['budget', 'delivery', 'invocations'], additionalProperties: false },
    },
  },
  events: {},
} as const;

/** Full host registration for the isolated native integration harness. */
export async function setupNativeTestPlugin(context: Parameters<typeof registerSessionControls>[0]) {
  const cleanups: Array<() => Promise<void>> = [];
  const invocations: Array<{ hook: string; tool?: string; command?: string }> = [];
  const monitored = {
    ...context,
    tool: {
      ...context.tool,
      hook: async (name: 'execute.before' | 'execute.after', callback: (event: { tool: string; id: string; sessionID: string }) => unknown) => context.tool.hook(name, async (event) => {
        if (name === 'execute.before' || name === 'execute.after') invocations.push({ hook: name, tool: event.tool });
        await callback(event);
      }),
    },
    shell: {
      ...context.shell,
      hook: async (name: keyof ShellHooks, callback: (event: ShellHooks[keyof ShellHooks]) => unknown) => context.shell.hook(name, async (event) => {
        if (name === 'create.before') invocations.push({ hook: `shell.${name}`, command: event.command });
        await callback(event);
      }),
    },
  } as unknown as Context;
  try {
    cleanups.push(await registerSessionControls(monitored));
    cleanups.push(await registerNativeDelivery(monitored));
    const registration = await context.rpc.register(Carthagent, {
      health: async () => ({ protocol: 1, hostVersion: context.app.version, directory: context.location.directory }),
      echo: async input => ({ text: (input as { text: string }).text }),
      authStart: async () => { throw new Error('Device authorization is not available in the isolated delivery test plugin.'); },
      authCancel: async () => ({ cancelled: false }),
      shipAccount: async () => { throw new Error('Ship account access is not available in the isolated delivery test plugin.'); },
      shipBilling: async () => { throw new Error('Ship billing is not available in the isolated delivery test plugin.'); },
      shipLogout: async () => { throw new Error('Ship credential changes are not available in the isolated delivery test plugin.'); },
    });
    cleanups.push(async () => registration.dispose());
    const diagnostics = await context.rpc.register(TestDiagnostics, {
      state: async (input) => {
        const { sessionID } = input as { sessionID: string };
        const stored = await context.storage.get(`session/${sessionID}`);
        const state = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored as Record<string, unknown> : undefined;
        return {
          budget: isRecord(state?.budget) ? { tools: state.budget.tools, limits: state.budget.limits, stopped: state.budget.stopped } : null,
          delivery: isRecord(state?.state) ? {
            workflowMode: state.state.workflowMode,
            status: state.state.status,
            planning: isRecord(state.state.planning) ? JSON.parse(JSON.stringify({
              validation: state.state.planning.validation,
              capture: isRecord(state.state.planning.capture) ? { id: state.state.planning.capture.id } : null,
              review: state.state.planning.review,
              approval: state.state.planning.approval,
              started: state.state.planning.started,
            })) : null,
          } : null,
          invocations,
        };
      },
    });
    cleanups.push(async () => diagnostics.dispose());
    return async () => { for (const cleanup of cleanups.reverse()) await cleanup(); };
  } catch (error) {
    await Promise.allSettled(cleanups.reverse().map(cleanup => cleanup()));
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
