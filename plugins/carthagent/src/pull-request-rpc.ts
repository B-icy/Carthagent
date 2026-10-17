import { Rpc } from '@opencode/plugin/rpc';

const id = { type: 'string', minLength: 1, maxLength: 128 } as const;
const ref = { type: 'string', minLength: 1, maxLength: 255 } as const;
const hash = { type: 'string', minLength: 40, maxLength: 64 } as const;
const url = { type: 'string', minLength: 1, maxLength: 2048 } as const;
const input = {
  type: 'object', properties: { sessionID: id, taskID: id, number: { type: 'integer', minimum: 1, maximum: 2147483647 } },
  required: ['sessionID', 'taskID'], additionalProperties: false,
} as const;
const pullRequest = {
  type: 'object', properties: {
    taskID: id, number: { type: 'integer', minimum: 1, maximum: 2147483647 }, url, state: { type: 'string', enum: ['open', 'closed'] }, draft: { type: 'boolean' },
    head: hash, headRef: ref, headRepository: { type: 'string', minLength: 3, maxLength: 511 }, base: hash, baseRef: ref,
    checks: { type: 'string', enum: ['passed', 'failed', 'pending', 'partial', 'none'] },
    review: { type: 'string', enum: ['approved-unverified', 'changes-requested', 'unverified', 'unreviewed'] },
    source: { type: 'string', enum: ['current', 'stale-source'] }, sourceSnapshot: hash, updatedAt: { type: 'string', minLength: 20, maxLength: 40 },
  }, required: ['taskID', 'number', 'url', 'state', 'draft', 'head', 'headRef', 'headRepository', 'base', 'baseRef', 'checks', 'review', 'source', 'sourceSnapshot', 'updatedAt'], additionalProperties: false,
} as const;

/** Separate native host contract so workspace RPC composition remains owned by its host. */
export const PullRequests = Rpc.define({
  id: 'carthagent.pull-requests',
  methods: {
    list: {
      input: { type: 'object', properties: { sessionID: id, taskID: id }, required: ['sessionID', 'taskID'], additionalProperties: false },
      output: { type: 'object', properties: { pullRequests: { type: 'array', maxItems: 100, items: pullRequest } }, required: ['pullRequests'], additionalProperties: false },
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
