import { Plugin } from '@opencode/plugin/tui';
import diagnostics from './src/bootstrap';
import workspace from './src/tui';

export default Plugin.define({
  id: 'carthagent.tui',
  async setup(context) {
    const cleanups: Plugin.Cleanup[] = [];
    const dispose = async () => {
      const results = await Promise.allSettled(cleanups.splice(0).reverse().map(cleanup => Promise.resolve().then(cleanup)));
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Carthagent terminal cleanup failed');
    };
    try {
      for (const definition of [diagnostics, workspace]) {
        const cleanup = await definition.setup(context);
        if (cleanup) cleanups.push(cleanup);
      }
      return dispose;
    } catch (error) {
      try { await dispose(); }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Carthagent terminal setup failed'); }
      throw error;
    }
  },
});
