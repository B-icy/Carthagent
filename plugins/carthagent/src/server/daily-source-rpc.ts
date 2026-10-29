import type { Context } from '@opencode/plugin/promise/plugin';
import type { RpcCallContext } from '@opencode/plugin/promise/rpc';
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { checkDigest, evidenceFresh, fingerprint, requiresReview, reviewFresh, validatePlan } from '../../../../lib/delivery.mjs';
import { DailySource, type DailySourceReport } from '../daily-source-rpc';

type RecordValue = Record<string, unknown>;
type SourceContext = Pick<Context, 'location' | 'session' | 'worktree'>;
const MAX_FILE = 1024 * 1024;
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const record = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
const safeID = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const invalid = () => new Error('invalid_source');
const missing = (error: unknown) => record(error) && error.code === 'ENOENT';

/** Match native directory identities through ancestor aliases (macOS /var, /tmp),
 * never a linked directory leaf. Keep this local: importing pull-request-rpc's
 * equivalent helper would also import unrelated process/review integrations. */
function canonicalDirectory(path: string) {
  const absolute = resolve(path);
  if (!lstatSync(absolute).isDirectory()) throw invalid();
  return realpathSync(absolute);
}

/** Evidence paths use canonical native roots, then reject every linked component. */
function noLinks(path: string) {
  const absolute = resolve(path);
  let cursor = parse(absolute).root;
  for (const part of relative(cursor, absolute).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    if (lstatSync(cursor).isSymbolicLink()) throw invalid();
  }
}

/** No directory/FIFO/device reads, no unbounded reads, and no final-component links. */
function localJson(path: string, max = MAX_FILE): { value: unknown; raw: string } | null {
  try {
    noLinks(path);
    if (!lstatSync(path).isFile()) throw invalid();
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > max) throw invalid();
      const buffer = Buffer.alloc(max + 1);
      let length = 0;
      while (length < buffer.length) {
        const n = readSync(fd, buffer, length, buffer.length - length, null);
        if (!n) break;
        length += n;
      }
      if (length > max) throw invalid();
      const bytes = buffer.subarray(0, length);
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return { value: JSON.parse(raw), raw };
    } finally { closeSync(fd); }
  } catch (error) { if (missing(error)) return null; throw invalid(); }
}

function validateState(value: unknown, directory: string, runId: string) {
  if (!record(value) || value.runId !== runId || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1 || !record(value.plan) || !Array.isArray(value.plan.checks) || value.plan.checks.length > 20000) throw invalid();
  if (value.status !== undefined && !['implementing', 'verifying', 'verified', 'blocked'].includes(value.status as string)) throw invalid();
  validatePlan(value.plan, directory);
  const checks = value.plan.checks as Array<RecordValue & { id: string }>;
  if (value.evidence !== undefined && !record(value.evidence)) throw invalid();
  const evidence = (value.evidence ?? {}) as Record<string, RecordValue>;
  const ids = new Set(checks.map(check => check.id));
  if (Object.keys(evidence).some(id => !ids.has(id))) throw invalid();
  for (const receipt of Object.values(evidence)) {
    // A real failed native receipt can have a null fingerprint after scope failure.
    if (!record(receipt) || typeof receipt.passed !== 'boolean' || receipt.fingerprint !== undefined && receipt.fingerprint !== null && !hash(receipt.fingerprint)) throw invalid();
    for (const key of ['runId', 'checkDigest', 'outputTail']) if (receipt[key] !== undefined && typeof receipt[key] !== 'string') throw invalid();
    for (const key of ['revision', 'executedRevision', 'code']) if (receipt[key] !== undefined && !Number.isSafeInteger(receipt[key])) throw invalid();
    for (const key of ['timedOut', 'cancelled', 'changedDuringCheck', 'outputLimit']) if (receipt[key] !== undefined && typeof receipt[key] !== 'boolean') throw invalid();
    if (receipt.durationMs !== undefined && (typeof receipt.durationMs !== 'number' || !Number.isFinite(receipt.durationMs) || receipt.durationMs < 0)) throw invalid();
  }
  if (value.reviewEvidence !== undefined && !record(value.reviewEvidence)) throw invalid();
  if (value.handoff !== undefined && !record(value.handoff)) throw invalid();
  if (value.reviewFindings !== undefined && (!Array.isArray(value.reviewFindings) || value.reviewFindings.length > 20000)) throw invalid();
  const findings = (value.reviewFindings ?? []) as RecordValue[];
  const findingIDs = new Set<string>();
  for (const finding of findings) {
    if (!record(finding) || !safeID(finding.id) || findingIDs.has(finding.id) || typeof finding.description !== 'string') throw invalid();
    findingIDs.add(finding.id);
    if (finding.resolution !== undefined && (!record(finding.resolution) || finding.resolution.id !== finding.id || typeof finding.resolution.change !== 'string' || finding.resolution.evidence !== undefined && typeof finding.resolution.evidence !== 'string')) throw invalid();
  }
  return { state: value, checks, evidence, findings };
}

