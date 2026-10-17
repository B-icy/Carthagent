import type { Context } from '@opencode/plugin/promise/plugin';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import { evidenceFresh, fingerprint } from '../../../../lib/delivery.mjs';
import { localReviewSnapshot, startReview } from '../../../../lib/opencode/review.mjs';
import { createTask, listTasks } from '../../../../lib/opencode/workspace.mjs';
import { assertActiveReport, activeReportPath } from '../../../../lib/workspace.mjs';
import { Workspace, type WorkspaceSnapshot } from '../workspace-rpc';

type TaskRecord = { id: string; task: string; sessionID: string; worktree: string; status: string; branch?: string };
type OperationRecord = { id: string; task: string; sessionID?: string; worktree?: string; status: string; branch?: string };
type TaskState = { tasks: TaskRecord[]; operations: OperationRecord[] };
type NativeSession = Awaited<ReturnType<Context['session']['get']>>;
type DeliveryCheck = { id: string } & Record<string, unknown>;
type DeliveryState = { runId: string; revision: number; status?: string; plan: { checks?: DeliveryCheck[] } & Record<string, unknown>; evidence?: Record<string, unknown> };
type ReviewModel = { providerID: string; id: string; variant?: string };

function configuredReviewModel(value: unknown): ReviewModel | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || !('providerID' in value) || typeof value.providerID !== 'string' || !value.providerID.trim() || !('id' in value) || typeof value.id !== 'string' || !value.id.trim()) {
    throw new Error('Invalid server reviewModel: providerID and id must be non-empty strings');
  }
  if ('variant' in value && value.variant !== undefined && (typeof value.variant !== 'string' || !value.variant.trim())) {
    throw new Error('Invalid server reviewModel: variant must be a non-empty string when provided');
  }
  return { providerID: value.providerID.trim(), id: value.id.trim(), ...('variant' in value && typeof value.variant === 'string' ? { variant: value.variant.trim() } : {}) };
}

function taskStatus(session?: NativeSession, running = false) {
  if (!session) return 'unavailable';
  if (running) return 'running';
  if (session.outcome === 'failed' || session.outcome === 'interrupted') return session.outcome;
  // A successful model turn does not complete the durable logical delivery task.
  return 'unknown';
}

function reportFor(directory: string, sessionID: string) {
  const path = activeReportPath(directory);
  if (!path || !existsSync(path)) return { status: 'unavailable' };
  const reportRelative = relative(directory, path).split(sep);
  if (reportRelative.length < 3 || reportRelative[0] !== '.harness' || reportRelative[1] !== sessionID) return { status: 'unavailable' };
  const state = JSON.parse(readFileSync(path, 'utf8')) as DeliveryState;
  if (!state || typeof state !== 'object' || !state.plan || !state.runId || !Number.isInteger(state.revision)) return { status: 'invalid' };
  assertActiveReport(directory, path);
  const current = fingerprint(directory, ['.']);
  const stale = (state.plan.checks ?? []).some(check => !evidenceFresh(check, state.evidence?.[check.id], current, state));
  return { status: stale ? 'stale' : state.status ?? 'active', runId: state.runId, revision: state.revision, fingerprint: current };
}

/** Register real native workspace operations. Durable task records identify sessions which
 * must be verified through the location-scoped native API; the TUI adds its full native list. */
