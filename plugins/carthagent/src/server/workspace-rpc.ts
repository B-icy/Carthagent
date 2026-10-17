import type { Context } from '@opencode/plugin/promise/plugin';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { completionIssues, evidenceFresh, fingerprint, reviewFresh, requiresReview, validatePlan } from '../../../../lib/delivery.mjs';
import { planningView } from '../../../../lib/planning-view.mjs';
import { planningStatus } from '../../../../lib/planning.mjs';
import { localReviewSnapshot, startReview } from '../../../../lib/opencode/review.mjs';
import { createTask, listTasks } from '../../../../lib/opencode/workspace.mjs';
import { assertActiveReport, activeReportPath } from '../../../../lib/workspace.mjs';
import { Workspace, type WorkspaceSnapshot } from '../workspace-rpc';

type TaskRecord = { id: string; task: string; sessionID: string; worktree: string; status: string; branch?: string };
type OperationRecord = { id: string; task: string; sessionID?: string; worktree?: string; status: string; branch?: string };
type TaskState = { tasks: TaskRecord[]; operations: OperationRecord[] };
type NativeSession = Awaited<ReturnType<Context['session']['get']>>;
type JsonRecord = Record<string, unknown>;
type DeliveryCheck = JsonRecord & { id: string; kind?: string; argv?: string[] };
type DeliveryStep = string | (JsonRecord & { id: string; title: string; dependsOn: string[]; checks: string[] });
type DeliveryAcceptance = JsonRecord & { requirement: string; checks: string[] };
type DeliveryPlan = JsonRecord & {
  goal: string; artifacts: string[]; outputs?: string[]; assumptions?: string[]; steps: DeliveryStep[];
  acceptance: DeliveryAcceptance[]; checks: DeliveryCheck[]; design?: JsonRecord; verification?: string;
};
type DeliveryState = { runId: string; revision: number; status?: string; plan: DeliveryPlan; evidence?: Record<string, JsonRecord>; stepStatus?: Record<string, string> };

const MAX_TEXT = 4000;
const boundedText = (value: unknown, max = MAX_TEXT) => typeof value === 'string' ? value.slice(0, max) : '';
const asRecord = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const boundedList = <T>(value: unknown, max: number, project: (item: unknown, index: number) => T): T[] => Array.isArray(value) ? value.slice(0, max).map(project) : [];
const listLength = (value: unknown) => Array.isArray(value) ? value.length : 0;

