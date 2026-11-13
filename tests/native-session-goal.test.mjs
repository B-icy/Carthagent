import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { applyGoalUpdate, continuationText, goalStatusText, goalSystemText, newGoal, onTurnEnd, parseGoalCommand, readGoal, resumeGoal, GOAL_DEFAULT_TURNS } from '../plugins/carthagent/src/session-goal.mjs';
import { COMMANDS } from '../plugins/carthagent/src/ui/commands.ts';

const jiti = createJiti(import.meta.url);
const { createSessionGoals } = await jiti.import('../plugins/carthagent/src/server/session-goal.ts');

test('/goal parses objectives, turn limits and subcommands', () => {
  assert.deepEqual(parseGoalCommand(''), { action: 'status' });
  assert.deepEqual(parseGoalCommand('  clear '), { action: 'clear' });
  assert.deepEqual(parseGoalCommand('stop'), { action: 'clear' });
  assert.deepEqual(parseGoalCommand('resume'), { action: 'resume' });
  assert.deepEqual(parseGoalCommand('make all tests pass'), { action: 'set', objective: 'make all tests pass', maxTurns: GOAL_DEFAULT_TURNS });
  assert.deepEqual(parseGoalCommand('--turns 3 fix the lint errors'), { action: 'set', objective: 'fix the lint errors', maxTurns: 3 });
  assert.deepEqual(parseGoalCommand('--turns=20 x'), { action: 'set', objective: 'x', maxTurns: 20 });
  assert.equal(parseGoalCommand('--turns 0 x').action, 'error');
  assert.equal(parseGoalCommand('--turns 99 x').action, 'error');
  assert.equal(parseGoalCommand('--turns 3').action, 'error');
  assert.equal(parseGoalCommand('x'.repeat(2001)).action, 'error');
  // A goal that merely mentions a subcommand word is still a goal.
  assert.equal(parseGoalCommand('clear the stale cache entries').action, 'set');
});

test('turn ends continue an active goal until the limit, and pause on failure or interrupt', () => {
  let goal = newGoal('ship it', 2, 0);
  let step = onTurnEnd(goal, 'succeeded');
  assert.equal(step.action, 'continue'); assert.equal(step.goal.turns, 1);
  step = onTurnEnd(step.goal, 'succeeded');
  assert.equal(step.action, 'continue'); assert.equal(step.goal.turns, 2);
  step = onTurnEnd(step.goal, 'succeeded');
  assert.deepEqual([step.action, step.goal.status, step.goal.reason], ['pause', 'paused', 'turn limit']);
  assert.equal(onTurnEnd(newGoal('x'), 'interrupted').goal.reason, 'interrupted');
  assert.equal(onTurnEnd(newGoal('x'), 'failed').goal.reason, 'turn failed');
  assert.equal(onTurnEnd(undefined, 'succeeded').action, 'none');
  assert.equal(onTurnEnd({ ...newGoal('x'), status: 'done' }, 'succeeded').action, 'none');
  goal = resumeGoal(step.goal);
  assert.deepEqual([goal.status, goal.turns, goal.reason], ['active', 1, undefined]);
  assert.match(continuationText(goal), /continuation 1 of 2/);
  assert.throws(() => resumeGoal(goal), /already active/);
  assert.throws(() => resumeGoal(undefined), /No goal/);
});

test('goal_update needs an active goal, a final status and a summary', () => {
  const goal = newGoal('x', 4, 0);
  assert.throws(() => applyGoalUpdate(undefined, { status: 'done', summary: 's' }), /no active/);
  assert.throws(() => applyGoalUpdate(goal, { status: 'progress', summary: 's' }), /done.*blocked/);
  assert.throws(() => applyGoalUpdate(goal, { status: 'done', summary: '  ' }), /summary is required/);
  const done = applyGoalUpdate(goal, { status: 'done', summary: 'All 12 tests pass.' }, 1000);
  assert.deepEqual([done.status, done.summary, done.endedAt], ['done', 'All 12 tests pass.', '1970-01-01T00:00:01.000Z']);
  assert.throws(() => applyGoalUpdate(done, { status: 'done', summary: 'again' }), /no active/);
});

test('model and user text are explicit about how a goal ends', () => {
  const goal = newGoal('make npm test pass', 5, 0);
  assert.match(goalSystemText(goal), /make npm test pass/);
  assert.match(goalSystemText(goal), /goal_update with status "done"/);
  assert.match(goalSystemText(goal), /turn 1 of at most 5/);
  assert.match(continuationText({ ...goal, turns: 2 }), /Continue working toward the goal: make npm test pass[\s\S]*2 of 5/);
  assert.match(goalStatusText(undefined), /No goal set/);
  assert.match(goalStatusText({ ...goal, turns: 3 }), /Goal active \(turn 3 of 5\)/);
  assert.match(goalStatusText({ ...goal, status: 'paused', reason: 'turn limit' }), /paused \(turn limit\).*\/goal resume/);
  assert.match(goalStatusText({ ...goal, status: 'done', summary: 'Fixed.' }), /^Goal done: Fixed\.$/);
  assert.equal(readGoal({ objective: 'x', status: 'weird', turns: 0, maxTurns: 1 }), undefined);
  assert.equal(readGoal('nope'), undefined);
});

test('/goal is a listed slash command that takes arguments', () => {
  const command = COMMANDS.find(c => c.name === 'goal');
  assert.ok(command);
  assert.equal(command.submitSlash, true);
  assert.equal(command.hidden, undefined);
});

