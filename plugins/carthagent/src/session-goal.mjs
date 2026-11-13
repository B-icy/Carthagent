/**
 * /goal: a persistent objective for one session. Carthagent keeps prompting the
 * model to continue after each turn until the model reports the goal done or
 * blocked, the user interrupts, a turn fails, or the turn cap is reached.
 * Pure helpers only; the server and TUI wire them up.
 */

export const GOAL_DEFAULT_TURNS = 8;
export const GOAL_MAX_TURNS = 50;
export const GOAL_MAX_CHARS = 2000;
export const GOAL_STATUSES = ['active', 'paused', 'done', 'blocked'];

/**
 * Parse `/goal` arguments.
 * @returns {{ action: 'status' } | { action: 'clear' } | { action: 'resume' } | { action: 'set', objective: string, maxTurns: number } | { action: 'error', message: string }}
 */
export function parseGoalCommand(input) {
  let text = String(input ?? '').trim();
  if (!text) return { action: 'status' };
  const word = text.toLowerCase();
  if (word === 'clear' || word === 'stop' || word === 'off') return { action: 'clear' };
  if (word === 'resume' || word === 'continue') return { action: 'resume' };
  if (word === 'status') return { action: 'status' };
  let maxTurns = GOAL_DEFAULT_TURNS;
  const flag = text.match(/^--turns(?:=|\s+)(\S+)\s*/);
  if (flag) {
    const n = Number(flag[1]);
    if (!Number.isInteger(n) || n < 1 || n > GOAL_MAX_TURNS) return { action: 'error', message: `--turns must be a whole number from 1 to ${GOAL_MAX_TURNS}.` };
    maxTurns = n;
    text = text.slice(flag[0].length).trim();
  }
  if (!text) return { action: 'error', message: 'Usage: /goal [--turns N] <objective> · /goal · /goal resume · /goal clear' };
  if (text.length > GOAL_MAX_CHARS) return { action: 'error', message: `A goal can be at most ${GOAL_MAX_CHARS} characters.` };
  return { action: 'set', objective: text, maxTurns };
}

/** A fresh active goal. */
export function newGoal(objective, maxTurns = GOAL_DEFAULT_TURNS, now = Date.now()) {
  return { objective, status: 'active', turns: 0, maxTurns, setAt: new Date(now).toISOString() };
}

/** Validate stored state; anything malformed reads as "no goal". */
export function readGoal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const g = value;
  if (typeof g.objective !== 'string' || !g.objective || !GOAL_STATUSES.includes(g.status)) return undefined;
  if (!Number.isInteger(g.turns) || g.turns < 0 || !Number.isInteger(g.maxTurns) || g.maxTurns < 1) return undefined;
  return g;
}

/** System text added to every model request while a goal is active. */
export function goalSystemText(goal) {
  return [
    `Session goal (set by the user with /goal): ${goal.objective}`,
    `Keep working toward this goal across turns without asking the user to continue; Carthagent prompts you to resume after each turn (turn ${goal.turns + 1} of at most ${goal.maxTurns}).`,
    'When the goal is fully achieved and checked, call goal_update with status "done" and a one-paragraph summary of what changed and how you verified it.',
    'If it cannot be finished without the user (missing access, a decision only they can make, or repeated failure), call goal_update with status "blocked" and say exactly what you need.',
    'Do not call goal_update "done" for partial progress.',
  ].join('\n');
}

/** Prompt sent automatically after a turn ends with the goal still active. */
export function continuationText(goal) {
  return `Continue working toward the goal: ${goal.objective}\n(Automatic /goal continuation ${Math.max(1, goal.turns)} of ${goal.maxTurns}. Call goal_update when it is done or blocked.)`;
}

/**
 * Decide what happens when a turn ends.
 * @param {object | undefined} goal
 * @param {'succeeded' | 'failed' | 'interrupted'} outcome
 * @returns {{ goal: object | undefined, action: 'none' | 'continue' | 'pause', reason?: string }}
 */
export function onTurnEnd(goal, outcome) {
  if (!goal || goal.status !== 'active') return { goal, action: 'none' };
  if (outcome === 'interrupted') return { goal: { ...goal, status: 'paused', reason: 'interrupted' }, action: 'pause', reason: 'interrupted' };
  if (outcome !== 'succeeded') return { goal: { ...goal, status: 'paused', reason: 'turn failed' }, action: 'pause', reason: 'turn failed' };
  if (goal.turns >= goal.maxTurns) return { goal: { ...goal, status: 'paused', reason: 'turn limit' }, action: 'pause', reason: 'turn limit' };
  return { goal: { ...goal, turns: goal.turns + 1 }, action: 'continue' };
}

/** Apply a goal_update tool call. Throws a model-readable error when there is nothing to update. */
export function applyGoalUpdate(goal, input, now = Date.now()) {
  if (!goal || goal.status !== 'active') throw new Error('There is no active /goal in this session; nothing to update.');
  const status = input?.status;
  const summary = typeof input?.summary === 'string' ? input.summary.trim().slice(0, 2000) : '';
  if (status !== 'done' && status !== 'blocked') throw new Error('status must be "done" or "blocked".');
  if (!summary) throw new Error('summary is required: what was achieved (done) or what you need from the user (blocked).');
  return { ...goal, status, summary, endedAt: new Date(now).toISOString() };
}

/** Resume a paused goal with a fresh turn allowance. */
export function resumeGoal(goal) {
  if (!goal) throw new Error('No goal is set. Use /goal <objective>.');
  if (goal.status === 'active') throw new Error('The goal is already active.');
  const { reason: _reason, summary: _summary, endedAt: _endedAt, ...rest } = goal;
  // The resume prompt is the first continuation of the fresh allowance.
  return { ...rest, status: 'active', turns: 1 };
}

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** One-line status for toasts and /goal. */
export function goalStatusText(goal) {
  if (!goal) return 'No goal set. Use /goal <objective> to have Carthagent keep working until it is done.';
  const objective = clip(goal.objective, 80);
  switch (goal.status) {
    case 'active': return `Goal active (turn ${goal.turns} of ${goal.maxTurns}): ${objective}`;
    case 'paused': return `Goal paused (${goal.reason ?? 'paused'}) after ${goal.turns} turn(s): ${objective}. /goal resume continues, /goal clear drops it.`;
    case 'done': return `Goal done: ${clip(goal.summary ?? objective, 160)}`;
    case 'blocked': return `Goal blocked: ${clip(goal.summary ?? objective, 160)}`;
    default: return objective;
  }
}
