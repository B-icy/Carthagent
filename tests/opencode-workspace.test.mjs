import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTask, listTasks, reconcileTasks } from '../lib/opencode/workspace.mjs';
import { listLegacyArchive, searchLegacyArchive, readLegacyTranscript, exportLegacyTranscript } from '../lib/opencode/archive.mjs';
import { createReviewSnapshot, startReview, verifyPullRequestHeads } from '../lib/opencode/review.mjs';

function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }

test('creates native worktree and explicit independent session; recovery is not blindly replayed', async t => {
  const root = mkdtempSync(join(tmpdir(), 'ctg-native ')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'); mkdirSync(repo); git(repo, 'init', '-q'); git(repo, 'config', 'user.email', 'test@example.invalid'); git(repo, 'config', 'user.name', 'Test');
  writeFileSync(join(repo, 'README.md'), 'initial\n'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'init');
  const worktrees = new Map();
  const ctx = {
    worktree: { async create(input) { assert.equal(input.projectID, 'project-id'); const directory = join(root, 'wt'); git(repo, 'worktree', 'add', '-qb', 'task-branch', directory); worktrees.set(directory, true); return { directory }; } },
    session: { async create(input) { assert.equal(input.location.directory, join(root, 'wt')); assert.equal(input.parentID, undefined); return { id: 'session-1' }; } },
  };
  const task = await createTask({ ctx, projectID: 'project-id', canonical: repo, task: 'Fix edge case' });
  assert.equal(task.sessionID, 'session-1'); assert.equal(listTasks({ canonical: repo })[0].worktree, join(root, 'wt'));
  assert.deepEqual(reconcileTasks({ canonical: repo, sessionIDs: [] }).tasks, [task]);
  const persisted = JSON.parse(readFileSync(join(repo, '.harness/opencode-tasks.json'), 'utf8'));
  assert.equal(persisted.operations[0].status, 'complete');
});

test('concurrent task creates remain distinct; partial native failure is journaled for manual recovery', async t => {
  const root = mkdtempSync(join(tmpdir(), 'ctg-race ')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'); mkdirSync(repo); git(repo, 'init', '-q');
  let next = 0;
  const ctx = {
    worktree: { async create() { const directory = join(root, `wt-${++next}`); mkdirSync(directory); return { directory }; } },
    session: { async create({ location }) { if (location.directory.endsWith('wt-2')) throw Error('simulated host failure'); return { id: `session-${next}` }; } },
  };
  const outcomes = await Promise.allSettled([
    createTask({ ctx, projectID: 'p', canonical: repo, task: 'one' }),
    createTask({ ctx, projectID: 'p', canonical: repo, task: 'two' }),
  ]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(item => item.status === 'rejected').length, 1);
  const state = listTasks({ canonical: repo, includeOperations: true });
  assert.equal(state.tasks.length, 1);
  assert.equal(state.operations.filter(item => item.status === 'recovery-required').length, 1);
  assert.equal(reconcileTasks({ canonical: repo, sessionIDs: [] }).tasks.length, 1);
});

test('legacy archive parses searchable records and preserves malformed line diagnostics without mutation', t => {
  const root = mkdtempSync(join(tmpdir(), 'pi archive ')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const transcript = join(root, 'legacy.jsonl'); writeFileSync(transcript, '{"type":"session","id":"old-1"}\n{"type":"message","message":{"role":"user","content":"needle in haystack"}}\nnot json\n');
  const listed = listLegacyArchive({ roots: [root] }); assert.equal(listed[0].id, 'old-1'); assert.equal(listed[0].malformedLines.length, 1);
  assert.equal(searchLegacyArchive({ roots: [root], query: 'needle' })[0].id, 'old-1');
  assert.equal(readLegacyTranscript({ path: transcript }).records.length, 2);
  assert.match(exportLegacyTranscript({ path: transcript, format: 'jsonl' }), /old-1/);
  assert.throws(() => readLegacyTranscript({ path: transcript, roots: [join(root, 'elsewhere')] }), /outside configured/);
  assert.throws(() => readLegacyTranscript({ path: join(root, 'missing.jsonl') }), /ENOENT/);
});

test('local review uses fresh location-scoped reviewer, rejects moved heads and keeps PR head checks exact', async t => {
  const root = mkdtempSync(join(tmpdir(), 'review repo ')); t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q'); git(root, 'config', 'user.email', 'test@example.invalid'); git(root, 'config', 'user.name', 'Test');
  writeFileSync(join(root, 'file.txt'), 'base\n'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'base');
  writeFileSync(join(root, 'file.txt'), 'changed\n');
  const ctx = { session: {
    async create(input) { assert.equal(input.location.directory, root); assert.equal(input.parentID, undefined); return { id: 'reviewer-1' }; },
    async prompt({ text }) { this.snapshot = text.match(/Snapshot SHA-256: ([a-f0-9]+)/)?.[1]; }, async wait() {}, async context() {
      const head = git(root, 'rev-parse', 'HEAD');
      return [{ parts: [{ type: 'text', text: `REVIEW_JSON: ${JSON.stringify({ version: 1, snapshot: this.snapshot, head, findings: [] })}\nVERDICT: APPROVE` }] }];
    },
  } };
  const review = await startReview({ ctx, cwd: root });
  assert.equal(review.type, 'local-delivery'); assert.equal(review.verdict, 'APPROVE');
  assert.deepEqual(verifyPullRequestHeads({ localHead: 'abc', remoteHead: 'abc', pullRequestHead: 'abc' }), { verifiedHead: 'abc' });
  assert.throws(() => verifyPullRequestHeads({ localHead: 'abc', remoteHead: 'def', pullRequestHead: 'abc' }), /mismatch/);
});

test('review fails closed when local source moves during reviewer work', async t => {
  const root = mkdtempSync(join(tmpdir(), 'review moved ')); t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q'); git(root, 'config', 'user.email', 'test@example.invalid'); git(root, 'config', 'user.name', 'Test');
  writeFileSync(join(root, 'file.txt'), 'base\n'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'base');
  writeFileSync(join(root, 'file.txt'), 'first edit\n');
  const ctx = { session: {
    async create() { return { id: 'reviewer-moved' }; },
    async prompt({ text }) { this.snapshot = text.match(/Snapshot SHA-256: ([a-f0-9]+)/)?.[1]; this.head = text.match(/HEAD: ([a-f0-9]+)/)?.[1]; }, async wait() {}, async context() {
      const head = this.head;
      writeFileSync(join(root, 'file.txt'), 'second edit\n');
      git(root, 'add', '.'); git(root, 'commit', '-qm', 'moved while reviewing');
      return [{ parts: [{ type: 'text', text: `REVIEW_JSON: ${JSON.stringify({ version: 1, snapshot: this.snapshot, head, findings: [] })}\nVERDICT: APPROVE` }] }];
    },
  } };
  await assert.rejects(startReview({ ctx, cwd: root }), /source or HEAD moved/);
});
