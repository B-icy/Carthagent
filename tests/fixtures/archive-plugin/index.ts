import { Plugin } from '@opencode/plugin';
import { registerArchive } from '../../../plugins/carthagent/src/server/archive-rpc';

/** Real OpenCode fixture exercising archive registration and wire schemas. */
export default Plugin.define({
  id: 'ctg-archive-fixture',
  async setup(context) {
    return registerArchive(context);
  },
});
