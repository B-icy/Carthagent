import { Rpc } from '@opencode/plugin/rpc';

/** Potentially sensitive, local-only selection material. Nothing is selected for upload. */
export interface DailySourceReport {
  runId: string;
  revision: string;
  planRevision: number;
  freshness: 'current' | 'stale';
  goal: string;
  change: string;
  checks: Array<{ id: string; before: 'not_run'; after: 'passed' | 'failed' | 'not_run'; revision: string; result: string }>;
  /** Model-authored review/resolution claims, not independent verification. */
  findings: Array<{ id: string; issue: string; evidence: string; resolution: string }>;
  /** At least one field or item was omitted; the UI must warn before selection. */
  truncated: boolean;
}

const id = { type: 'string', minLength: 1, maxLength: 128 } as const;
const fingerprint = { type: 'string', minLength: 64, maxLength: 64 } as const;
const goal = { type: 'string', maxLength: 1024 } as const;
const check = {
  type: 'object', properties: {
    id, before: { type: 'string', enum: ['not_run'] },
    after: { type: 'string', enum: ['passed', 'failed', 'not_run'] },
    revision: fingerprint, result: goal,
  }, required: ['id', 'before', 'after', 'revision', 'result'], additionalProperties: false,
} as const;
const finding = {
  type: 'object', properties: { id, issue: { type: 'string', maxLength: 768 }, evidence: { type: 'string', maxLength: 1536 }, resolution: goal },
  required: ['id', 'issue', 'evidence', 'resolution'], additionalProperties: false,
} as const;
const report = {
  type: 'object', properties: {
    runId: id, revision: fingerprint, planRevision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    freshness: { type: 'string', enum: ['current', 'stale'] }, goal, change: { type: 'string', maxLength: 3072 },
    checks: { type: 'array', items: check, maxItems: 12 }, findings: { type: 'array', items: finding, maxItems: 5 },
    truncated: { type: 'boolean' },
  }, required: ['runId', 'revision', 'planRevision', 'freshness', 'goal', 'change', 'checks', 'findings', 'truncated'], additionalProperties: false,
} as const;

/** Read-only local boundary, deliberately separate from authenticated/cloud RPCs. */
export const DailySource = Rpc.define({
  id: 'carthagent.daily-source',
  methods: {
    report: {
      input: { type: 'object', properties: { sessionID: id }, required: ['sessionID'], additionalProperties: false },
      output: { type: 'object', properties: { source: { anyOf: [report, { type: 'null' }] } }, required: ['source'], additionalProperties: false },
      errors: { dailySourceError: { type: 'object', properties: { code: id }, required: ['code'], additionalProperties: false } },
    },
  },
  events: {},
});
