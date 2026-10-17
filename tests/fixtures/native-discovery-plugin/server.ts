import { Plugin } from '@opencode/plugin';

export default Plugin.define({
  id: 'ctg-project-discovery-fixture',
  setup: async ctx => {
    const registration = await ctx.command.transform(editor => {
      editor.add({
        name: 'fixture-project-plugin-marker',
        description: 'Proves project-local plugin discovery is active.',
        execute: async () => { throw new Error('fixture marker command is not intended to execute'); },
      });
    });
    return () => registration.dispose();
  },
});
