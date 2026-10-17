import { Plugin } from '@opencode/plugin';
import { Carthagent } from './rpc';
import { registerSessionControls } from './server/session-controls';
import { registerWorkspaceRpc } from './server/workspace-rpc';
import { registerArchive } from './server/archive-rpc';

export default Plugin.define({
  id: 'carthagent',
  async setup(context) {
    const cleanups: Array<() => Promise<void>> = [];
    const dispose = async () => {
      const results = await Promise.allSettled(cleanups.splice(0).reverse().map(cleanup => cleanup()));
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Carthagent plugin cleanup failed');
    };
    try {
      cleanups.push(await registerSessionControls(context));
      cleanups.push(await registerWorkspaceRpc(context, context.options));
      const archive = await registerArchive(context, context.options);
      cleanups.push(() => archive.dispose());
      const registration = await context.rpc.register(Carthagent, {
        health: async () => ({
          protocol: 1,
          hostVersion: context.app.version,
          directory: context.location.directory,
        }),
        echo: async (input) => ({ text: (input as { text: string }).text }),
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
