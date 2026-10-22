import { appendFileSync } from 'node:fs';
import { Plugin } from '@opencode/plugin';

export default Plugin.define({
  id: 'ctg.owned-shell-observer',
  async setup(ctx) {
    const file = process.env.CTG_OWNED_SHELL_CAPTURE;
    if (!file) throw new Error('CTG_OWNED_SHELL_CAPTURE is required by the offline shell provenance probe');
    const registration = await ctx.shell.hook('create.before', event => {
      if (event.command.includes('owned-identical-shell') || event.command.includes('process.stdout.write')) {
        appendFileSync(file, `${JSON.stringify({ command: event.command, sessionID: event.sessionID ?? null, origin: event.origin ?? null, callID: event.callID ?? null })}\n`);
      }
    });
    return () => registration.dispose();
  },
});
