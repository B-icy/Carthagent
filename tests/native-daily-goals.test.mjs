import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addProgress, changedLines, completionMessage, goalTierLabel, goalBar, goalProgressLabel, isCommitCommand, isTestCommand, mergeGoals, patchLines, readProgress, toolGoalProgress } from '../plugins/carthagent/src/daily-goals.mjs';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { createDailyGoals } = await jiti.import('../plugins/carthagent/src/server/daily-goals.ts');

test('changed lines count additions plus removals, ignoring unchanged lines', () => {
  assert.equal(changedLines('a\nb\nc', 'a\nB\nc'), 2);
  assert.equal(changedLines('', 'one\ntwo\nthree\n'), 3);
  assert.equal(changedLines('x\ny', ''), 2);
  assert.equal(changedLines('same', 'same'), 0);
  assert.equal(patchLines('*** Begin Patch\n*** Update File: a.ts\n@@\n-old\n+new\n+more\n context\n*** End Patch'), 3);
});

test('edits, writes and patches count lines; failed edits count nothing', () => {
  assert.deepEqual(toolGoalProgress({ tool: 'edit', status: 'completed', input: { path: 'a', oldString: 'a\nb', newString: 'a\nc\nd' } }), { lines: 3 });
  assert.deepEqual(toolGoalProgress({ tool: 'edit', status: 'error', input: { oldString: 'a', newString: 'b' } }), {});
  assert.deepEqual(toolGoalProgress({ tool: 'write', status: 'completed', input: { content: 'a\nb\nc\n' }, previous: 'a\n' }), { lines: 2 });
  assert.deepEqual(toolGoalProgress({ tool: 'apply_patch', status: 'completed', input: { patchText: '@@\n-a\n+b' } }), { lines: 2 });
  assert.deepEqual(toolGoalProgress({ tool: 'read', status: 'completed', input: { path: 'a' } }), {});
});

test('test runs count even when they fail; commits count only when they succeed', () => {
  for (const command of ['npm test', 'npm run test:unit', 'cd app && npx vitest run', 'node --test tests/*.test.mjs', 'pytest -q', 'python -m pytest', 'go test ./...', 'cargo test', 'bun test', 'yarn test']) assert.ok(isTestCommand(command), command);
  // Seen live: flags before --test (IWF's real test script).
  for (const command of ['node --env-file-if-exists=.env.test --import tsx --test tests/user-add.test.ts', 'node --import tsx --test', 'NODE_ENV=test node --test-reporter=dot --test', 'python3 -m pytest -x', 'uv run pytest']) assert.ok(isTestCommand(command), command);
  for (const command of ['node scripts/build.mjs --testing', 'node --version', 'node server.js # test later']) assert.equal(isTestCommand(command), false, command);
  for (const command of ['npm install', 'cat test.txt', 'git commit -m test', 'ls tests', 'echo "attest"']) assert.equal(isTestCommand(command), false, command);
  assert.deepEqual(toolGoalProgress({ tool: 'shell', status: 'error', input: { command: 'npm test' } }), { tests: 1 });
  assert.deepEqual(toolGoalProgress({ tool: 'shell', status: 'completed', input: { command: 'git add -A && git commit -m "fix"' } }), { commits: 1 });
  assert.deepEqual(toolGoalProgress({ tool: 'shell', status: 'error', input: { command: 'git commit -m "fix"' } }), {});
  assert.equal(isCommitCommand('git commit --dry-run'), false);
  assert.deepEqual(toolGoalProgress({ tool: 'carthagent.delivery_check', status: 'completed', input: {} }), { tests: 1 });
  assert.deepEqual(toolGoalProgress({ tool: 'delivery_review', status: 'completed', input: {} }), { reviews: 1 });
  assert.deepEqual(toolGoalProgress({ tool: 'delivery_finish', status: 'completed', input: { status: 'verified' } }), { verified: 1 });
  assert.deepEqual(toolGoalProgress({ tool: 'delivery_finish', status: 'completed', input: { status: 'blocked' } }), {});
});

test("today's totals add up, restart on a new UTC day, and reject junk", () => {
  let state = addProgress(undefined, { lines: 5, tests: 1 }, '2026-11-13');
  state = addProgress(state, { lines: 7, karma: 9, tests: -3 }, '2026-11-13');
  assert.deepEqual(state.metrics, { lines: 12, tests: 1, reviews: 0, commits: 0, tasks: 0, verified: 0 });
  assert.deepEqual(addProgress(state, { lines: 1 }, '2026-11-14').metrics.lines, 1);
  assert.equal(readProgress({ day: '2026-11-12', metrics: { lines: 50 } }, '2026-11-13').metrics.lines, 0);
  assert.equal(readProgress({ day: '2026-11-13', metrics: { lines: -1, tests: 2.5, reviews: 2 } }, '2026-11-13').metrics.reviews, 2);
});

