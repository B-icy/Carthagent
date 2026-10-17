import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

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
