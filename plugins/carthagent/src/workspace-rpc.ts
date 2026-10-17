import { Rpc } from '@opencode/plugin/rpc';

const string = { type: 'string', minLength: 1 } as const;
const sessionInput = {
  type: 'object', properties: { sessionID: string }, required: ['sessionID'], additionalProperties: false,
} as const;
const project = {
  type: 'object', properties: { id: string, directory: string, name: string },
  required: ['id', 'directory'], additionalProperties: false,
} as const;
const task = {
  type: 'object', properties: {
    id: string, projectID: string, title: string, status: string,
    attention: { type: 'boolean' }, directory: string, branch: string,
  }, required: ['id', 'projectID', 'title', 'status'], additionalProperties: false,
} as const;
const session = {
  type: 'object', properties: {
    id: string, taskID: string, projectID: string, title: { type: 'string' }, status: string,
    updatedAt: string, directory: string,
  }, required: ['id', 'title', 'status', 'directory'], additionalProperties: false,
} as const;
const deliveryStatus = { type: 'string', enum: ['unavailable', 'invalid', 'active', 'implementing', 'verifying', 'verified', 'blocked', 'stale'] } as const;
const evidenceItem = {
  type: 'object', properties: {
    id: string, status: { type: 'string', enum: ['pending', 'failed', 'fresh', 'stale'] },
    executedRevision: { type: 'integer' }, code: { type: 'integer' }, filename: string,
  }, required: ['id', 'status'], additionalProperties: false,
} as const;
const deliveryPlan = {
  type: 'object', properties: {
    goal: { type: 'string' }, verification: { type: 'string' },
    acceptance: { type: 'array', items: { type: 'object', properties: { requirement: { type: 'string' }, checks: { type: 'array', items: string } }, required: ['requirement', 'checks'], additionalProperties: false } },
    artifacts: { type: 'array', items: { type: 'string' } }, outputs: { type: 'array', items: { type: 'string' } }, assumptions: { type: 'array', items: { type: 'string' } },
    checks: { type: 'array', items: { type: 'object', properties: { id: string, kind: { type: 'string' }, argv: { type: 'array', items: { type: 'string' } }, timeoutSeconds: { type: 'integer' } }, required: ['id', 'kind', 'argv', 'timeoutSeconds'], additionalProperties: false } },
    steps: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, status: { type: 'string' }, dependsOn: { type: 'array', items: { type: 'string' } }, checks: { type: 'array', items: { type: 'string' } } }, required: ['id', 'title', 'status', 'dependsOn', 'checks'], additionalProperties: false } },
    scenarios: { type: 'array', items: { type: 'object', properties: { id: string, requirement: { type: 'string' }, kind: { type: 'string' }, path: { type: 'array', items: { type: 'string' } }, checks: { type: 'array', items: { type: 'string' } }, input: { type: 'string' }, expected: { type: 'string' }, assertion: { type: 'string' } }, required: ['id', 'requirement', 'kind', 'path', 'checks', 'input', 'expected', 'assertion'], additionalProperties: false } },
    risks: { type: 'array', items: { type: 'object', properties: { id: string, description: { type: 'string' }, status: { type: 'string' }, blocking: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['id', 'description', 'status', 'blocking', 'evidence'], additionalProperties: false } },
  }, required: ['goal', 'verification', 'acceptance', 'steps', 'artifacts', 'outputs', 'assumptions', 'checks', 'scenarios', 'risks'], additionalProperties: false,
} as const;
const graphNodes = { type: 'array', items: { type: 'object', properties: { id: string, title: { type: 'string' }, type: { type: 'string' }, status: { type: 'string' }, layer: { type: 'string' }, excludes: { type: 'array', items: { type: 'string' } }, requirements: { type: 'array', items: { type: 'string' } } }, required: ['id', 'title'], additionalProperties: false } } as const;
const graphEdges = { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, kind: { type: 'string' }, label: { type: 'string' } }, required: ['from', 'to', 'kind'], additionalProperties: false } } as const;
const workflowGraph = {
  type: 'object', properties: {
    authored: { type: 'boolean' }, semantics: { type: 'string' },
    nodes: { type: 'array', items: { type: 'object', properties: {
      id: string, title: { type: 'string' }, type: { type: 'string' }, status: { type: 'string' }, step: { type: 'string' },
      requirements: { type: 'array', items: { type: 'string' } }, components: { type: 'array', items: { type: 'string' } }, checks: { type: 'array', items: { type: 'string' } },
      inputs: { type: 'array', items: { type: 'string' } }, artifacts: { type: 'array', items: { type: 'string' } }, effects: { type: 'array', items: { type: 'string' } }, condition: { type: 'string' },
    }, required: ['id', 'title', 'type', 'status', 'requirements', 'components', 'checks', 'inputs', 'artifacts', 'effects'], additionalProperties: false } },
    edges: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, kind: { type: 'string' }, label: { type: 'string' }, when: { type: 'string' }, stop: { type: 'string' }, maxAttempts: { type: 'integer' } }, required: ['from', 'to', 'kind'], additionalProperties: false } },
  }, required: ['authored', 'semantics', 'nodes', 'edges'], additionalProperties: false,
} as const;
const architectureGraph = {
  type: 'object', properties: {
    nodes: graphNodes, edges: graphEdges,
    ports: { type: 'array', items: { type: 'object', properties: { id: string, owner: string, adapter: string, compositionRoot: string, input: { type: 'string' }, output: { type: 'string' }, errors: { type: 'string' }, injection: { type: 'string' }, testDouble: { type: 'string' }, integrationAssertion: { type: 'string' } }, required: ['id', 'owner', 'adapter', 'compositionRoot', 'input', 'output', 'errors', 'injection', 'testDouble', 'integrationAssertion'], additionalProperties: false } },
  }, required: ['nodes', 'edges', 'ports'], additionalProperties: false,
} as const;
const deliveryOutput = {
  type: 'object', properties: {
    status: deliveryStatus, freshness: { type: 'string', enum: ['current', 'stale'] }, completion: { type: 'string', enum: ['ready', 'incomplete'] }, gate: { type: 'string', enum: ['locked', 'open'] }, runId: string,
    revision: { type: 'integer' }, fingerprint: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    plan: deliveryPlan, workflow: workflowGraph, architecture: architectureGraph,
    evidence: { type: 'array', items: evidenceItem },
    truncation: { type: 'object', properties: Object.fromEntries(['checks', 'acceptance', 'steps', 'artifacts', 'outputs', 'assumptions', 'scenarios', 'risks', 'workflowNodes', 'workflowEdges', 'architectureNodes', 'architectureEdges', 'architecturePorts'].map(key => [key, { type: 'object', properties: { returned: { type: 'integer' }, total: { type: 'integer' } }, required: ['returned', 'total'], additionalProperties: false }])), required: ['checks', 'acceptance', 'steps', 'artifacts', 'outputs', 'assumptions', 'scenarios', 'risks', 'workflowNodes', 'workflowEdges', 'architectureNodes', 'architectureEdges', 'architecturePorts'], additionalProperties: false },
  }, required: ['status'], additionalProperties: false,
} as const;