test('progress labels and bars are plain and honest', () => {
  assert.equal(goalProgressLabel({ metric: 'lines', target: 20, progress: 12, completed: false }), '12/20 lines');
  assert.equal(goalProgressLabel({ metric: 'reviews', target: 1, progress: 0, completed: false }), '0/1 review');
  assert.equal(goalBar({ target: 20, progress: 10, completed: false }, 10), '█████░░░░░');
  assert.equal(goalBar({ target: 1, progress: 1, completed: true }, 4), '████');
  assert.deepEqual(mergeGoals([{ metric: 'lines', target: 20, progress: 3, completed: false }], { metrics: { lines: 25 } })[0], { metric: 'lines', target: 20, progress: 20, completed: true });
});

function fixture(t, { now = Date.parse('2026-11-13T12:00:00Z'), responses = {} } = {}) {
  const requests = [];
  const cloudClient = { request: async (path, options) => {
    requests.push({ path, method: options.method, body: options.body });
    const response = responses[path];
    if (response instanceof Error) throw response;
    return typeof response === 'function' ? response(options.body) : response;
  } };
  const connection = { id: 'conn', type: 'credential', method: 'oauth' };
  const ctx = {
    integration: { connection: { active: async () => connection, resolve: async () => ({ type: 'oauth', methodID: 'carthagent-device', access: 'token' }) } },
    session: { get: async () => ({ location: { directory: t.dir } }) },
  };
  return { ctx, requests, cloudClient, now: () => now };
}