function sourceFor(directory: string, sessionID: string): DailySourceReport | null {
  const pointerPath = join(directory, '.harness', 'active.json');
  const pointer = localJson(pointerPath, 4096);
  if (!pointer) return null;
  if (!record(pointer.value) || pointer.value.version !== 1 || typeof pointer.value.path !== 'string' || isAbsolute(pointer.value.path)) throw invalid();
  // Same exact active-session/run strategy as workspace-rpc.reportFor; never latestReport.
  const parts = pointer.value.path.split(sep);
  if (parts.length !== 4 || parts[0] !== '.harness' || !safeID(parts[1]) || !safeID(parts[2]) || parts[3] !== 'report.json') throw invalid();
  if (parts[1] !== sessionID) return null;
  const path = join(directory, ...parts);
  const file = localJson(path);
  if (!file) return null;
  const { state, checks, evidence, findings } = validateState(file.value, directory, parts[2]);
  const current = fingerprint(directory, ['.']);
  if (!hash(current)) throw invalid();
  let truncated = checks.length > 12 || findings.length > 5;
  // Omit an entire oversized claim instead of presenting a misleading partial sentence.
  // Byte bounds are stricter than the schema's character bounds and preserve UTF-8.
  const text = (value: unknown, limit: number) => {
    if (typeof value !== 'string') return '';
    if (Buffer.byteLength(value, 'utf8') > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\p{Cs}]/u.test(value)) { truncated = true; return ''; }
    return value;
  };
  const isFresh = (check: RecordValue & { id: string }) => {
    const receipt = evidence[check.id];
    return evidenceFresh(check, receipt, current, state) && receipt?.code === 0 && !receipt.timedOut && !receipt.cancelled && !receipt.changedDuringCheck && !receipt.outputLimit;
  };
  const isCurrentFailure = (check: RecordValue & { id: string }) => {
    const receipt = evidence[check.id];
    // A failed receipt is not evidence of failure at the current source revision
    // unless both its identity and actual execution outcome are bound to it.
    return receipt?.passed === false && receipt.runId === state.runId && receipt.revision === state.revision &&
      receipt.checkDigest === checkDigest(check) && receipt.fingerprint === current && !receipt.changedDuringCheck &&
      (Number.isSafeInteger(receipt.code) && receipt.code !== 0 || receipt.timedOut === true || receipt.cancelled === true || receipt.outputLimit === true);
  };
  const stale = checks.some(check => {
    const receipt = evidence[check.id];
    return receipt && (receipt.runId !== state.runId || receipt.revision !== state.revision || receipt.checkDigest !== checkDigest(check) || receipt.fingerprint !== current || receipt.passed && !isFresh(check));
  }) || requiresReview(state) && !reviewFresh(state, current) || record(state.handoff) && state.handoff.fingerprint !== current;
  const result: DailySourceReport = {
    runId: parts[2], revision: current, planRevision: state.revision as number,
    freshness: stale ? 'stale' : 'current', goal: text((state.plan as RecordValue).goal, 1024),
    // Native delivery_finish stores review/launch/limitations, not a change summary.
    // Do not manufacture a change claim from those fields or from the goal.
    change: '',
    checks: checks.slice(0, 12).map(check => {
      const receipt = evidence[check.id];
      const fresh = Boolean(isFresh(check));
      const failed = isCurrentFailure(check);
      // Omit unbound failure output rather than making old/scope-error text look
      // like an execution result for the current revision in the outbound DTO.
      const output = receipt?.passed === false && !failed ? undefined : receipt?.outputTail;
      return { id: check.id, before: 'not_run', after: fresh ? 'passed' : failed ? 'failed' : 'not_run', revision: current, result: text(output, 1024) };
    }),
    findings: findings.slice(0, 5).map(finding => {
      const resolution = record(finding.resolution) ? finding.resolution : {};
      return { id: finding.id as string, issue: text(finding.description, 768), evidence: text(resolution.evidence, 1536), resolution: text(resolution.change, 1024) };
    }),
    truncated: false,
  };
  result.truncated = truncated;
  // Reject a concurrent active-run/report replacement rather than mixing snapshots.
  if (localJson(pointerPath, 4096)?.raw !== pointer.raw || localJson(path)?.raw !== file.raw) throw invalid();
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 64 * 1024) throw invalid();
  return result;
}