function engine() {
  const store = new Map();
  const prompts = [];
  const changes = [];
  const goals = createSessionGoals({ storage: {
    get: async k => store.get(k), set: async (k, v) => { store.set(k, structuredClone(v)); }, remove: async k => { store.delete(k); },
  } }, { prompt: async (sessionID, text, continuation) => { prompts.push({ sessionID, text, continuation }); }, changed: (sessionID, goal) => changes.push({ sessionID, status: goal?.status ?? null }), now: () => 0 });
  return { goals, prompts, changes, store };
}

test('the engine starts work, continues after each turn, and stops when the model says done', async () => {
  const { goals, prompts, changes } = engine();
  await goals.set('s1', 'add a README', 3);
  assert.deepEqual(prompts.map(p => p.text), ['Goal: add a README']);
  assert.match(await goals.systemText('s1'), /add a README/);
  assert.equal(await goals.systemText('s2'), undefined, 'other sessions are untouched');
  assert.equal(await goals.turnEnded('s1', 'succeeded'), 'continue');
  assert.equal(await goals.turnEnded('s2', 'succeeded'), 'none');
  assert.equal(prompts.length, 2);
  assert.match(prompts[1].text, /Continue working toward the goal: add a README/);
  assert.deepEqual(prompts.map(p => p.continuation), [false, true], 'only continuations skip task framing');
  await goals.update('s1', { status: 'done', summary: 'README added and linked.' });
  assert.equal(await goals.turnEnded('s1', 'succeeded'), 'none', 'a finished goal never prompts again');
  assert.equal(prompts.length, 2);
  assert.equal(await goals.systemText('s1'), undefined);
  assert.deepEqual(changes.map(c => c.status), ['active', 'active', 'done']);
});

test('the engine pauses at the turn limit and on interrupt; resume and clear work', async () => {
  const { goals, prompts } = engine();
  await goals.set('s1', 'refactor', 1);
  assert.equal(await goals.turnEnded('s1', 'succeeded'), 'continue');
  assert.equal(await goals.turnEnded('s1', 'succeeded'), 'pause');
  assert.equal((await goals.get('s1')).reason, 'turn limit');
  assert.equal(prompts.length, 2);
  await goals.resume('s1');
  assert.equal(prompts.length, 3);
  assert.equal(await goals.turnEnded('s1', 'interrupted'), 'pause', 'Esc pauses instead of fighting the user');
  assert.equal(prompts.length, 3);
  await goals.clear('s1');
  assert.equal(await goals.get('s1'), undefined);
  await assert.rejects(goals.resume('s1'), /No goal/);
});

test('only the plugin instance for the session\'s own workspace continues a goal', async () => {
  const { registerSessionGoals } = await jiti.import('../plugins/carthagent/src/server/session-goal.ts');
  const store = new Map();
  const prompts = [];
  const listeners = new Set();
  const storage = { get: async k => store.get(k), set: async (k, v) => { store.set(k, structuredClone(v)); }, remove: async k => { store.delete(k); } };
  const instance = directory => ({
    location: { directory }, storage,
    session: {
      get: async () => ({ location: { directory: '/repo/app' } }),
      prompt: async input => { prompts.push({ directory, text: input.text }); },
      hook: async () => ({ dispose: async () => {} }),
    },
    tool: { transform: async () => ({ dispose: async () => {} }) },
    rpc: { register: async () => ({ dispose: async () => {}, events: { emit: async () => {} } }) },
    event: { subscribe: ({ signal }) => ({ async *[Symbol.asyncIterator]() {
      const queue = []; let wake;
      const push = e => { queue.push(e); wake?.(); };
      listeners.add(push);
      signal.addEventListener('abort', () => wake?.());
      try { while (!signal.aborted) { if (!queue.length) await new Promise(r => { wake = r; }); while (queue.length) yield queue.shift(); } }
      finally { listeners.delete(push); }
    } }) },
  });
  const disposers = [await registerSessionGoals(instance('/repo/app')), await registerSessionGoals(instance('/repo/other'))];
  store.set('goal/s1', { objective: 'x', status: 'active', turns: 0, maxTurns: 5, setAt: 'now' });
  await new Promise(r => setTimeout(r, 10));
  for (const push of listeners) push({ type: 'session.execution.succeeded', data: { sessionID: 's1' } });
  await new Promise(r => setTimeout(r, 50));
  for (const dispose of disposers) await dispose();
  assert.deepEqual(prompts.map(p => p.directory), ['/repo/app'], 'exactly one continuation, from the owning workspace');
  assert.equal(store.get('goal/s1').turns, 1);
});

test('goal_update is a direct tool only, never callable from the code tool when no goal is active', async () => {
  const { registerSessionGoals } = await jiti.import('../plugins/carthagent/src/server/session-goal.ts');
  const added = [];
  const dispose = await registerSessionGoals({
    location: { directory: '/repo' },
    storage: { get: async () => undefined, set: async () => {}, remove: async () => {} },
    session: { get: async () => ({ location: { directory: '/repo' } }), prompt: async () => {}, hook: async () => ({ dispose: async () => {} }) },
    tool: { transform: async fn => { fn({ namespace() {}, add: def => added.push(def) }); return { dispose: async () => {} }; } },
    rpc: { register: async () => ({ dispose: async () => {}, events: { emit: async () => {} } }) },
    event: { subscribe: ({ signal }) => ({ async *[Symbol.asyncIterator]() { await new Promise(r => signal.addEventListener('abort', r)); } }) },
  });
  await dispose();
  const goal = added.find(def => def.name === 'goal_update');
  assert.ok(goal);
  // Hiding is done per turn in the context hook, which only filters direct tools.
  assert.equal(goal.options.codemode, false);
});
