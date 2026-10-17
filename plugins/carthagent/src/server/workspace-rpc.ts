import type { Context } from '@opencode/plugin/promise/plugin';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { evidenceFresh, fingerprint } from '../../../../lib/delivery.mjs';
import { localReviewSnapshot, startReview } from '../../../../lib/opencode/review.mjs';
import { createTask, listTasks } from '../../../../lib/opencode/workspace.mjs';
import { assertActiveReport, activeReportPath } from '../../../../lib/workspace.mjs';
import { Workspace, type WorkspaceSnapshot } from '../workspace-rpc';

function taskStatus(record: Record<string, any>, session?: any) {
  if (session?.outcome === 'failed' || session?.outcome === 'interrupted') return session.outcome;
  return record.status ?? 'active';
}

function reportFor(directory: string) {
  const path = activeReportPath(directory);
  if (!path || !existsSync(path)) return { status: 'unavailable' };
  const state = JSON.parse(readFileSync(path, 'utf8'));
  if (!state || typeof state !== 'object' || !state.plan || !state.runId || !Number.isInteger(state.revision)) return { status: 'invalid' };
  assertActiveReport(directory, path);
  const current = fingerprint(directory, ['.']);
  const stale = (state.plan.checks ?? []).some((check: any) => !evidenceFresh(check, state.evidence?.[check.id], current, state));
  return { status: stale ? 'stale' : state.status ?? 'active', runId: state.runId, revision: state.revision, fingerprint: current };
}

/** Register real native workspace operations. Durable task records identify sessions which
 * must be verified through the location-scoped native API; the TUI adds its full native list. */
export function registerWorkspaceRpc(ctx: Context, options: {
  notify?: (summary: WorkspaceSnapshot) => void;
}) {
  const root = resolve(ctx.location.directory);
  const projectID = ctx.location.project.id;
  let disposed = false;
  const events = new AbortController();
  const records = () => listTasks({ canonical: root, includeOperations: true }) as { tasks: Array<Record<string, any>>; operations: Array<Record<string, any>> };
  const owns = async (sessionID: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const session = await ctx.session.get({ sessionID }, { signal });
    const taskState = records();
    const task = taskState.tasks.find(record => record.sessionID === sessionID);
    const directory = resolve(session.location.directory);
    const operation = taskState.operations.find(record => record.sessionID === sessionID);
    const ownedTask = task ?? operation;
    if (directory !== root && (!ownedTask || resolve(ownedTask.worktree) !== directory)) throw new Error('Session belongs to another workspace location');
    return session;
  };

  const snapshot = async (requestedProjectID?: string, signal?: AbortSignal): Promise<WorkspaceSnapshot> => {
    if (requestedProjectID && requestedProjectID !== projectID) throw new Error('Project is outside this OpenCode workspace location');
    const taskState = records();
    const ids = [...new Set([...taskState.tasks.map(record => record.sessionID), ...taskState.operations.map(record => record.sessionID)].filter((id): id is string => typeof id === 'string'))];
    signal?.throwIfAborted();
    const sessions = await Promise.all(ids.map(async id => {
      try { return await owns(id, signal); } catch (error) {
        if (signal?.aborted) throw error;
        return null;
      }
    }));
    const byID = new Map(sessions.filter(Boolean).map(session => [session!.id, session!]));
    const tasks = taskState.tasks.map(record => {
      const session = byID.get(record.sessionID);
      return {
        id: record.id, projectID, title: record.task, status: taskStatus(record, session),
        ...(record.status === 'active' ? { attention: session?.outcome === 'failed' || session?.outcome === 'interrupted' } : {}),
        directory: record.worktree, branch: record.branch,
      };
    });
    for (const op of taskState.operations) if (op.status !== 'complete' && op.status !== 'reconciled') {
      tasks.push({ id: op.id, projectID, title: op.task, status: op.status, attention: op.status === 'recovery-required', directory: op.worktree, branch: op.branch });
    }
    return {
      projects: [{ id: projectID, directory: root, name: basename(root) }], tasks,
      sessions: sessions.filter(Boolean).map(session => {
        const task = taskState.tasks.find(record => record.sessionID === session!.id);
        return {
          id: session!.id, ...(task ? { taskID: task.id, projectID } : {}), title: session!.title ?? 'Untitled session',
          status: session!.outcome ?? 'idle', updatedAt: new Date(session!.time.updated).toISOString(), directory: session!.location.directory,
        };
      }),
    };
  };

  const registration = ctx.rpc.register(Workspace, {
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
      return { taskID: record.id, sessionID: record.sessionID, directory: record.worktree };
    },
    delivery: async (value, call) => {
      const input = value as { sessionID: string };
      const session = await owns(input.sessionID, call.signal);
      const directory = resolve(session.location.directory);
      const path = activeReportPath(directory);
      if (!path || !existsSync(path)) return { status: 'unavailable' };
      const state = JSON.parse(readFileSync(path, 'utf8'));
      if (!state || !state.plan || !state.runId || !Number.isInteger(state.revision)) return { status: 'invalid' };
      assertActiveReport(directory, path);
      const current = fingerprint(directory, ['.']);
      const evidence = state.evidence ?? {};
      const stale = (state.plan.checks ?? []).some((check: any) => !evidenceFresh(check, evidence[check.id], current, state));
      return { status: stale ? 'stale' : state.status ?? 'active', plan: state.plan, evidence };
    },
    review: async (value, call) => {
      const input = value as { sessionID: string };
      const session = await owns(input.sessionID, call.signal);
      const report = reportFor(session.location.directory);
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
      const result = await startReview({ ctx, cwd: session.location.directory, identity: `session:${session.id}`, signal: call.signal });
      return { status: result.verdict === 'APPROVE' ? 'approved' : 'changes-requested', summary: `${result.findings.findings.length} findings · ${result.snapshot}`, sessionID: result.reviewerSessionID };
    },
  });

  const watcher = (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: events.signal })) {
        if (disposed) return;
        if (['session.updated', 'session.created', 'session.deleted', 'worktree.updated'].includes(event.type)) {
          try { options.notify?.(await snapshot()); } catch { /* Updates are invalidations; reads fail closed. */ }
        }
      }
    } catch { /* Stream ends with host teardown; no polling or retry loop. */ }
  })();

  return async () => {
    disposed = true;
    events.abort();
    const result = await registration;
    await result.dispose();
    await watcher;
  };
}
