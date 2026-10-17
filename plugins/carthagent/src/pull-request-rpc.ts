import { Rpc } from '@opencode/plugin/rpc';

const text = { type: 'string', minLength: 1 } as const;
const input = {
  type: 'object', properties: { sessionID: text, taskID: text, number: { type: 'integer', minimum: 1 } },
  required: ['sessionID', 'taskID'], additionalProperties: false,
} as const;
const pullRequest = {
  type: 'object', properties: {
    taskID: text, number: { type: 'integer' }, url: text, state: text, draft: { type: 'boolean' },
    head: text, headRef: text, headRepository: text, base: text, baseRef: text, checks: text, review: text, source: text, sourceSnapshot: text, updatedAt: text,
  }, required: ['taskID', 'number', 'url', 'state', 'draft', 'head', 'headRef', 'headRepository', 'base', 'baseRef', 'checks', 'review', 'source', 'sourceSnapshot', 'updatedAt'], additionalProperties: false,
} as const;

/** Separate native host contract so workspace RPC composition remains owned by its host. */
export const PullRequests = Rpc.define({
  id: 'carthagent.pull-requests',
  methods: {
    list: {
      input: { type: 'object', properties: { sessionID: text, taskID: text }, required: ['sessionID', 'taskID'], additionalProperties: false },
      output: { type: 'object', properties: { pullRequests: { type: 'array', items: pullRequest } }, required: ['pullRequests'], additionalProperties: false },
    },
    associate: {
      input,
      output: { type: 'object', properties: { pullRequest }, required: ['pullRequest'], additionalProperties: false },
    },
    refresh: {
      input,
      output: { type: 'object', properties: { pullRequest }, required: ['pullRequest'], additionalProperties: false },
    },
  },
  events: {},
});

export type PullRequestRecord = {
  taskID: string; number: number; url: string; state: string; draft: boolean; head: string; headRef: string; headRepository: string; base: string; baseRef: string;
  checks: string; review: string; source: string; sourceSnapshot: string; updatedAt: string;
};
