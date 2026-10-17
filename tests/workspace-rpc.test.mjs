import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createReport } from '../lib/reports.mjs';
import { checkDigest, fingerprint } from '../lib/delivery.mjs';
import { selectReport } from '../lib/workspace.mjs';

const require = createRequire(import.meta.url);
const { createJiti } = require('jiti');
const jiti = createJiti(import.meta.url);
const { registerWorkspaceRpc } = await jiti.import('../plugins/carthagent/src/server/workspace-rpc.ts');

function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }

test('native workspace RPC snapshots journaled sessions, enforces location ownership, and aborts requests', async t => {
  const base = mkdtempSync(join(tmpdir(), 'workspace-rpc-')); t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'project'); mkdirSync(root); git(root, 'init', '-q');
  const other = join(base, 'other'); mkdirSync(other);
  const sessionMap = new Map([
    ['root-session', { id: 'root-session', projectID: 'project-id', location: { directory: root }, title: 'Untracked UI session', outcome: 'succeeded', time: { updated: Date.now() } }],
    ['task-session', { id: 'task-session', projectID: 'project-id', location: { directory: join(base, 'worktree'), workspaceID: 'workspace' }, title: 'Task session', outcome: 'failed', time: { updated: Date.now() } }],
    ['foreign-session', { id: 'foreign-session', projectID: 'other-project', location: { directory: other }, title: 'Not ours', time: { updated: Date.now() } }],
  ]);
  const registered = {};
  const eventQueue = [];
  let wake;
  const events = {
    push(event) { eventQueue.push(event); wake?.(); },
    async *[Symbol.asyncIterator]({ signal } = {}) {
      while (true) {
        if (signal?.aborted) return;
        if (!eventQueue.length) await new Promise(resolve => {
          wake = resolve;
          signal?.addEventListener('abort', resolve, { once: true });
        });
        wake = undefined;
        while (eventQueue.length) yield eventQueue.shift();
      }
    },
  };
  const emitted = [];
  const ctx = {
    location: { directory: root, project: { id: 'project-id', canonical: root } },
    session: {
      async get({ sessionID }, options) { options?.signal?.throwIfAborted(); const found = sessionMap.get(sessionID); if (!found) throw Error('missing'); return found; },
      async create(input, options) { options?.signal?.throwIfAborted(); const id = `created-${sessionMap.size}`; sessionMap.set(id, { id, projectID: 'project-id', location: input.location, title: input.title, time: { updated: Date.now() } }); return { id }; },
    },
    worktree: { async create({ projectID, name }, options) { options?.signal?.throwIfAborted(); assert.equal(projectID, 'project-id'); assert.ok(name); return { directory: join(base, 'new-worktree') }; } },
    rpc: { async register(_definition, handlers) { Object.assign(registered, handlers); return { events: { async emit(name, payload) { emitted.push({ name, payload }); } }, dispose() {} }; } },
    event: { subscribe: ({ signal }) => ({ [Symbol.asyncIterator]: () => events[Symbol.asyncIterator]({ signal }) }) },
  };
  const taskDir = join(base, 'worktree'); mkdirSync(taskDir);
  const statePath = join(root, '.harness/opencode-tasks.json'); mkdirSync(join(root, '.harness'));
  writeFileSync(statePath, JSON.stringify({ version: 1, tasks: [{ id: 'task-1', task: 'Tracked task', sessionID: 'task-session', worktree: taskDir, status: 'active' }], operations: [] }));
  const dispose = await registerWorkspaceRpc(ctx);
  t.after(dispose);

  const data = await registered.snapshot({}, { signal: new AbortController().signal });
  assert.equal(data.sessions.length, 1, 'only task sessions can be inventoried by the plugin Context');
  assert.deepEqual(data.tasks.map(task => task.id), ['task-1']);
  assert.equal(data.tasks[0].attention, true, 'native failed outcome is surfaced');
  assert.equal(Object.hasOwn(data.tasks[0], 'branch'), false, 'undefined optional branch is omitted from RPC output');
  assert.equal(data.sessions[0].id, 'task-session');

  await assert.rejects(registered.open({ sessionID: 'foreign-session' }, { signal: new AbortController().signal }), /another workspace location/);
  assert.deepEqual(await registered.open({ sessionID: 'root-session' }, { signal: new AbortController().signal }), { opened: true, directory: root });
  assert.deepEqual(await registered.createWorktree({ projectID: 'project-id', name: 'task' }, { signal: new AbortController().signal }), { directory: join(base, 'new-worktree') });
  await assert.rejects(registered.createWorktree({ projectID: 'other-project', name: 'task' }, { signal: new AbortController().signal }), /outside this OpenCode workspace/);
  const controller = new AbortController(); controller.abort(new Error('cancelled'));
  await assert.rejects(registered.snapshot({}, { signal: controller.signal }), /cancelled/);
  await new Promise(resolve => setTimeout(resolve, 20));
  events.push({ id: 'event-1', created: Date.now(), type: 'session.execution.started', data: { sessionID: 'task-session' }, durable: { aggregateID: 'task-session', seq: 2, version: 1 } });
  const deadline = Date.now() + 1000;
  while (!emitted.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(emitted[0]?.name, 'updated');
  assert.deepEqual(Object.keys(emitted[0]?.payload ?? {}), ['revision']);
  const inFlight = await registered.snapshot({}, { signal: new AbortController().signal });
  assert.equal(inFlight.sessions[0].status, 'running');
});

