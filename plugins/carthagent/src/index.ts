import { Plugin } from '@opencode/plugin';
import { Carthagent } from './rpc';

export default Plugin.define({
  id: 'carthagent',
  async setup(context) {
    const registration = await context.rpc.register(Carthagent, {
      health: async () => ({
        protocol: 1,
        hostVersion: context.app.version,
        directory: context.location.directory,
      }),
      echo: async (input) => ({ text: (input as { text: string }).text }),
    });
    return () => registration.dispose();
  },
});
