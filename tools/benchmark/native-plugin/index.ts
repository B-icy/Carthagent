import { Plugin } from '@opencode/plugin';
import guard from '../guard.js';
import advisor from '../advisor.js';

export default Plugin.define({
  id:'ctg.benchmark',
  async setup(ctx) {
    const cleanups: Array<() => Promise<void>> = [];
    let disposed = false;
    const dispose = async () => {
      if (disposed) return;
      disposed = true;
      await Promise.allSettled(cleanups.reverse().map(cleanup => cleanup()));
    };
    try {
      cleanups.push(await guard(ctx));
      cleanups.push(await advisor(ctx));
    } catch (error) {
      await dispose();
      throw error;
    }
    return dispose;
  },
});
