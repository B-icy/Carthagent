import { Plugin } from '@opencode/plugin';
import { registerWorkspaceRpc } from '../../plugins/carthagent/src/server/workspace-rpc';

export default Plugin.define({
  id: 'carthagent-report-fixture',
  setup(context) {
    return registerWorkspaceRpc(context);
  },
});
