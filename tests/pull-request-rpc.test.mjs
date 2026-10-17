import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const jiti = require('jiti').createJiti(import.meta.url);
const { registerPullRequests } = await jiti.import('../plugins/carthagent/src/server/pull-request-rpc.ts');
const head = 'a'.repeat(40);
function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function fixture(t, sessionID = 'session-1') {
  const root = mkdtempSync(join(tmpdir(), 'pr-rpc-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project'); const worktree = join(root, 'task'); mkdirSync(project); mkdirSync(worktree);
  git(project, 'init', '-q'); git(worktree, 'init', '-q'); git(worktree, 'remote', 'add', 'origin', 'https://github.com/acme/repo.git');
  writeFileSync(join(worktree, 'tracked'), 'base'); git(worktree, 'add', 'tracked'); git(worktree, '-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'base');
  const actualHead = git(worktree, 'rev-parse', 'HEAD');
  const taskDir = join(project, '.harness'); mkdirSync(taskDir);
  writeFileSync(join(taskDir, 'opencode-tasks.json'), JSON.stringify({ version: 1, tasks: [{ id: 'task-1', task: 'test', sessionID, worktree, status: 'active' }], operations: [] }));
  const taskSession = { id: sessionID, projectID: 'project-id', location: { directory: worktree } };
  const handlers = {};
  const ctx = {
    location: { directory: project, project: { id: 'project-id', canonical: project } },
    session: { async get({ sessionID: id }) { if (id !== sessionID) throw Error('missing session'); return taskSession; } },
    rpc: { async register(_definition, methods) { Object.assign(handlers, methods); return { dispose() {} }; } },
  };
  const calls = [];
  const run = async (command, args, cwd) => {
    calls.push([command, args]);
    if (command === 'git') return args[0] === 'remote' ? 'https://github.com/acme/repo.git' : actualHead;
    const endpoint = args.at(-1);
    const pull = endpoint.match(/\/pulls\/(\d+)$/);
    if (pull) return JSON.stringify({ number: Number(pull[1]), html_url: `https://github.com/acme/repo/pull/${pull[1]}`, state: 'open', draft: true, head: { sha: head, ref: 'feature', repo: { full_name: 'acme/repo' } }, base: { sha: 'b'.repeat(40), ref: 'main', repo: { full_name: 'acme/repo' } } });
    if (endpoint.includes('/check-runs')) return JSON.stringify([{ total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] }]);
    if (endpoint.includes('/status')) return JSON.stringify([{ total_count: 1, statuses: [{ state: 'success' }] }]);
    if (endpoint.includes('/reviews')) return JSON.stringify([[{ state: 'APPROVED', submitted_at: '2026-01-01T00:00:00Z', commit_id: head, user: { login: 'reviewer' } }]]);
    throw Error(`unexpected endpoint ${endpoint}`);
  };
  return { project, worktree, handlers, ctx, run, calls };
}
const call = () => ({ signal: new AbortController().signal });

test('explicit associate persists authoritative GitHub metadata and list stays offline', async t => {
  const f = fixture(t); const dispose = await registerPullRequests(f.ctx, { run: f.run }); t.after(dispose);
  const associated = await f.handlers.associate({ sessionID: 'session-1', taskID: 'task-1', number: 7 }, call());
  assert.equal(associated.pullRequest.draft, true);
  assert.equal(associated.pullRequest.checks, 'passed');
  assert.equal(associated.pullRequest.review, 'approved-unverified');
  assert.equal(associated.pullRequest.source, 'stale-source');
  assert.equal(associated.pullRequest.head, head);
  assert.equal(associated.pullRequest.headRef, 'feature');
  assert.equal(associated.pullRequest.base, 'b'.repeat(40));
  assert.equal(associated.pullRequest.baseRef, 'main');
  const before = f.calls.length;
  const listed = await f.handlers.list({ sessionID: 'session-1', taskID: 'task-1' }, call());
  assert.equal(listed.pullRequests[0].number, 7);
  assert.equal(f.calls.length, before, 'cached render/list does not call GitHub');
  writeFileSync(join(f.worktree, 'tracked'), 'changed');
  const stale = await f.handlers.list({ sessionID: 'session-1', taskID: 'task-1' }, call());
  assert.equal(stale.pullRequests[0].source, 'stale-source', 'local edits invalidate the cached source snapshot');
  const cache = JSON.parse(readFileSync(join(f.worktree, '.harness', 'pull-requests.json'), 'utf8'));
  assert.equal(cache.pullRequests[0].taskID, 'task-1');
  writeFileSync(join(f.worktree, '.harness', 'pull-requests.json'), JSON.stringify({ version: 1, pullRequests: [{ ...cache.pullRequests[0], taskID: 'other-task' }] }));
  await assert.rejects(f.handlers.list({ sessionID: 'session-1', taskID: 'task-1' }, call()), /foreign-task/);
});

test('same-HEAD tracked and untracked local edits keep PR source stale', async t => {
  for (const kind of ['tracked', 'untracked']) await t.test(kind, async t => {
    const f = fixture(t); const handlers = {};
    const localHead = git(f.worktree, 'rev-parse', 'HEAD');
    const run = async (command, args, cwd, signal) => {
      if (command === 'git') return f.run(command, args, cwd, signal);
      const endpoint = args.at(-1);
      const pull = endpoint.match(/\/pulls\/(\d+)$/);
      if (pull) return JSON.stringify({ number: Number(pull[1]), html_url: `https://github.com/acme/repo/pull/${pull[1]}`, state: 'open', draft: false, head: { sha: localHead, ref: 'main', repo: { full_name: 'acme/repo' } }, base: { sha: 'b'.repeat(40), ref: 'main', repo: { full_name: 'acme/repo' } } });
      if (endpoint.includes('/check-runs')) return JSON.stringify([{ total_count: 0, check_runs: [] }]);
      if (endpoint.includes('/status')) return JSON.stringify([{ total_count: 0, statuses: [] }]);
      if (endpoint.includes('/reviews')) return JSON.stringify([[]]);
      throw Error(`unexpected endpoint ${endpoint}`);
    };
    const dispose = await registerPullRequests({ ...f.ctx, rpc: { async register(_definition, methods) { Object.assign(handlers, methods); return { dispose() {} }; } } }, { run });
    try {
      if (kind === 'tracked') writeFileSync(join(f.worktree, 'tracked'), 'modified without committing');
      else writeFileSync(join(f.worktree, 'untracked-local-change'), 'not committed');
      const result = await handlers.associate({ sessionID: 'session-1', taskID: 'task-1', number: 7 }, call());
      assert.equal(result.pullRequest.head, localHead, 'fixture PR head exactly equals local HEAD');
      assert.equal(result.pullRequest.source, 'stale-source');
      const listed = await handlers.list({ sessionID: 'session-1', taskID: 'task-1' }, call());
      assert.equal(listed.pullRequests[0].source, 'stale-source');
    } finally { await dispose(); }
  });
});

test('rejects malformed GitHub metadata, inaccessible GitHub, and unassociated refreshes', async t => {
  const f = fixture(t); const dispose = await registerPullRequests(f.ctx, { run: async (command, args, cwd) => {
    if (command === 'git') return f.run(command, args, cwd);
    return '{malformed';
  } }); t.after(dispose);
  await assert.rejects(f.handlers.associate({ sessionID: 'session-1', taskID: 'task-1', number: 7 }, call()), /JSON|malformed/);
  await assert.rejects(f.handlers.refresh({ sessionID: 'session-1', taskID: 'task-1', number: 7 }, call()), /not associated/);
  const inaccessibleHandlers = {};
  const inaccessible = await registerPullRequests({ ...f.ctx, rpc: { async register(_definition, methods) { Object.assign(inaccessibleHandlers, methods); return { dispose() {} }; } } }, { run: async (command, args, cwd) => command === 'git' ? f.run(command, args, cwd) : Promise.reject(Error('gh unavailable')) });
  try { await assert.rejects(inaccessibleHandlers.associate({ sessionID: 'session-1', taskID: 'task-1', number: 7 }, call()), /gh unavailable/); }
  finally { await inaccessible(); }
});

test('rejects cross-task, foreign-session, and unavailable session ownership', async t => {
  const f = fixture(t); const dispose = await registerPullRequests(f.ctx, { run: f.run }); t.after(dispose);
  await assert.rejects(f.handlers.list({ sessionID: 'session-1', taskID: 'other-task' }, call()), /not owned/);
  await assert.rejects(f.handlers.list({ sessionID: 'foreign-session', taskID: 'task-1' }, call()), /not owned/);
  const sessionGet = f.ctx.session.get;
  f.ctx.session.get = async () => { throw Error('session unavailable'); };
  await assert.rejects(f.handlers.list({ sessionID: 'session-1', taskID: 'task-1' }, call()), /session unavailable/);
  f.ctx.session.get = sessionGet;
});

test('head-bound reviews keep current changes requests blocking and incomplete checks partial', async t => {
  const f = fixture(t); const handlers = {};
  const run = async (command, args, cwd) => {
    if (command === 'git') return f.run(command, args, cwd);
    const endpoint = args.at(-1);
    if (endpoint.endsWith('/pulls/7')) return f.run(command, args, cwd);
    if (endpoint.includes('/check-runs')) return JSON.stringify([{ total_count: 1, check_runs: [] }]);
    if (endpoint.includes('/status')) return JSON.stringify([{ total_count: 1, statuses: [{ state: 'success' }] }]);
    if (endpoint.includes('/reviews')) return JSON.stringify([[{ state: 'APPROVED', submitted_at: '2026-01-01', commit_id: 'c'.repeat(40), user: { login: 'reviewer-a' } }, { state: 'APPROVED', submitted_at: '2026-01-02', commit_id: head, user: { login: 'reviewer-a' } }, { state: 'CHANGES_REQUESTED', submitted_at: '2026-01-03', commit_id: head, user: { login: 'reviewer-b' } }]]);
    throw Error(`unexpected endpoint ${endpoint}`);
  };
  const dispose = await registerPullRequests({ ...f.ctx, rpc: { async register(_definition, methods) { Object.assign(handlers, methods); return { dispose() {} }; } } }, { run });
  try {
    const result = await handlers.associate({ sessionID: 'session-1', taskID: 'task-1', number: 7 }, call());
    assert.equal(result.pullRequest.review, 'changes-requested');
    assert.equal(result.pullRequest.checks, 'partial');
  } finally { await dispose(); }
});

test('rejects a symlinked PR cache instead of reading outside the task worktree', async t => {
  const f = fixture(t); const dispose = await registerPullRequests(f.ctx, { run: f.run }); t.after(dispose);
  const harness = join(f.worktree, '.harness'); mkdirSync(harness);
  const outside = join(f.project, 'foreign-pr-cache.json');
  writeFileSync(outside, JSON.stringify({ version: 1, pullRequests: [] }));
  symlinkSync(outside, join(harness, 'pull-requests.json'));
  await assert.rejects(f.handlers.list({ sessionID: 'session-1', taskID: 'task-1' }, call()), /symbolic link/);
});

test('propagates request cancellation into GitHub reads and stops between endpoints', async t => {
  const f = fixture(t); const handlers = {}; const controller = new AbortController(); let ghSignal;
  const run = async (command, args, cwd, signal) => {
    if (command === 'git') return f.run(command, args, cwd);
    ghSignal = signal;
    controller.abort(new Error('cancelled by caller'));
    return f.run(command, args, cwd);
  };
  const dispose = await registerPullRequests({ ...f.ctx, rpc: { async register(_definition, methods) { Object.assign(handlers, methods); return { dispose() {} }; } } }, { run });
  try {
    await assert.rejects(handlers.associate({ sessionID: 'session-1', taskID: 'task-1', number: 7 }, { signal: controller.signal }), /cancelled by caller/);
    assert.equal(ghSignal, controller.signal);
  } finally { await dispose(); }
});

test('concurrent associations merge under the cross-process cache lock', async t => {
  const f = fixture(t); let pending = 0; let release;
  const bothPRs = new Promise(resolve => { release = resolve; });
  const run = async (command, args, cwd, signal) => {
    if (command === 'git') return f.run(command, args, cwd, signal);
    const endpoint = args.at(-1);
    const pull = endpoint.match(/\/pulls\/(\d+)$/);
    if (pull) {
      pending++;
      if (pending === 2) release();
      await bothPRs;
      return JSON.stringify({ number: Number(pull[1]), html_url: `https://github.com/acme/repo/pull/${pull[1]}`, state: 'open', draft: false, head: { sha: head, ref: 'feature', repo: { full_name: 'acme/repo' } }, base: { sha: 'b'.repeat(40), ref: 'main', repo: { full_name: 'acme/repo' } } });
    }
    return f.run(command, args, cwd, signal);
  };
  const dispose = await registerPullRequests({ ...f.ctx, rpc: { async register(_definition, methods) { Object.assign(f.handlers, methods); return { dispose() {} }; } } }, { run });
  try {
    await Promise.all([7, 8].map(number => f.handlers.associate({ sessionID: 'session-1', taskID: 'task-1', number }, call())));
    const listed = await f.handlers.list({ sessionID: 'session-1', taskID: 'task-1' }, call());
    assert.deepEqual(listed.pullRequests.map(pr => pr.number).sort(), [7, 8]);
  } finally { await dispose(); }
});

test('canceled lock wait does not mutate the cache', async t => {
  const f = fixture(t); const dispose = await registerPullRequests(f.ctx, { run: f.run }); t.after(dispose);
  const harness = join(f.worktree, '.harness'); mkdirSync(harness);
  writeFileSync(join(harness, 'pull-requests.lock'), 'held by another process');
  const controller = new AbortController();
  const pending = f.handlers.associate({ sessionID: 'session-1', taskID: 'task-1', number: 7 }, { signal: controller.signal });
  setTimeout(() => controller.abort(new Error('lock wait canceled')), 50);
  await assert.rejects(pending, /lock wait canceled/);
  assert.equal(readFileSync(join(harness, 'pull-requests.lock'), 'utf8'), 'held by another process');
  assert.equal(readFileSync(join(f.project, '.harness', 'opencode-tasks.json'), 'utf8').includes('task-1'), true);
  assert.equal((await f.handlers.list({ sessionID: 'session-1', taskID: 'task-1' }, call())).pullRequests.length, 0);
});

test('rejects oversized cache bytes and association counts', async t => {
  const f = fixture(t); const dispose = await registerPullRequests(f.ctx, { run: f.run }); t.after(dispose);
  const harness = join(f.worktree, '.harness'); mkdirSync(harness);
  const cache = join(harness, 'pull-requests.json');
  writeFileSync(cache, ' '.repeat(256 * 1024 + 1));
  await assert.rejects(f.handlers.list({ sessionID: 'session-1', taskID: 'task-1' }, call()), /256 KiB/);
  const invalidRecords = Array.from({ length: 101 }, (_, i) => ({ taskID: 'task-1', number: i + 1 }));
  writeFileSync(cache, JSON.stringify({ version: 1, pullRequests: invalidRecords }));
  await assert.rejects(f.handlers.list({ sessionID: 'session-1', taskID: 'task-1' }, call()), /100 association/);
});

test('allows GitHub fork heads but binds the PR base repository to task origin', async t => {
  const f = fixture(t); const handlers = {};
  const run = async (command, args, cwd, signal) => {
    if (command === 'git') return f.run(command, args, cwd, signal);
    const endpoint = args.at(-1);
    if (endpoint.endsWith('/pulls/7')) {
      const pr = JSON.parse(await f.run(command, args, cwd, signal));
      pr.head.repo.full_name = 'contributor/repo';
      return JSON.stringify(pr);
    }
    return f.run(command, args, cwd, signal);
  };
  const dispose = await registerPullRequests({ ...f.ctx, rpc: { async register(_definition, methods) { Object.assign(handlers, methods); return { dispose() {} }; } } }, { run });
  try {
    const result = await handlers.associate({ sessionID: 'session-1', taskID: 'task-1', number: 7 }, call());
    assert.equal(result.pullRequest.headRepository, 'contributor/repo');
  } finally { await dispose(); }
});

test('refresh is explicit, updates source metadata, and refuses wrong-repository PRs', async t => {
  const f = fixture(t); const dispose = await registerPullRequests(f.ctx, { run: f.run }); t.after(dispose);
  await f.handlers.associate({ sessionID: 'session-1', taskID: 'task-1', number: 7 }, call());
  let refreshed = 0;
  const run = async (command, args, cwd) => {
    if (command === 'git') return f.run(command, args, cwd);
    refreshed++;
    const value = JSON.parse(await f.run(command, args, cwd));
    if (args.at(-1).endsWith('/pulls/7')) value.head.sha = git(f.worktree, 'rev-parse', 'HEAD');
    return JSON.stringify(value);
  };
  const updateHandlers = {};
  const update = await registerPullRequests({ ...f.ctx, rpc: { async register(_definition, methods) { Object.assign(updateHandlers, methods); return { dispose() {} }; } } }, { run });
  try {
    const result = await updateHandlers.refresh({ sessionID: 'session-1', taskID: 'task-1' }, call());
    assert.equal(result.pullRequest.source, 'current');
    assert.equal(refreshed, 4);
  } finally { await update(); }
  const wrong = async (command, args, cwd) => {
    if (command === 'git') return f.run(command, args, cwd);
    const value = JSON.parse(await f.run(command, args, cwd));
    if (args.at(-1).endsWith('/pulls/7')) value.base.repo.full_name = 'other/repo';
    return JSON.stringify(value);
  };
  const badHandlers = {};
  const bad = await registerPullRequests({ ...f.ctx, rpc: { async register(_definition, methods) { Object.assign(badHandlers, methods); return { dispose() {} }; } } }, { run: wrong });
  try { await assert.rejects(badHandlers.refresh({ sessionID: 'session-1', taskID: 'task-1' }, call()), /base repository/); }
  finally { await bad(); }
});
