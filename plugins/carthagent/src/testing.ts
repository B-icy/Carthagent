import { registerSessionControls } from './server/session-controls';
import { registerDelivery } from './server/delivery';
import { registerCodegraph } from './server/codegraph';
import { Carthagent } from './rpc';

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
} as any;

/** Full host registration for the isolated native integration harness. */
export async function setupNativeTestPlugin(context: Parameters<typeof registerSessionControls>[0]) {
  const cleanups: Array<() => Promise<void>> = [];
  const invocations: Array<{ hook: string; tool?: string; command?: string }> = [];
  const monitored = {
    ...context,
    tool: {
      ...context.tool,
      hook: async (name: string, callback: (event: any) => unknown) => context.tool.hook(name as any, async (event: any) => {
        if (name === 'execute.before' || name === 'execute.after') invocations.push({ hook: name, tool: event.tool });
        await callback(event);
      }),
    },
    shell: {
      ...context.shell,
      hook: async (name: string, callback: (event: any) => unknown) => context.shell.hook(name as any, async (event: any) => {
        if (name === 'create.before') invocations.push({ hook: `shell.${name}`, command: event.command });
        await callback(event);
      }),
    },
  } as typeof context;
  try {
    cleanups.push(await registerSessionControls(monitored));
    cleanups.push(await registerDelivery(monitored));
    cleanups.push(await registerCodegraph(monitored));
    const registration = await context.rpc.register(Carthagent, {
      health: async () => ({ protocol: 1, hostVersion: context.app.version, directory: context.location.directory }),
    });
    cleanups.push(async () => registration.dispose());
    const diagnostics = await context.rpc.register(TestDiagnostics, {
      state: async ({ sessionID }: { sessionID: string }) => {
        const state: any = await context.storage.get(`session/${sessionID}`);
        return {
          budget: state?.budget ? { tools: state.budget.tools, limits: state.budget.limits, stopped: state.budget.stopped } : null,
          delivery: state?.state ? {
            workflowMode: state.state.workflowMode,
            status: state.state.status,
            planning: state.state.planning ? JSON.parse(JSON.stringify({
              validation: state.state.planning.validation,
              capture: state.state.planning.capture ? { id: state.state.planning.capture.id } : null,
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