/** No storage writes, transcript/capture/log imports, credential lookup, or cloud client. */
export function createDailySourceRpcHandlers(ctx: SourceContext) {
  return {
    report: async (input: unknown, call: RpcCallContext<typeof DailySource.methods.report>) => {
      call.signal.throwIfAborted();
      if (!record(input) || !safeID(input.sessionID) || Object.keys(input).some(key => key !== 'sessionID')) return call.error('dailySourceError', 'invalid_request', { code: 'invalid_request' });
      try {
        const root = canonicalDirectory(ctx.location.project.canonical);
        const location = canonicalDirectory(ctx.location.directory);
        const session = await ctx.session.get({ sessionID: input.sessionID }, { signal: call.signal });
        if (session.id !== input.sessionID || session.projectID !== ctx.location.project.id || !isAbsolute(session.location.directory)) throw new Error('not_owned');
        const directory = canonicalDirectory(session.location.directory);
        // Ownership mirrors workspace-rpc. Durable task records alone cannot authorize
        // a forged worktree: also require the native project's authoritative inventory.
        const journal = localJson(join(root, '.harness', 'opencode-tasks.json'))?.value;
        if (journal !== undefined && (!record(journal) || journal.version !== 1 || !Array.isArray(journal.tasks) || !Array.isArray(journal.operations))) throw invalid();
        const tasks = record(journal) ? journal.tasks as unknown[] : [];
        const operations = record(journal) ? journal.operations as unknown[] : [];
        const owned = [...tasks, ...operations].find(item => record(item) && item.sessionID === session.id && typeof item.worktree === 'string');
        const expected = record(owned) && typeof owned.worktree === 'string' ? canonicalDirectory(owned.worktree) : location;
        if (directory !== expected) throw new Error('not_owned');
        if (directory !== root && directory !== location) {
          const native = await ctx.worktree.list({ projectID: ctx.location.project.id }, { signal: call.signal });
          if (!native.some(entry => canonicalDirectory(entry.directory) === directory)) throw new Error('not_owned');
        }
        noLinks(directory);
        call.signal.throwIfAborted();
        return { source: sourceFor(directory, session.id) };
      } catch (error) {
        if (call.signal.aborted) throw error;
        const code = error instanceof Error && error.message === 'not_owned' ? 'not_owned' : 'invalid_source';
        return call.error('dailySourceError', code, { code });
      }
    },
  };
}

/** Parent-owned composition chooses when to register this local-only boundary. */
export async function registerDailySourceRpc(ctx: Context) {
  return ctx.rpc.register(DailySource, createDailySourceRpcHandlers(ctx));
}