/** Shared server/TUI contract. Callers supply the intended native location on every call. */
export const Workspace = Rpc.define({
  id: 'carthagent.workspace',
  methods: {
    snapshot: {
      input: { type: 'object', properties: { projectID: string }, additionalProperties: false },
      output: {
        type: 'object', properties: {
          projects: { type: 'array', items: project }, tasks: { type: 'array', items: task },
          sessions: { type: 'array', items: session },
        }, required: ['projects', 'tasks', 'sessions'], additionalProperties: false,
      },
    },
    open: {
      input: sessionInput,
      output: { type: 'object', properties: { opened: { type: 'boolean' }, directory: string }, required: ['opened', 'directory'], additionalProperties: false },
    },
    createWorktree: {
      input: { type: 'object', properties: { projectID: string, name: string }, required: ['projectID', 'name'], additionalProperties: false },
      output: { type: 'object', properties: { directory: string }, required: ['directory'], additionalProperties: false },
    },
    createTask: {
      input: { type: 'object', properties: { task: string, branch: string }, required: ['task'], additionalProperties: false },
      output: { type: 'object', properties: { taskID: string, sessionID: string, directory: string }, required: ['taskID', 'sessionID', 'directory'], additionalProperties: false },
    },
    delivery: {
      input: sessionInput,
      output: deliveryOutput,
    },
    review: {
      input: sessionInput,
      output: { type: 'object', properties: { status: string, summary: { type: 'string' } }, required: ['status'], additionalProperties: false },
    },
    startReview: {
      input: sessionInput,
      output: { type: 'object', properties: { status: string, summary: { type: 'string' }, sessionID: string }, required: ['status', 'summary'], additionalProperties: false },
      errors: {
        reviewFailed: { data: { type: 'object', properties: { message: string }, required: ['message'], additionalProperties: false } },
      },
    },
  },
  events: {
    updated: { schema: { type: 'object', properties: { revision: string }, required: ['revision'], additionalProperties: false } },
  },
});

export interface WorkspaceSnapshot {
  projects: Array<{ id: string; directory: string; name?: string }>;
  tasks: Array<{ id: string; projectID: string; title: string; status: string; attention?: boolean; directory?: string; branch?: string }>;
  sessions: Array<{ id: string; taskID?: string; projectID?: string; title: string; status: string; updatedAt?: string; directory: string }>;
}
