import { Rpc } from '@opencode/plugin/rpc';

export type SessionGoalStatus = 'active' | 'paused' | 'done' | 'blocked';
export type SessionGoal = { objective: string; status: SessionGoalStatus; turns: number; maxTurns: number; setAt: string; reason?: string; summary?: string; endedAt?: string };

const sessionID = { type: 'string', minLength: 1, maxLength: 200 } as const;
const goal = {
  type: 'object',
  properties: {
    objective: { type: 'string', minLength: 1, maxLength: 2000 },
    status: { type: 'string', enum: ['active', 'paused', 'done', 'blocked'] },
    turns: { type: 'integer', minimum: 0 },
    maxTurns: { type: 'integer', minimum: 1 },
    setAt: { type: 'string' },
    reason: { type: 'string' },
    summary: { type: 'string' },
    endedAt: { type: 'string' },
  },
  required: ['objective', 'status', 'turns', 'maxTurns', 'setAt'],
  additionalProperties: false,
} as const;
const result = { type: 'object', properties: { goal: { anyOf: [goal, { type: 'null' }] } }, required: ['goal'], additionalProperties: false } as const;
const only = { type: 'object', properties: { sessionID }, required: ['sessionID'], additionalProperties: false } as const;
const errors = { goalError: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false } } as const;

/** /goal: a persistent per-session objective that Carthagent keeps working toward. */
export const SessionGoals = Rpc.define({
  id: 'carthagent.goal',
  methods: {
    get: { input: only, output: result, errors },
    set: {
      input: { type: 'object', properties: { sessionID, objective: { type: 'string', minLength: 1, maxLength: 2000 }, maxTurns: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['sessionID', 'objective', 'maxTurns'], additionalProperties: false },
      output: result, errors,
    },
    clear: { input: only, output: result, errors },
    resume: { input: only, output: result, errors },
  },
  events: {
    changed: { schema: { type: 'object', properties: { sessionID, goal: { anyOf: [goal, { type: 'null' }] } }, required: ['sessionID', 'goal'], additionalProperties: false } },
  },
});
