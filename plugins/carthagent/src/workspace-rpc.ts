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
      output: { type: 'object', properties: { plan: {}, evidence: {}, status: string }, required: ['status'], additionalProperties: false },
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