function reportFor(directory: string, sessionID: string) {
  try {
    const path = activeReportPath(directory);
    if (!path || !existsSync(path)) return { status: 'unavailable' } as const;
    const reportRelative = relative(directory, path).split(sep);
    if (reportRelative.length !== 4 || reportRelative[0] !== '.harness' || reportRelative[1] !== sessionID || reportRelative[3] !== 'report.json') return { status: 'unavailable' } as const;
    let cursor = resolve(directory);
    for (const part of reportRelative) {
      cursor = join(cursor, part);
      const info = lstatSync(cursor);
      if (info.isSymbolicLink()) return { status: 'invalid' } as const;
    }
    if (!lstatSync(path).isFile()) return { status: 'invalid' } as const;
    if (statSync(path).size > 1024 * 1024) return { status: 'invalid' } as const;
    const state = JSON.parse(readFileSync(path, 'utf8')) as DeliveryState;
    if (!state || typeof state !== 'object' || !state.plan || typeof state.runId !== 'string' || !state.runId || state.runId.length > 128 || reportRelative[2] !== state.runId || !Number.isSafeInteger(state.revision) || state.revision < 1 || !Array.isArray(state.plan.checks)) return { status: 'invalid' } as const;
    if (state.status !== undefined && !['implementing', 'verifying', 'verified', 'blocked'].includes(state.status)) return { status: 'invalid' } as const;
    if (state.evidence !== undefined && (!state.evidence || typeof state.evidence !== 'object' || Array.isArray(state.evidence) || Object.keys(state.evidence).length > 20000)) return { status: 'invalid' } as const;
    validatePlan(state.plan, directory);
    if (Object.keys(state.evidence ?? {}).some(id => !state.plan.checks?.some(check => check.id === id))) return { status: 'invalid' } as const;
    for (const check of state.plan.checks) {
      const receipt = state.evidence?.[check.id];
      if (receipt && (typeof receipt.passed !== 'boolean' || typeof receipt.fingerprint !== 'string' || receipt.runId !== undefined && typeof receipt.runId !== 'string' || receipt.revision !== undefined && !Number.isSafeInteger(receipt.revision) || receipt.checkDigest !== undefined && typeof receipt.checkDigest !== 'string' || receipt.code !== undefined && !Number.isSafeInteger(receipt.code) || receipt.durationMs !== undefined && !Number.isFinite(receipt.durationMs))) return { status: 'invalid' } as const;
    }
    assertActiveReport(directory, path);
    const current = fingerprint(directory, ['.']);
    if (!/^[a-f0-9]{64}$/.test(current)) return { status: 'invalid' } as const;
    const view = planningView(state, current);
    const workflowView = view.workflow as { authored?: boolean; semantics?: string; nodes?: JsonRecord[]; edges?: JsonRecord[] } | null;
    const allEvidence = state.plan.checks.map(raw => {
      const check = asRecord(raw) as DeliveryCheck;
      const receipt = state.evidence?.[check.id];
      const fresh = evidenceFresh(check, receipt, current, state);
      const status = !receipt ? 'pending' : !receipt.passed ? 'failed' : fresh ? 'fresh' : 'stale';
      const filename = typeof receipt?.logPath === 'string' && !receipt.logPath.split(/[\\/]/).includes('..') ? basename(receipt.logPath) : undefined;
      return {
        id: boundedText(check.id, 80), status,
        ...(Number.isSafeInteger(receipt?.executedRevision) ? { executedRevision: receipt?.executedRevision as number } : {}),
        ...(Number.isSafeInteger(receipt?.code) ? { code: receipt?.code as number } : {}),
        ...(filename ? { filename: boundedText(filename, 160) } : {}),
      };
    });
    const evidence = allEvidence.slice(0, 100);
    const plan = {
      goal: boundedText(state.plan.goal), verification: boundedText(state.plan.verification ?? 'required', 32),
      acceptance: boundedList(state.plan.acceptance, 80, raw => { const item = asRecord(raw); return { requirement: boundedText(item.requirement), checks: boundedList(item.checks, 100, id => boundedText(id, 80)) }; }),
      artifacts: boundedList(state.plan.artifacts, 40, item => boundedText(item, 240)),
      outputs: boundedList(state.plan.outputs, 40, item => boundedText(item, 240)),
      assumptions: boundedList(state.plan.assumptions, 40, item => boundedText(item)),
      checks: boundedList(state.plan.checks, 100, raw => { const check = asRecord(raw); return { id: boundedText(check.id, 80), kind: boundedText(check.kind, 32), argv: boundedList(check.argv, 32, item => boundedText(item, 1000)), timeoutSeconds: Number.isSafeInteger(check.timeoutSeconds) ? check.timeoutSeconds as number : 0 }; }),
      steps: boundedList(state.plan.steps, 40, (raw, index) => { const step = asRecord(raw); return {
        id: boundedText(typeof raw === 'string' ? `legacy_${index + 1}` : step.id, 80),
        title: boundedText(typeof raw === 'string' ? raw : step.title),
        status: boundedText(state.stepStatus?.[`step${index}`] ?? 'pending', 32),
        dependsOn: boundedList(typeof raw === 'string' ? [] : step.dependsOn, 40, item => boundedText(item, 80)),
        checks: boundedList(typeof raw === 'string' ? [] : step.checks, 100, item => boundedText(item, 80)),
      }; }),
      scenarios: boundedList(asRecord(state.plan.design).scenarios, 80, raw => { const scenario = asRecord(raw); return { id: boundedText(scenario.id, 80), requirement: boundedText(scenario.requirement), kind: boundedText(scenario.kind, 32), path: boundedList(scenario.path, 40, item => boundedText(item, 80)), checks: boundedList(scenario.checks, 100, item => boundedText(item, 80)), input: boundedText(scenario.input), expected: boundedText(scenario.expected), assertion: boundedText(scenario.assertion) }; }),
      risks: boundedList(asRecord(state.plan.design).risks, 80, raw => { const risk = asRecord(raw); return { id: boundedText(risk.id, 80), description: boundedText(risk.description), status: boundedText(risk.status, 32), blocking: risk.blocking === true, evidence: boundedText(risk.evidence) }; }),
    };
    const workflow = {
      authored: workflowView?.authored === true,
      semantics: boundedText(workflowView?.semantics, 1000),
      nodes: boundedList(workflowView?.nodes, 100, raw => { const node = asRecord(raw); return {
        id: boundedText(node.id, 80), title: boundedText(node.title), type: boundedText(node.type, 32), status: boundedText(node.status, 32),
        ...(typeof node.step === 'string' ? { step: boundedText(node.step, 80) } : {}),
        requirements: boundedList(node.requirements, 80, item => boundedText(item)), components: boundedList(node.components, 80, item => boundedText(item, 80)),
        checks: boundedList(node.checks, 100, item => boundedText(item, 80)), inputs: boundedList(node.inputs, 80, item => boundedText(item)),
        artifacts: boundedList(node.artifacts, 80, item => boundedText(item, 240)), effects: boundedList(node.effects, 10, item => boundedText(item, 32)),
        ...(typeof node.condition === 'string' ? { condition: boundedText(node.condition) } : {}),
      }; }),
      edges: boundedList(workflowView?.edges, 200, raw => { const edge = asRecord(raw); return {
        from: boundedText(edge.from, 80), to: boundedText(edge.to, 80), kind: boundedText(edge.kind, 32),
        ...(typeof edge.label === 'string' ? { label: boundedText(edge.label) } : {}),
        ...(typeof edge.when === 'string' ? { when: boundedText(edge.when) } : {}),
        ...(typeof edge.stop === 'string' ? { stop: boundedText(edge.stop) } : {}),
        ...(Number.isSafeInteger(edge.maxAttempts) ? { maxAttempts: edge.maxAttempts as number } : {}),
      }; }),
    };
    const architecture = {
      nodes: boundedList(view.architecture?.nodes, 80, raw => { const node = asRecord(raw); return { id: boundedText(node.id, 80), title: boundedText(node.title), layer: boundedText(node.layer, 32), excludes: boundedList(node.excludes, 30, item => boundedText(item)), requirements: boundedList(node.requirements, 80, item => boundedText(item)) }; }),
      edges: boundedList(view.architecture?.edges, 200, raw => { const edge = asRecord(raw); return { from: boundedText(edge.from, 80), to: boundedText(edge.to, 80), kind: boundedText(edge.kind, 32) }; }),
      ports: boundedList(view.architecture?.ports, 80, raw => { const port = asRecord(raw); return { id: boundedText(port.id, 80), owner: boundedText(port.owner, 80), adapter: boundedText(port.adapter, 80), compositionRoot: boundedText(port.compositionRoot, 80), input: boundedText(port.input), output: boundedText(port.output), errors: boundedText(port.errors), injection: boundedText(port.injection), testDouble: boundedText(port.testDouble), integrationAssertion: boundedText(port.integrationAssertion) }; }),
    };
    const gate = planningStatus(state, current);
    const issues = completionIssues(state, directory, current);
    const reviewRequired = requiresReview(state);
    const reviewIsFresh = !reviewRequired || reviewFresh(state, current);
    const isStale = allEvidence.some(item => item.status === 'stale') || reviewRequired && !reviewIsFresh;
    const planningViewLocked = view.gate.locked;
    const noCompletionIssues = !Object.values(issues).some(value => Array.isArray(value) && value.length > 0);
    const allChecksFresh = allEvidence.length > 0 && allEvidence.every(item => item.status === 'fresh');
    const ready = !planningViewLocked && noCompletionIssues && reviewIsFresh && allChecksFresh;
    const complete = ready && (state.plan.verification ?? 'required') === 'required';
    const status = state.status === 'blocked' ? 'blocked' : state.status === 'verified' && complete ? 'verified' : isStale ? 'stale' : state.status === 'verifying' ? 'verifying' : 'implementing';
    const truncation = {
      checks: { returned: evidence.length, total: allEvidence.length },
      acceptance: { returned: plan.acceptance.length, total: state.plan.acceptance.length },
      steps: { returned: plan.steps.length, total: state.plan.steps.length },
      artifacts: { returned: plan.artifacts.length, total: state.plan.artifacts.length },
      outputs: { returned: plan.outputs.length, total: state.plan.outputs?.length ?? 0 },
      assumptions: { returned: plan.assumptions.length, total: state.plan.assumptions?.length ?? 0 },
      scenarios: { returned: plan.scenarios.length, total: listLength(asRecord(state.plan.design).scenarios) },
      risks: { returned: plan.risks.length, total: listLength(asRecord(state.plan.design).risks) },
      workflowNodes: { returned: workflow.nodes.length, total: workflowView?.nodes?.length ?? 0 },
      workflowEdges: { returned: workflow.edges.length, total: workflowView?.edges?.length ?? 0 },
      architectureNodes: { returned: architecture.nodes.length, total: view.architecture?.nodes?.length ?? 0 },
      architectureEdges: { returned: architecture.edges.length, total: view.architecture?.edges?.length ?? 0 },
      architecturePorts: { returned: architecture.ports.length, total: view.architecture?.ports?.length ?? 0 },
    };
    const result = { status, freshness: isStale ? 'stale' : 'current', completion: ready ? 'ready' : 'incomplete', gate: gate.locked ? 'locked' : 'open', runId: state.runId, revision: state.revision, fingerprint: current, plan, workflow, architecture, evidence, truncation };
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 64 * 1024) return { status: 'invalid' } as const;
    return result;
  } catch {
    return { status: 'invalid' } as const;
  }
}
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
      const task = records().tasks.find(record => record.sessionID === session.id);
      const operation = records().operations.find(record => record.sessionID === session.id);
      const expectedDirectory = task?.worktree ?? operation?.worktree ?? locationDirectory;
      if (directory !== resolve(expectedDirectory)) throw new Error('Delivery report is not owned by this session');
      return reportFor(directory, session.id);
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
