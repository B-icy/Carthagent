import { mkdirSync, openSync, closeSync, unlinkSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson } from '../delivery.mjs';

/** @typedef {import('@opencode/plugin/promise/plugin').Context} OpenCodeContext */
/** @typedef {{ providerID: string, id: string, variant?: string }} ModelRef */
/** @typedef {{ version: 1, tasks: Array<Record<string, unknown>>, operations: Array<Record<string, any>> }} TaskState */
const statePath = root => join(root, '.harness', 'opencode-tasks.json');
const lockPath = root => join(root, '.harness', 'opencode-tasks.lock');
const activeOperations = new Set();

/** @param {unknown} value @returns {TaskState} */
function validState(value) {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('tasks' in value) || !Array.isArray(value.tasks) || !('operations' in value) || !Array.isArray(value.operations)) throw Error('Invalid CTG OpenCode workspace state');
  return /** @type {TaskState} */ (value);
}

/** @param {string} root @returns {TaskState} */
function readState(root) {
  try { return validState(JSON.parse(readFileSync(statePath(root), 'utf8'))); }
  catch (error) {
    if (error.code === 'ENOENT') return { version: 1, tasks: [], operations: [] };
    throw error;
  }
}

function locked(root, fn) {
  mkdirSync(join(root, '.harness'), { recursive: true });
  let fd;
  try { fd = openSync(lockPath(root), 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw Error('CTG task state is busy; retry after the current operation finishes'); throw error; }
  try { return fn(); } finally { closeSync(fd); unlinkSync(lockPath(root)); }
}

function persist(root, state) { atomicJson(statePath(root), state); }
function assertText(value, label) { if (typeof value !== 'string' || !value.trim()) throw Error(`${label} is required`); return value.trim(); }

/** Create a CTG task's isolated native worktree and an independent root session.
 * The logical parent relation is CTG metadata; no OpenCode child session is created. */
/** @param {{ ctx: OpenCodeContext, projectID: string, canonical: string, task: string, from?: string, branch?: string, model?: { providerID: string, id: string, variant?: string }, agent?: string, parentTaskID?: string | null, signal?: AbortSignal }} options */
export async function createTask({ ctx, projectID, canonical, task, from, branch, model, agent, parentTaskID = null, signal }) {
  signal?.throwIfAborted();
  const root = resolve(assertText(canonical, 'Canonical project directory'));
  const title = assertText(task, 'Task');
  const id = randomUUID();
  const operation = { id, kind: 'create-task', projectID: assertText(projectID, 'projectID'), status: 'pending', task: title, startedAt: new Date().toISOString() };
  locked(root, () => {
    const state = readState(root);
    if (parentTaskID && !state.tasks.some(record => record.id === parentTaskID)) throw Error(`Unknown parent task ${parentTaskID}`);
    operation.parentTaskID = parentTaskID;
    state.operations.push(operation); persist(root, state);
  });
  let worktree;
  let session;
  activeOperations.add(id);
  try {
     worktree = await ctx.worktree.create({ projectID: assertText(projectID, 'projectID'), name: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'task'}-${id.slice(0, 8)}`, ...(from ? { from } : {}), ...(branch ? { branch } : {}) }, { signal });
    locked(root, () => { const state = readState(root); state.operations = state.operations.map(op => op.id === id ? { ...op, worktree: resolve(worktree.directory), status: 'worktree-created' } : op); persist(root, state); });
    // Pass a location explicitly and omit parentID: native children inherit location.
     signal?.throwIfAborted();
     session = await ctx.session.create({ title, location: { directory: resolve(worktree.directory) }, ...(agent ? { agent } : {}), ...(model ? { model } : {}) }, { signal });
    locked(root, () => { const state = readState(root); state.operations = state.operations.map(op => op.id === id ? { ...op, sessionID: session.id, status: 'session-created' } : op); persist(root, state); });
    const record = { id, task: title, projectID, canonical: root, worktree: resolve(worktree.directory), sessionID: session.id, parentTaskID, status: 'active', createdAt: new Date().toISOString() };
    locked(root, () => { const state = readState(root); state.tasks.push(record); state.operations = state.operations.map(op => op.id === id ? { ...op, status: 'complete', worktree: record.worktree, sessionID: record.sessionID, finishedAt: new Date().toISOString() } : op); persist(root, state); });
    return record;
  } catch (error) {
    locked(root, () => { const state = readState(root); state.operations = state.operations.map(op => op.id === id ? { ...op, status: 'recovery-required', worktree: worktree?.directory, sessionID: session?.id, error: String(error.message || error), updatedAt: new Date().toISOString() } : op); persist(root, state); });
    throw error;
  } finally {
    activeOperations.delete(id);
  }
}

export function listTasks({ canonical, includeOperations = false }) {
  const root = resolve(assertText(canonical, 'Canonical project directory'));
  const state = readState(root);
  return includeOperations ? { tasks: state.tasks, operations: state.operations } : state.tasks;
}

/** @param {{ ctx: OpenCodeContext, canonical: string, projectID: string, limit?: number }} options */
export async function listNativeSessions({ ctx, canonical, projectID, limit = 100 }) {
  const directory = resolve(assertText(canonical, 'Canonical project directory'));
  const expectedProjectID = assertText(projectID, 'projectID');
  const records = [];
  let cursor;
  let pages = 0;
  do {
    const sessions = await ctx.session.list({ project: expectedProjectID, order: 'desc', limit: Math.min(100, Math.max(1, limit - records.length)), ...(cursor ? { cursor } : {}) });
    records.push(...sessions.data);
    cursor = sessions.cursor.next ?? undefined;
    pages++;
  } while (cursor && records.length < limit && pages < 100);
  return records.filter(session => session.projectID === expectedProjectID && !session.parentID);
}

/** @param {{ ctx: OpenCodeContext, canonical: string, projectID: string }} options */
export async function listNativeWorktrees({ ctx, canonical, projectID }) {
  const directory = resolve(assertText(canonical, 'Canonical project directory'));
  const expectedProjectID = assertText(projectID, 'projectID');
  const [nativeTrees, pluginTrees] = await Promise.all([
    ctx.worktree.list({ projectID: expectedProjectID }),
    ctx.worktree.list(directory),
  ]);
  const directories = [...nativeTrees.map(worktree => worktree.directory), ...pluginTrees.map(worktree => worktree.directory)];
  return [...new Set(directories.map(worktreeDirectory => resolve(worktreeDirectory)))].filter(worktreeDirectory => worktreeDirectory !== directory).map(worktreeDirectory => ({ directory: worktreeDirectory }));
}

/** Reconcile only provable operation outcomes. Never silently rerun an API create. */
/** @param {{ canonical: string, projectID: string, sessionIDs?: string[], worktreeDirectories?: string[] }} options */
export function reconcileTasks({ canonical, projectID, sessionIDs = [], worktreeDirectories = [] }) {
  const root = resolve(assertText(canonical, 'Canonical project directory'));
  const expectedProjectID = assertText(projectID, 'projectID');
  return locked(root, () => {
    const state = readState(root);
    const knownSessions = new Set(sessionIDs);
    const knownWorktrees = new Set(worktreeDirectories.map(directory => resolve(directory)));
    for (const op of state.operations) {
      if (op.projectID !== expectedProjectID) continue;
      if (activeOperations.has(op.id) || !['pending', 'worktree-created', 'session-created', 'recovery-required'].includes(op.status)) continue;
      if (op.worktree && op.sessionID && knownWorktrees.has(resolve(op.worktree)) && knownSessions.has(op.sessionID) && existsSync(op.worktree) && !state.tasks.some(task => task.id === op.id)) {
        state.tasks.push({ id: op.id, task: op.task, projectID: op.projectID, canonical: root, worktree: resolve(op.worktree), sessionID: op.sessionID, parentTaskID: op.parentTaskID ?? null, status: 'active', createdAt: op.startedAt, recoveredAt: new Date().toISOString() });
        op.status = 'reconciled';
      } else {
        op.status = 'recovery-required';
        op.error = 'Operation outcome is incomplete; inspect native worktree and session inventory before reconciliation';
      }
    }
    persist(root, state);
    return { tasks: state.tasks, operations: state.operations };
  });
}
