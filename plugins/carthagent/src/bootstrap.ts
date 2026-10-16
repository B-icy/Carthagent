import { Plugin } from '@opencode/plugin/tui';
import { Carthagent } from './rpc';

/** Foundation diagnostic; replaced by the full UI entrypoint at integration. */
export default Plugin.define({
  id: 'carthagent.tui',
  setup(context) {
    context.keymap.layer(() => ({
      mode: 'global',
      commands: [{
        id: 'carthagent.health',
        title: 'Carthagent runtime status',
        palette: true,
        slash: { name: 'ctg-status' },
        async run() {
          try {
            const result = await context.client.rpc(Carthagent).health({}, {
              location: context.location ?? context.data.location.default(),
              signal: AbortSignal.timeout(10_000),
            });
            const health = result as { hostVersion: string; directory: string };
            context.ui.toast.show({
              title: 'Carthagent',
              message: `OpenCode ${health.hostVersion} · ${context.ui.format.path(health.directory)}`,
              variant: 'success',
            });
          } catch (error) {
            context.ui.toast.show({
              title: 'Carthagent runtime unavailable',
              message: error instanceof Error ? error.message : 'Could not read runtime status',
              variant: 'error',
            });
          }
        },
      }],
    }));
  },
});
