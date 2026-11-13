import { Rpc } from '@opencode/plugin/rpc';

export type DailyGoalMetric = 'lines' | 'tests' | 'reviews' | 'commits' | 'tasks' | 'verified';
export type DailyGoal = { id: string; metric: DailyGoalMetric; title: string; target: number; progress: number; completed: boolean; coins: number; xp: number };
export type DailyGoalsSnapshot = { day: string; endsAt: string; goals: DailyGoal[]; coins: number; level: number };
export type DailyGoalCompleted = { id: string; title: string; coins: number; xp: number };

const text = { type: 'string', minLength: 1, maxLength: 128 } as const;
const count = { type: 'integer', minimum: 0, maximum: 100000 } as const;
const metric = { type: 'string', enum: ['lines', 'tests', 'reviews', 'commits', 'tasks', 'verified'] } as const;
const object = <P extends Record<string, unknown>>(properties: P) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false } as const);
const goal = object({ id: text, metric, title: text, target: { ...count, minimum: 1 }, progress: count, completed: { type: 'boolean' }, coins: count, xp: count });
const completed = object({ id: text, title: text, coins: count, xp: count });
const errors = { dailyGoalsError: object({ code: text, status: { type: 'integer', minimum: 0, maximum: 599 } }) } as const;

/** Simple daily goals counted from this profile's own sessions. */
export const DailyGoals = Rpc.define({
  id: 'carthagent.dailyGoals',
  methods: {
    snapshot: { errors, input: { type: 'object', additionalProperties: false }, output: object({ day: text, endsAt: text, goals: { type: 'array', maxItems: 10, items: goal }, coins: { type: 'integer', minimum: 0 }, level: { type: 'integer', minimum: 1 } }) },
  },
  events: {
    completed: { schema: object({ goals: { type: 'array', minItems: 1, maxItems: 10, items: completed } }) },
  },
});
