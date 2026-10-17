import { Plugin } from '@opencode/plugin';
import { registerWorkspaceRpc } from '../../plugins/carthagent/src/server/workspace-rpc';
import { Rpc } from '@opencode/plugin/rpc';
import { Workspace } from '../../plugins/carthagent/src/workspace-rpc';

const SchemaProbe = Rpc.define({
  id: 'carthagent.report-schema-probe',
  methods: {
    incompleteVerified: { input: { type: 'object', additionalProperties: false }, output: { oneOf: Workspace.methods.delivery.output.oneOf } },
    invalidWithFullFields: { input: { type: 'object', additionalProperties: false }, output: Workspace.methods.delivery.output },
    validUnavailable: { input: { type: 'object', additionalProperties: false }, output: { oneOf: Workspace.methods.delivery.output.oneOf } },
    validInvalid: { input: { type: 'object', additionalProperties: false }, output: { oneOf: Workspace.methods.delivery.output.oneOf } },
    validActive: { input: { type: 'object', additionalProperties: false }, output: { oneOf: Workspace.methods.delivery.output.oneOf } },
  },
  events: {},
});

export default Plugin.define({
  id: 'carthagent-report-fixture',
  async setup(context) {
    const disposeWorkspace = await registerWorkspaceRpc(context);
    try {
      const probe = await context.rpc.register(SchemaProbe, {
        incompleteVerified: async () => ({ status: 'verified' }),
        invalidWithFullFields: async () => ({
          status: 'invalid', freshness: 'current', completion: 'ready', gate: 'open',
          runId: 'forged-run', revision: 1, fingerprint: 'a'.repeat(64),
          plan: {}, workflow: {}, architecture: {}, evidence: [], truncation: {},
        }),
        validUnavailable: async () => ({ status: 'unavailable' }),
        validInvalid: async () => ({ status: 'invalid' }),
        validActive: async () => ({
          status: 'active', freshness: 'current', completion: 'incomplete', gate: 'open',
          runId: 'active-run', revision: 1, fingerprint: 'a'.repeat(64),
          plan: { goal: 'Goal', verification: 'required', acceptance: [], artifacts: [], outputs: [], assumptions: [], checks: [], steps: [], scenarios: [], risks: [] },
          workflow: { authored: false, semantics: '', nodes: [], edges: [] },
          architecture: { nodes: [], edges: [], ports: [] }, evidence: [],
          truncation: Object.fromEntries(['checks', 'acceptance', 'steps', 'artifacts', 'outputs', 'assumptions', 'scenarios', 'risks', 'workflowNodes', 'workflowEdges', 'architectureNodes', 'architectureEdges', 'architecturePorts'].map(key => [key, { returned: 0, total: 0 }])),
        }),
      });
      return async () => {
        try { await probe.dispose(); }
        finally { await disposeWorkspace(); }
      };
    } catch (error) {
      await disposeWorkspace();
      throw error;
    }
  },
});