export async function registerWorkspaceRpc(ctx: Context, options: {
  notify?: (summary: WorkspaceSnapshot) => void;
  reviewModel?: ReviewModel;
} = {}) {
  const reviewModel = configuredReviewModel(options.reviewModel);
  const root = resolve(ctx.location.project.canonical);
  const locationDirectory = resolve(ctx.location.directory);
  const projectID = ctx.location.project.id;
  let disposed = false;
  const events = new AbortController();
  const running = new Set<string>();
  const records = () => listTasks({ canonical: root, includeOperations: true }) as TaskState;
  const owns = async (sessionID: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const session = await ctx.session.get({ sessionID }, { signal });
    const taskState = records();
    const task = taskState.tasks.find(record => record.sessionID === sessionID);
    const directory = resolve(session.location.directory);
    const operation = taskState.operations.find(record => record.sessionID === sessionID);
    const ownedTask = task ?? (operation?.worktree ? operation as TaskRecord : undefined);
    if (session.projectID !== projectID || directory !== root && directory !== locationDirectory && (!ownedTask || resolve(ownedTask.worktree) !== directory)) throw new Error('Session belongs to another workspace location');
    return session;
  };

  const snapshot = async (requestedProjectID?: string, signal?: AbortSignal): Promise<WorkspaceSnapshot> => {
    if (requestedProjectID && requestedProjectID !== projectID) throw new Error('Project is outside this OpenCode workspace location');
    const taskState = records();
    const ids = [...new Set([...taskState.tasks.map(record => record.sessionID), ...taskState.operations.map(record => record.sessionID)].filter((id): id is string => typeof id === 'string'))];
    signal?.throwIfAborted();
    const sessions = await Promise.all(ids.map(async id => {
      try { return { id, session: await owns(id, signal), status: 'verified' as const }; } catch (error) {
        if (signal?.aborted) throw error;
        return { id, session: null, status: 'unavailable' as const };
      }
    }));
    const byID = new Map(sessions.filter(item => item.session).map(item => [item.id, item.session!]));
    const tasks: WorkspaceSnapshot['tasks'] = taskState.tasks.map(record => {
      const session = byID.get(record.sessionID);
      return {
        id: record.id, projectID, title: record.task, status: taskStatus(session, running.has(record.sessionID)),
        ...(!session || session.outcome === 'failed' || session.outcome === 'interrupted' ? { attention: true } : {}),
        directory: record.worktree, ...(record.branch ? { branch: record.branch } : {}),
      };
    });
    for (const op of taskState.operations) if (op.status !== 'complete' && op.status !== 'reconciled') {
      tasks.push({ id: op.id, projectID, title: op.task, status: op.status, attention: op.status === 'recovery-required', ...(op.worktree ? { directory: op.worktree } : {}), ...(op.branch ? { branch: op.branch } : {}) });
    }
    return {
      projects: [{ id: projectID, directory: root, name: basename(root) }], tasks,
      sessions: sessions.flatMap(item => {
        if (!item.session) return [{ id: item.id, title: 'Session unavailable', status: 'unavailable', directory: taskState.tasks.find(record => record.sessionID === item.id)?.worktree ?? locationDirectory }];
        const session = item.session;
        const task = taskState.tasks.find(record => record.sessionID === session.id);
        return {
          id: session.id, ...(task ? { taskID: task.id, projectID } : {}), title: session.title ?? 'Untitled session',
          status: running.has(session.id) ? 'running' : session.outcome ?? 'unknown', updatedAt: new Date(session.time.updated).toISOString(), directory: session.location.directory,
        };
      }),
    };
  };

  const registration = await ctx.rpc.register(Workspace, {
    snapshot: async (value, call) => { const input = value as { projectID?: string }; return snapshot(input.projectID, call.signal); },
    open: async (value, call) => {
      const input = value as { sessionID: string };
      const session = await owns(input.sessionID, call.signal);
      call.signal.throwIfAborted();
      await ctx.session.get({ sessionID: session.id }, { signal: call.signal });
      return { opened: true, directory: session.location.directory };
    },
    createWorktree: async (value, call) => {
      const input = value as { projectID: string; name: string };
      if (input.projectID !== projectID) throw new Error('Project is outside this OpenCode workspace location');
      call.signal.throwIfAborted();
      const result = await ctx.worktree.create({ projectID, name: input.name }, { signal: call.signal });
      return { directory: resolve(result.directory) };
    },
    createTask: async (value, call) => {
      const input = value as { task: string; branch?: string };
      call.signal.throwIfAborted();
      const record = await createTask({ ctx, canonical: root, projectID, task: input.task, branch: input.branch, signal: call.signal });
      await emitUpdated();
      return { taskID: record.id, sessionID: record.sessionID, directory: record.worktree };
    },
    delivery: async (value, call) => {
      const input = value as { sessionID: string };
      const session = await owns(input.sessionID, call.signal);
      const directory = resolve(session.location.directory);
      if (session.projectID !== projectID) throw new Error('Session belongs to another project');
      const path = activeReportPath(directory);
      if (!path || !existsSync(path)) return { status: 'unavailable' };
      const task = records().tasks.find(record => record.sessionID === session.id);
      const operation = records().operations.find(record => record.sessionID === session.id);
      const expectedDirectory = task?.worktree ?? operation?.worktree ?? locationDirectory;
      if (directory !== resolve(expectedDirectory)) throw new Error('Delivery report is not owned by this session');
      const reportRelative = relative(directory, path).split(sep);
      if (reportRelative.length < 3 || reportRelative[0] !== '.harness' || reportRelative[1] !== session.id) throw new Error('Active delivery report belongs to another session');
      const state = JSON.parse(readFileSync(path, 'utf8')) as DeliveryState;
      if (!state || !state.plan || !state.runId || !Number.isInteger(state.revision)) return { status: 'invalid' };
      assertActiveReport(directory, path);
      const current = fingerprint(directory, ['.']);
      const evidence = state.evidence ?? {};
      const stale = (state.plan.checks ?? []).some(check => !evidenceFresh(check, evidence[check.id], current, state));
      return { status: stale ? 'stale' : state.status ?? 'active', plan: state.plan, evidence };
    },
    review: async (value, call) => {
      const input = value as { sessionID: string };
      const session = await owns(input.sessionID, call.signal);
      const report = reportFor(session.location.directory, session.id);
      const receiptPath = resolve(session.location.directory, '.harness', 'reviews', `${createHash('sha256').update(`session:${session.id}`).digest('hex')}.json`);
      if (!existsSync(receiptPath)) return { status: report.status === 'stale' || report.status === 'invalid' ? report.status : 'unreviewed' };
      const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
      const current = localReviewSnapshot(session.location.directory);
      const valid = receipt?.version === 1 && receipt.identity === `session:${session.id}` && Array.isArray(receipt.history);
      if (!valid) return { status: 'invalid' };
      const fresh = receipt.snapshot === current.snapshot && receipt.head === current.head && ['approved', 'changes-requested'].includes(receipt.status);
      return { status: fresh ? receipt.status : 'stale', summary: fresh ? `${receipt.rounds} review round(s) · ${current.snapshot}` : 'Review source changed since this receipt' };
    },
    startReview: async (value, call) => {
      const input = value as { sessionID: string };
      const session = await owns(input.sessionID, call.signal);
      try {
        const result = await startReview({ ctx, cwd: session.location.directory, identity: `session:${session.id}`, model: reviewModel, signal: call.signal });
        return { status: result.verdict === 'APPROVE' ? 'approved' : 'changes-requested', summary: `${result.findings.findings.length} findings · ${result.snapshot}`, sessionID: result.reviewerSessionID };
      } catch (error) {
        if (call.signal.aborted) throw error;
        return call.error('reviewFailed', error instanceof Error ? error.message : String(error), { message: error instanceof Error ? error.message : String(error) });
      }
    },
  });

  const emitUpdated = async () => {
    if (!disposed) await registration.events.emit('updated', { revision: new Date().toISOString() });
  };
  const watcher = (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: events.signal })) {
        if (disposed) return;
        const detail = event as { type: string; location?: { directory: string }; data?: { sessionID?: string; status?: { type?: string } } };
        const sessionID = detail.data?.sessionID;
        let sessionDirectory: string | undefined;
        if (sessionID) {
          try {
            const session = await owns(sessionID);
            sessionDirectory = resolve(session.location.directory);
          } catch {
            const taskState = records();
            const task = taskState.tasks.find(record => record.sessionID === sessionID);
            const operation = taskState.operations.find(record => record.sessionID === sessionID);
            const recordedDirectory = task?.worktree ?? operation?.worktree;
            const eventDirectory = detail.location?.directory && resolve(detail.location.directory);
            if (recordedDirectory && detail.type === 'session.deleted') sessionDirectory = resolve(recordedDirectory);
            else if (eventDirectory && [root, locationDirectory, ...taskState.tasks.map(record => resolve(record.worktree)), ...taskState.operations.map(record => record.worktree ? resolve(record.worktree) : undefined).filter((directory): directory is string => Boolean(directory))].includes(eventDirectory)) sessionDirectory = eventDirectory;
            else continue;
          }
        }
        const taskDirectories = [...records().tasks.map(task => resolve(task.worktree)), ...records().operations.map(operation => operation.worktree && resolve(operation.worktree)).filter((directory): directory is string => Boolean(directory))];
        const relevantDirectories = new Set([root, locationDirectory, ...taskDirectories]);
        if (sessionDirectory && !relevantDirectories.has(sessionDirectory)) continue;
        if (!sessionID && detail.location?.directory && !relevantDirectories.has(resolve(detail.location.directory))) continue;
        if (!sessionID && !detail.location?.directory) continue;
        if (detail.type.startsWith('session.execution.') && sessionID) {
          if (detail.type === 'session.execution.started') running.add(sessionID);
          else if (['session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted'].includes(detail.type)) running.delete(sessionID);
        }
        if (detail.type === 'session.status' && sessionID && detail.data?.status?.type) {
          if (detail.data.status.type === 'busy' || detail.data.status.type === 'retry') running.add(sessionID);
          else running.delete(sessionID);
        }
        if (['session.updated', 'session.created', 'session.deleted', 'session.status', 'session.execution.started', 'session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted', 'worktree.updated'].includes(detail.type)) {
          try {
            const value = await snapshot();
            options.notify?.(value);
          } catch { /* Updates are invalidations; reads fail closed. */ }
          try { await emitUpdated(); } catch { /* A disconnected subscriber must not kill the native event stream. */ }
        }
      }
    } catch { /* Stream ends with host teardown; no polling or retry loop. */ }
  })();

  return async () => {
    disposed = true;
    events.abort();
    await registration.dispose();
    await watcher;
  };
}