test('hooks count a real session, persist today, and report totals that pay out once', async t => {
  t.dir = await mkdtemp(join(tmpdir(), 'ctg-goals-'));
  const file = join(t.dir, 'state', 'daily-goals.json');
  const goals = [{ id: 'lines-20', metric: 'lines', tier: 'normal', title: 'Change 20 lines of code', target: 20, progress: 0, completed: false, completedAt: null, coins: 10, xp: 50 },
    { id: 'tests-1', metric: 'tests', tier: 'bigger', title: 'Run your tests', target: 1, progress: 0, completed: false, completedAt: null, coins: 25, xp: 125 },
    // An older server (before tiers) omits the field: treated as normal.
    { id: 'reviews-1', metric: 'reviews', title: 'Run a code review', target: 1, progress: 0, completed: false, completedAt: null, coins: 10, xp: 50 }];
  let paid = false;
  const f = fixture(t, { responses: {
    '/v1/voyages/daily-goals/progress': body => {
      const next = goals.map(g => ({ ...g, progress: Math.min(g.target, body.metrics[g.metric] ?? 0) })).map(g => ({ ...g, completed: g.progress === g.target }));
      const completed = paid ? [] : next.filter(g => g.completed).map(({ id, tier, title, coins, xp }) => ({ id, ...(tier ? { tier } : {}), title, coins, xp }));
      paid = true;
      return { day: body.day, endsAt: '2026-11-14T00:00:00.000Z', version: 'daily-goals-v1', goals: next, completed };
    },
    '/v1/voyages/profile': { profile: { coins: 2810, level: 1 } },
  } });
  const daily = createDailyGoals(f.ctx, { cloudClient: f.cloudClient, now: f.now, file, syncDelayMs: 60_000 });
  t.after(() => daily.dispose());
  const seen = [];
  daily.onCompleted(done => seen.push(...done.map(g => g.id)));
  await writeFile(join(t.dir, 'existing.txt'), 'one\n');
  await daily.before({ tool: 'write', sessionID: 's1', id: 'c1', input: { filePath: 'existing.txt', content: 'one\ntwo\nthree\n' } });
  await daily.after({ tool: 'write', sessionID: 's1', id: 'c1', input: { filePath: 'existing.txt', content: 'one\ntwo\nthree\n' }, status: 'completed' });
  await daily.after({ tool: 'edit', sessionID: 's1', id: 'c2', input: { oldString: 'a', newString: Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n') }, status: 'completed' });
  await daily.after({ tool: 'shell', sessionID: 's1', id: 'c3', input: { command: 'npm test' }, status: 'error' });
  await daily.prompt({ metadata: { 'ctg.reviewKickoff': true } });
  await daily.succeeded('s1');
  await daily.succeeded('s2');
  assert.deepEqual((await daily.load()).metrics, { lines: 13, tests: 1, reviews: 1, commits: 0, tasks: 1, verified: 0 });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).metrics.lines, 13, 'survives a service restart');
  const snapshot = await daily.snapshot(AbortSignal.timeout(5000));
  assert.deepEqual(snapshot.goals.map(g => [g.id, g.progress, g.completed]), [['lines-20', 13, false], ['tests-1', 1, true], ['reviews-1', 1, true]]);
  assert.equal(snapshot.coins, 2810);
  assert.deepEqual(snapshot.goals.map(g => g.tier), ['normal', 'bigger', 'normal']);
  assert.deepEqual(seen.sort(), ['reviews-1', 'tests-1']);
  assert.deepEqual(f.requests[0], { path: '/v1/voyages/daily-goals/progress', method: 'POST', body: { day: '2026-11-13', metrics: { lines: 13, tests: 1, reviews: 1, commits: 0, tasks: 1, verified: 0 } } });
  await daily.snapshot(AbortSignal.timeout(5000));
  assert.equal(seen.length, 2, 'a goal is celebrated once');
});

test('counting never throws into the session, and signed-out users still count locally', async t => {
  t.dir = await mkdtemp(join(tmpdir(), 'ctg-goals-'));
  const f = fixture(t);
  f.ctx.integration.connection.active = async () => undefined;
  const daily = createDailyGoals(f.ctx, { cloudClient: f.cloudClient, now: f.now, file: join(t.dir, 'goals.json'), syncDelayMs: 60_000 });
  t.after(() => daily.dispose());
  await daily.after({ tool: 'edit', sessionID: 's', id: 'x', input: { oldString: 'a', newString: 'b' }, status: 'completed' });
  await daily.after({ tool: 'edit', sessionID: 's', id: 'y', input: null, status: 'completed' });
  await daily.before({ tool: 'write', sessionID: 's', id: 'z', input: { filePath: join(t.dir, 'missing', 'file.txt') } });
  assert.equal((await daily.load()).metrics.lines, 2);
  await assert.rejects(daily.snapshot(AbortSignal.timeout(5000)), error => error.code === 'authentication_required');
  assert.equal(f.requests.length, 0);
});

test('bigger and stretch goals are labelled and celebrated as such', () => {
  assert.equal(goalTierLabel({ tier: 'normal' }), '');
  assert.equal(goalTierLabel({}), '');
  assert.equal(goalTierLabel({ tier: 'bigger' }), 'Bigger');
  assert.equal(completionMessage({ tier: 'stretch', title: 'Change 80 lines of code', coins: 60, xp: 300 }), 'Stretch goal done: Change 80 lines of code · +60 coins, +300 XP');
  assert.equal(completionMessage({ tier: 'normal', title: 'Run your tests', coins: 10, xp: 50 }), 'Daily goal done: Run your tests · +10 coins, +50 XP');
});

test('an unknown tier from the server is rejected rather than shown', async t => {
  t.dir = await mkdtemp(join(tmpdir(), 'ctg-goals-'));
  const f = fixture(t, { responses: {
    '/v1/voyages/daily-goals': { day: '2026-11-13', endsAt: '2026-11-14T00:00:00.000Z', goals: [{ id: 'lines-20', metric: 'lines', tier: 'legendary', title: 'x', target: 20, progress: 0, completed: false, coins: 10, xp: 50 }] },
    '/v1/voyages/profile': { profile: { coins: 1, level: 1 } },
  } });
  const daily = createDailyGoals(f.ctx, { cloudClient: f.cloudClient, now: f.now, file: join(t.dir, 'goals.json'), syncDelayMs: 60_000 });
  t.after(() => daily.dispose());
  await assert.rejects(daily.snapshot(AbortSignal.timeout(5000)), error => error.code === 'invalid_response');
});

// VOY-06: signed out, the page previews real goals and offers Sign in.
test('signed-out daily goals preview real catalogue goals and a Sign in action', async () => {
  const { SAMPLE_GOALS, signInNeeded } = await import('../plugins/carthagent/src/daily-goals.mjs');
  assert.deepEqual(SAMPLE_GOALS.map(goal => goal.title), ['Finish a verified Ship task', 'Run your tests', 'Make a commit']);
  for (const goal of SAMPLE_GOALS) assert.deepEqual([goal.coins, goal.xp], [10, 50]);
  assert.equal(signInNeeded('unauthorized'), true);
  assert.equal(signInNeeded('request_failed'), false);
  const page = readFileSync(new URL('../plugins/carthagent/src/ui/daily-goals.tsx', import.meta.url), 'utf8');
  assert.match(page, /Example goals \(yours appear after you sign in\)/);
  assert.match(page, /Verified Ship tasks and everyday coding count automatically/);
  assert.match(page, /bind: "l", title: "Sign in"/);
  assert.match(page, /dispatch\("provider\.connect"\)/);
});
