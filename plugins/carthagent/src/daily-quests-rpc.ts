import { Rpc } from '@opencode/plugin/rpc';

export type DailyCheck = { name: string; before: 'failed' | 'not_run'; after: 'passed' | 'failed' | 'not_run'; revision: string; result: string };
export type DailyFinding = { issue: string; evidence: string; resolution: string };
export type DailyEvidence = { projectId: string; outcomeId: string; runId: string; revision: string; goal: string; change: string; checks: DailyCheck[]; findings: DailyFinding[] };
export type DailySubmission = {
  id: string; questId: string; status: 'queued' | 'grading' | 'graded' | 'failed'; decision: null | 'assessed_complete' | 'not_met' | 'needs_evidence';
  scores: null | Record<string, number>; model: null | string; rubricVersion: null | string; attempts: number; createdAt: string; consentAt: string;
  finishedAt: null | string; nextAttemptAt: null | string; errorCode: null | 'daily_grader_invalid' | 'daily_grader_unavailable' | 'daily_grader_timeout' | 'daily_grader_aborted' | 'daily_payload_expired' | 'daily_attempts_exhausted';
  assessmentBasis: 'tui_submitted'; rewards: false;
};
export type DailyQuest = { id: string; day: string; definition: { templateId: string; title: string; kind: 'change' | 'tests' | 'review'; rubricVersion: string; criteria: { id: string; text: string }[] }; status: 'open' | 'assessed_complete'; endsAt: string; completedAt: string | null; assessmentBasis: 'tui_submitted'; rewards: false };
export type DailyQuestDetail = DailyQuest & { latestSubmission: DailySubmission | null };
export type DailySlate = { day: string; endsAt: string; policyVersion: string; items: DailyQuest[]; assessmentBasis: 'tui_submitted'; rewards: false };
export type DailyRecord = { id: string; questId: string; createdAt: string; request: { id: string; consent: true; evidence: DailyEvidence } | null; submission: DailySubmission | null };
export type DailySnapshot = { accountKey: string; slate: DailySlate; records: DailyRecord[] };

// No arbitrary patterns: pinned native Effect conversion rejects them. Manual
// validation enforces UUIDs, revisions, UTF-8 limits and cross-field bindings.
const text = { type: 'string', maxLength: 4096 } as const;
const id = { type: 'string', minLength: 36, maxLength: 36 } as const;
const nullableText = { type: ['string', 'null'], maxLength: 4096 } as const;
const yes = { type: 'boolean', const: true } as const;
const basis = { assessmentBasis: { type: 'string', const: 'tui_submitted' }, rewards: { type: 'boolean', const: false } } as const;
const object = <P extends Record<string, unknown>>(properties: P) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false } as const);
const check = object({ name: text, before: { type: 'string', enum: ['failed', 'not_run'] }, after: { type: 'string', enum: ['passed', 'failed', 'not_run'] }, revision: text, result: text });
const finding = object({ issue: text, evidence: text, resolution: text });
const evidence = object({ projectId: id, outcomeId: id, runId: id, revision: text, goal: text, change: text, checks: { type: 'array', maxItems: 12, items: check }, findings: { type: 'array', maxItems: 5, items: finding } });
const request = object({ id, consent: yes, evidence });
const submission = object({
  id, questId: id, status: { type: 'string', enum: ['queued', 'grading', 'graded', 'failed'] }, decision: { type: ['string', 'null'], enum: [null, 'assessed_complete', 'not_met', 'needs_evidence'] },
  scores: { type: ['object', 'null'], additionalProperties: { type: 'number', minimum: 0, maximum: 1 } }, model: nullableText, rubricVersion: nullableText,
  attempts: { type: 'integer', minimum: 0, maximum: 4 }, createdAt: text, consentAt: text, finishedAt: nullableText, nextAttemptAt: nullableText,
  errorCode: { type: ['string', 'null'], enum: [null, 'daily_grader_invalid', 'daily_grader_unavailable', 'daily_grader_timeout', 'daily_grader_aborted', 'daily_payload_expired', 'daily_attempts_exhausted'] }, ...basis,
});
const questProperties = { id, day: text, definition: object({ templateId: text, title: text, kind: { type: 'string', enum: ['change', 'tests', 'review'] }, rubricVersion: text, criteria: { type: 'array', maxItems: 20, items: object({ id: text, text }) } }), status: { type: 'string', enum: ['open', 'assessed_complete'] }, endsAt: text, completedAt: nullableText, ...basis } as const;
const quest = object(questProperties);
const slate = object({ day: text, endsAt: text, policyVersion: text, items: { type: 'array', maxItems: 3, items: quest }, ...basis });
const record = object({ id, questId: id, createdAt: text, request: { anyOf: [request, { type: 'null' }] }, submission: { anyOf: [submission, { type: 'null' }] } });
const accountKey = { type: 'string', minLength: 64, maxLength: 64 } as const;
const errors = { dailyQuestError: object({ code: text, status: { type: 'integer', minimum: 0, maximum: 599 }, uncertain: { type: 'boolean' } }) } as const;
const result = object({ submission });
export const DailyQuests = Rpc.define({ id: 'carthagent.dailyQuests', methods: {
  snapshot: { errors, input: { type: 'object', additionalProperties: false }, output: object({ accountKey, slate, records: { type: 'array', maxItems: 64, items: record } }) },
  detail: { errors, input: object({ id }), output: object({ ...questProperties, latestSubmission: { anyOf: [submission, { type: 'null' }] } }) },
  submit: { errors, input: object({ accountKey, questId: id, id, consent: yes, evidence }), output: result },
  retry: { errors, input: object({ accountKey, id }), output: result },
  poll: { errors, input: object({ id }), output: result },
  forgetPayload: { errors, input: object({ accountKey, id }), output: object({ ok: yes }) },
}, events: {} });
