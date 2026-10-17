import { Plugin } from '@opencode/plugin';
import { Carthagent } from './rpc';
import { registerSessionControls } from './server/session-controls';

export default Plugin.define({
  id: 'carthagent',
  async setup(context) {
    const disposeControls = await registerSessionControls(context);
    try {
      const registration = await context.rpc.register(Carthagent, {
        health: async () => ({
          protocol: 1,
          hostVersion: context.app.version,
          directory: context.location.directory,
        }),
      });
      return async () => {
        try { await registration.dispose(); }
        finally { await disposeControls(); }
      };
    } catch (error) {
      await disposeControls();
      throw error;
    }
  },
});