test('registration failures reject setup and cannot leave an active unregistered bridge', async t => {
  const root = mkdtempSync(join(tmpdir(), 'workspace-rpc-register-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  let subscribed = false;
  const ctx = {
    location: { directory: root, project: { id: 'project-id', canonical: root } }, session: {}, worktree: {},
    rpc: { async register() { throw new Error('registration rejected'); } },
    event: { subscribe: () => { subscribed = true; return { async *[Symbol.asyncIterator]() {} }; } },
  };
  await assert.rejects(registerWorkspaceRpc(ctx), /registration rejected/);
  assert.equal(subscribed, false, 'event stream should not start when RPC registration fails');
});

test('durable task creation propagates cancellation into native worktree creation', async t => {
  const base = mkdtempSync(join(tmpdir(), 'workspace-rpc-cancel-')); t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'project'); mkdirSync(root); git(root, 'init', '-q');
  const registered = {};
  const controller = new AbortController();
  const ctx = {
    location: { directory: root, project: { id: 'project-id', canonical: root } }, session: {},
    worktree: { async create(_input, { signal }) { assert.equal(signal, controller.signal); controller.abort(new Error('cancelled create')); signal.throwIfAborted(); } },
    rpc: { async register(_definition, handlers) { Object.assign(registered, handlers); return { events: { async emit() {} }, dispose() {} }; } },
    event: { subscribe: () => ({ async *[Symbol.asyncIterator]() {} }) },
  };
  const dispose = await registerWorkspaceRpc(ctx, { reviewModel: { providerID: 'fixture', id: 'review-model' } }); t.after(dispose);
  await assert.rejects(registered.createTask({ task: 'cancel me' }, { signal: controller.signal }), /cancelled create/);
  const journal = JSON.parse(readFileSync(join(root, '.harness/opencode-tasks.json'), 'utf8'));
  assert.equal(journal.operations[0].status, 'recovery-required');
});

test('delivery RPC returns bounded authoritative session report projections and rejects stale, foreign, and corrupt reports', async t => {
  const root = mkdtempSync(join(tmpdir(), 'workspace-rpc-delivery-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  writeFileSync(join(root, 'source.txt'), 'before');
  const sessionID = 'delivery-session';
  const session = { id: sessionID, projectID: 'project-id', location: { directory: root }, title: 'Delivery', time: { updated: Date.now() } };
  const sessions = new Map([[sessionID, session], ['foreign-session', { ...session, id: 'foreign-session' }]]);
  const registered = {};
  let workspaceContract;
  const ctx = {
    location: { directory: root, project: { id: 'project-id', canonical: root } },
    session: { async get({ sessionID: id }) { const value = sessions.get(id); if (!value) throw Error('missing'); return value; } },
    worktree: {},
    rpc: { async register(definition, handlers) { workspaceContract = definition; Object.assign(registered, handlers); return { events: { async emit() {} }, dispose() {} }; } },
    event: { subscribe: () => ({ async *[Symbol.asyncIterator]() {} }) },
  };
  const dispose = await registerWorkspaceRpc(ctx); t.after(dispose);
  const check = { id: 'unit', kind: 'test', argv: ['node', '--test'], timeoutSeconds: 20 };
  const plan = {
    goal: 'Deliver a visible feature', verification: 'required', artifacts: ['.'], outputs: [],
    steps: [{ id: 'implement', title: 'Implement feature', dependsOn: [], checks: ['unit'] }],
    acceptance: [{ requirement: 'Feature is visible', checks: ['unit'] }], checks: [check],
    design: { components: [{ id: 'core', responsibility: 'Own feature behavior', layer: 'core', excludes: ['UI'], dependencies: [], requirements: ['Feature is visible'] }], ports: [] },
  };
  const runId = 'run-1';
  const current = fingerprint(root, ['.']);
  const report = createReport(root, { runId, revision: 2, status: 'implementing', plan,
    stepStatus: { step0: 'active' }, evidence: { unit: { runId, revision: 2, checkDigest: checkDigest(check), passed: true, fingerprint: current, executedRevision: 2, durationMs: 9, code: 0, logPath: join(root, '.harness', sessionID, runId, 'logs', 'unit.log'), outputTail: 'must not leave the report DTO' } },
  }, sessionID);
  selectReport(root, report.path);
  const signal = new AbortController().signal;
  const result = await registered.delivery({ sessionID }, { signal });
  assert.equal(result.status, 'implementing');
  assert.equal(result.freshness, 'current');
  assert.equal(result.runId, runId);
  assert.equal(result.revision, 2);
  assert.deepEqual(result.plan.acceptance, [{ requirement: 'Feature is visible', checks: ['unit'] }]);
  assert.equal(result.plan.steps[0].status, 'active');
  assert.ok(result.workflow.nodes.some(node => node.id === 'gate_verify'));
  assert.equal(result.architecture.nodes[0].title, 'Own feature behavior');
  assert.deepEqual(result.evidence, [{ id: 'unit', status: 'fresh', executedRevision: 2, code: 0, filename: 'unit.log' }]);
  assert.equal(JSON.stringify(result).includes('must not leave the report DTO'), false);
  assert.equal(JSON.stringify(result).includes(root), false, 'only a log filename, never the report’s absolute path, is exposed');
  const deliverySchema = workspaceContract.methods.delivery.output;
  assert.equal(deliverySchema.additionalProperties, false);
  assert.deepEqual(Object.keys(deliverySchema.properties).sort(), ['architecture', 'evidence', 'fingerprint', 'freshness', 'plan', 'revision', 'runId', 'status', 'workflow']);
  assert.equal(deliverySchema.properties.plan.additionalProperties, false);

  writeFileSync(join(root, 'source.txt'), 'edited');
  const stale = await registered.delivery({ sessionID }, { signal });
  assert.equal(stale.freshness, 'stale');
  assert.equal(stale.evidence[0].status, 'stale');

  const foreign = createReport(root, { runId: 'foreign-run', revision: 1, status: 'verified', plan, evidence: {} }, 'foreign-session');
  selectReport(root, foreign.path);
  assert.deepEqual(await registered.delivery({ sessionID }, { signal }), { status: 'unavailable' });

  selectReport(root, report.path);
  writeFileSync(report.path, '{corrupt');
  assert.deepEqual(await registered.delivery({ sessionID }, { signal }), { status: 'invalid' });

  writeFileSync(join(root, '.harness', 'active.json'), '{corrupt');
  assert.deepEqual(await registered.delivery({ sessionID }, { signal }), { status: 'invalid' });
});
