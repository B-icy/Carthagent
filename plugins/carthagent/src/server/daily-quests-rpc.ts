import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Context } from '@opencode/plugin/promise/plugin';
import { CloudClient, cloudControlUrl } from '../../../../lib/cloud/client.mjs';
import { atomicWrite, cleanupAtomicWriteStaging, runtimePaths, withFileLock } from '../../../../lib/opencode/runtime.mjs';
import { dailyRequest } from '../daily-evidence.mjs';
import { DailyQuests, type DailyEvidence, type DailySubmission, type DailyQuest, type DailySlate, type DailyRecord } from '../daily-quests-rpc';
import { providerConstants } from './providers';

type Port = Pick<Context, 'integration'>;
type Call = import('@opencode/plugin/promise/rpc').RpcCallContext<typeof DailyQuests.methods.snapshot>;
type CloudPort = { request(path: string, options: { method: string; accessToken: string; signal: AbortSignal; body?: unknown }): Promise<unknown> };
type State = { version: 1; records: DailyRecord[] };
type Journal = { get(file: string): Promise<unknown>; set(file: string, state: State): Promise<void>; cleanup?(file: string): Promise<void> };
const MAX_FILE = 262144, MAX_RECORDS = 64, DAY = 86400000;
const { SHIP_INTEGRATION_ID, OAUTH_METHOD } = providerConstants;
class Failure extends Error {
  constructor(readonly code: string, readonly status = 0, readonly uncertain = false) { super(code); }
}
const codes = new Set(('authentication_required invalid_token expired_token revoked_token reauthentication_required insufficient_scope not_found rate_limited voyages_unavailable daily_quests_unavailable daily_grading_unavailable daily_unavailable daily_consent_required invalid_daily_evidence invalid_daily_day invalid_body unknown_field invalid_id key_conflict daily_quest_complete daily_quest_expired daily_submission_active daily_submission_limit daily_outcome_claimed internal_error').split(' '));
const freshRejectionCodes = new Set(('authentication_required invalid_token expired_token revoked_token reauthentication_required insufficient_scope not_found rate_limited daily_consent_required invalid_daily_evidence invalid_body unknown_field invalid_id key_conflict daily_quest_complete daily_quest_expired daily_submission_active daily_submission_limit daily_outcome_claimed').split(' '));
function safe(error: unknown, uncertain = false): Failure {
  if (error instanceof Failure) return new Failure(error.code, error.status, uncertain || error.uncertain);
  const e = error as { code?: string; status?: number } | null;
  const status = Number.isInteger(e?.status) && e!.status! >= 400 && e!.status! <= 599 ? e!.status! : 0;
  return new Failure(codes.has(e?.code ?? '') ? e!.code! : status ? 'request_rejected' : 'request_failed', status, uncertain);
}
function check(ok: unknown): asserts ok { if (!ok) throw new Failure('invalid_response'); }
function obj(value: unknown): Record<string, unknown> { check(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>; }
function str(value: unknown, max = 128): string {
  check(typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f-\u009f\p{Cs}]/u.test(value)); return value;
}
function uuid(value: unknown): string { const s = str(value, 36); check(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s)); return s.toLowerCase(); }
function choice<T extends string>(value: unknown, choices: readonly T[]): T { check(choices.includes(value as T)); return value as T; }
function iso(value: unknown): string {
  const s = str(value, 32);
  check(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(s) && Number.isFinite(Date.parse(s)));
  check(new Date(Date.parse(s)).toISOString().slice(0, 19) === s.slice(0, 19)); return s;
}
function date(value: unknown): string {
  const s = str(value, 10); check(/^\d{4}-\d\d-\d\d$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s); return s;
}
const nullableIso = (value: unknown) => value === null ? null : iso(value);
function flags(v: Record<string, unknown>) { check(v.assessmentBasis === 'tui_submitted' && v.rewards === false); return { assessmentBasis: 'tui_submitted' as const, rewards: false as const }; }
function submission(value: unknown, expectedId?: string, expectedQuest?: string): DailySubmission {
  const s = obj(value), id = uuid(s.id), questId = uuid(s.questId);
  check((expectedId === undefined || id === expectedId) && (expectedQuest === undefined || questId === expectedQuest));
  const status = choice(s.status, ['queued', 'grading', 'graded', 'failed'] as const);
  const decision = s.decision === null ? null : choice(s.decision, ['assessed_complete', 'not_met', 'needs_evidence'] as const);
  let scores: Record<string, number> | null = null;
  if (s.scores !== null) {
    const entries = Object.entries(obj(s.scores)); check(entries.length > 0 && entries.length <= 20);
    scores = Object.fromEntries(entries.map(([k, v]) => { str(k, 64); check(typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1); return [k, v]; }));
  }
  check(Number.isInteger(s.attempts) && (s.attempts as number) >= 0 && (s.attempts as number) <= 4);
  const finishedAt = nullableIso(s.finishedAt), nextAttemptAt = nullableIso(s.nextAttemptAt);
  const model = s.model === null ? null : str(s.model), rubricVersion = s.rubricVersion === null ? null : str(s.rubricVersion, 256);
  const errorCode = s.errorCode === null ? null : choice(s.errorCode, ['daily_grader_invalid', 'daily_grader_unavailable', 'daily_grader_timeout', 'daily_grader_aborted', 'daily_payload_expired', 'daily_attempts_exhausted'] as const);
  const terminal = status === 'graded' || status === 'failed';
  check(terminal === (finishedAt !== null) && (status === 'queued' || nextAttemptAt === null));
  check(status === 'graded' ? decision !== null && scores !== null && model !== null && rubricVersion !== null : decision === null && scores === null && model === null && rubricVersion === null);
  return { id, questId, status, decision, scores, model, rubricVersion, attempts: s.attempts as number, createdAt: iso(s.createdAt), consentAt: iso(s.consentAt), finishedAt, nextAttemptAt, errorCode, ...flags(s) };
}
function quest(value: unknown): DailyQuest {
  const q = obj(value), d = obj(q.definition);
  check(Array.isArray(d.criteria) && d.criteria.length > 0 && d.criteria.length <= 20);
  const criteria = d.criteria.map(v => { const c = obj(v); return { id: str(c.id, 64), text: str(c.text, 4096) }; });
  check(new Set(criteria.map(c => c.id)).size === criteria.length);
  const status = choice(q.status, ['open', 'assessed_complete'] as const), completedAt = nullableIso(q.completedAt);
  check((status === 'assessed_complete') === (completedAt !== null));
  return { id: uuid(q.id), day: date(q.day), definition: { templateId: str(d.templateId), title: str(d.title, 256), kind: choice(d.kind, ['change', 'tests', 'review'] as const), rubricVersion: str(d.rubricVersion, 256), criteria }, status, endsAt: iso(q.endsAt), completedAt, ...flags(q) };
}
function slate(value: unknown): DailySlate {
  const s = obj(value); check(Array.isArray(s.items) && s.items.length === 3);
  const items = s.items.map(quest), day = date(s.day), endsAt = iso(s.endsAt);
  check(new Set(items.map(q => q.id)).size === 3 && new Set(items.map(q => q.definition.kind)).size === 3 && items.every(q => q.day === day && q.endsAt === endsAt));
  return { day, endsAt, policyVersion: str(s.policyVersion), items, ...flags(s) };
}
const terminal = (r: DailyRecord) => r.submission?.status === 'graded' || r.submission?.status === 'failed';
const fileJournal: Journal = {
  cleanup: cleanupAtomicWriteStaging,
  async get(file) {
    let entry;
    try { entry = await lstat(file, { bigint: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
    check(entry.isFile() && entry.size <= BigInt(MAX_FILE));
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const details = await handle.stat({ bigint: true });
      // Windows lacks O_NOFOLLOW. Reject links before opening and verify that
      // the opened handle and current directory entry still identify the same
      // regular file before reading any bytes. Keep POSIX's atomic nofollow too.
      const current = await lstat(file, { bigint: true });
      check(details.isFile() && details.size <= BigInt(MAX_FILE) && current.isFile()
        && entry.dev === details.dev && entry.ino === details.ino
        && current.dev === details.dev && current.ino === details.ino);
      const bytes = Buffer.alloc(MAX_FILE + 1);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      check(bytesRead <= MAX_FILE && BigInt(bytesRead) === details.size);
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead)));
    } finally { await handle.close(); }
  },
  async set(file, state) {
    const contents = JSON.stringify(state); check(Buffer.byteLength(contents) <= MAX_FILE);
    await atomicWrite(file, contents, 0o600);
    if (process.platform !== 'win32') {
      const directory = await open(dirname(file), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  },
};

/** Authenticated boundary. Never reads cookies, automatically posts, or uploads
 * project content. Retention is enforced on journal access, not by a background
 * process; dormant profiles/backups can retain bytes until next access. */
export function createDailyQuestsRpcHandlers(ctx: Port, options: { cloudClient?: CloudPort; baseUrl?: string; now?: () => number; profileRoot?: string; journal?: Journal } = {}) {
  const baseUrl = (options.baseUrl ?? cloudControlUrl()).replace(/\/+$/, '');
  const cloud: CloudPort = options.cloudClient ?? new CloudClient({ baseUrl });
  const journal = options.journal ?? fileJournal, now = options.now ?? Date.now;
  const directory = join(runtimePaths({ root: options.profileRoot }).state, 'carthagent', 'daily-quests');
  async function access() {
    const active = await ctx.integration.connection.active(SHIP_INTEGRATION_ID);
    if (!active || active.type !== 'credential' || active.method !== 'oauth') throw new Failure('authentication_required', 401);
    let credential;
    try { credential = await ctx.integration.connection.resolve(active); } catch { throw new Failure('authentication_required', 401); }
    if (credential?.type !== 'oauth' || credential.methodID !== OAUTH_METHOD || !credential.access) throw new Failure('authentication_required', 401);
    const accountKey = createHash('sha256').update(JSON.stringify([baseUrl, active.id])).digest('hex');
    return { id: active.id, token: credential.access, accountKey, scope: join(directory, accountKey) };
  }
  type Access = Awaited<ReturnType<typeof access>>;
  async function current(a: Access, signal: AbortSignal) {
    signal.throwIfAborted();
    const active = await ctx.integration.connection.active(SHIP_INTEGRATION_ID);
    if (!active || active.type !== 'credential' || active.id !== a.id || active.method !== 'oauth') throw new Failure('account_changed', 401);
  }
  async function request(a: Access, path: string, signal: AbortSignal, body?: DailyRecord['request']) {
    await current(a, signal);
    try {
      const result = await cloud.request(`/v1/voyages/${path}`, { method: body ? 'POST' : 'GET', accessToken: a.token, signal, ...(body ? { body } : {}) });
      await current(a, signal); return obj(result);
    } catch (error) { await current(a, signal); throw error; }
  }
  async function write(a: Access, state: State) {
    try { await journal.set(`${a.scope}.json`, state); } catch { throw new Failure('storage_failed'); }
  }
  async function read(a: Access): Promise<State> {
    try {
      const raw = await journal.get(`${a.scope}.json`);
      if (raw === undefined) return { version: 1, records: [] };
      const s = obj(raw); check(s.version === 1 && Array.isArray(s.records) && s.records.length <= MAX_RECORDS);
      const records = s.records.map(v => {
        const r = obj(v), id = uuid(r.id), questId = uuid(r.questId), createdAt = iso(r.createdAt);
        const accepted = r.submission === null ? null : submission(r.submission, id, questId);
        let frozen: DailyRecord['request'] = null;
        if (r.request !== null) {
          const p = obj(r.request); check(p.consent === true && p.id === id);
          frozen = dailyRequest(p.id, p.evidence) as DailyRecord['request'];
          // No silently repaired payload, extra fields or re-canonicalization
          // of persisted bytes: retry must be the exact previously frozen body.
          check(JSON.stringify(frozen) === JSON.stringify(r.request) && accepted === null);
        }
        return { id, questId, createdAt, request: frozen, submission: accepted };
      });
      check(new Set(records.map(r => r.id)).size === records.length && records.filter(r => r.request).length <= 1);
      const before = JSON.stringify(records);
      const state: State = { version: 1, records: records.filter(r => !terminal(r) || now() - Date.parse(r.createdAt) < 90 * DAY) };
      for (const r of state.records) if (r.request && now() - Date.parse(r.createdAt) >= DAY) r.request = null;
      // Persist erasure before proceeding; never upload if retention storage fails.
      if (JSON.stringify(state.records) !== before) await write(a, state);
      return state;
    } catch (error) { if (error instanceof Failure && error.code === 'storage_failed') throw error; throw new Failure('journal_invalid'); }
  }
  function room(state: State) {
    if (state.records.length < MAX_RECORDS) return;
    const candidates = state.records.filter(terminal).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    if (!candidates.length) throw new Failure('journal_full');
    state.records = state.records.filter(r => r !== candidates[0]);
  }
  async function reconcile(a: Access, state: State, s: DailySubmission) {
    let r = state.records.find(r => r.id === s.id);
    if (!r) { room(state); r = { id: s.id, questId: s.questId, createdAt: s.createdAt, request: null, submission: null }; state.records.push(r); }
    check(r.questId === s.questId);
    r.submission = s; r.request = null;
    await write(a, state);
  }
  function run<T>(mutation: boolean, fn: (input: Record<string, unknown>, call: Call, a: Access, state: State) => Promise<T>) {
    return async (input: unknown, call: Call) => {
      try {
        call.signal.throwIfAborted(); const a = await access();
        return await withFileLock(`${a.scope}.lock`, async () => {
          await current(a, call.signal); const i = obj(input);
          if (mutation && i.accountKey !== a.accountKey) throw new Failure('account_changed', 401);
          try { await journal.cleanup?.(`${a.scope}.json`); }
          catch { throw new Failure('storage_failed'); }
          const state = await read(a);
          const result = await fn(i, call, a, state); await current(a, call.signal); return result;
        });
      } catch (error) {
        const e = safe(error); return call.error('dailyQuestError', e.code, { code: e.code, status: e.status, uncertain: e.uncertain });
      }
    };
  }
  async function dispatch(a: Access, state: State, r: DailyRecord, call: Call, replay: boolean) {
    try {
      const response = await request(a, `daily-quests/${r.questId}/submissions`, call.signal, r.request);
      const s = submission(response.submission, r.id, r.questId);
      await reconcile(a, state, s); return { submission: s };
    } catch (error) {
      const e = safe(error);
      // Fresh definitive rejections are not accepted jobs: remove the record,
      // not just its payload (null/null is reserved for unresolved dispatches).
      // Opaque/proxy 4xx and every replay failure remain uncertain.
      if (!replay && [400, 401, 403, 404, 409, 429].includes(e.status) && freshRejectionCodes.has(e.code)) {
        try { await write(a, { ...state, records: state.records.filter(record => record !== r) }); }
        catch { throw new Failure('storage_failed', 0, true); }
        throw e;
      }
      throw safe(error, true);
    }
  }
  return {
    snapshot: run(false, async (_input, call, a, state) => ({ accountKey: a.accountKey, slate: slate(await request(a, 'daily-quests', call.signal)), records: state.records })),
    detail: run(false, async (input, call, a, state) => {
      const id = uuid(input.id), response = await request(a, `daily-quests/${id}`, call.signal), q = quest(response);
      check(q.id === id);
      const latestSubmission = response.latestSubmission === null ? null : submission(response.latestSubmission, undefined, id);
      if (latestSubmission) await reconcile(a, state, latestSubmission);
      return { ...q, latestSubmission };
    }),
    submit: run(true, async (input, call, a, state) => {
      if (input.consent !== true) throw new Failure('daily_consent_required', 400);
      let body: NonNullable<DailyRecord['request']>;
      try { body = dailyRequest(input.id, input.evidence) as { id: string; consent: true; evidence: DailyEvidence }; }
      catch { throw new Failure('invalid_daily_evidence', 400); }
      const questId = uuid(input.questId);
      if (state.records.some(r => r.id === body.id)) throw new Failure('submission_exists');
      if (state.records.some(r => r.request !== null)) throw new Failure('submission_pending', 0, true);
      room(state);
      const r: DailyRecord = { id: body.id, questId, createdAt: new Date(now()).toISOString(), request: body, submission: null };
      await current(a, call.signal); state.records.push(r);
      // This durable exact canonical body is the write-ahead boundary. Any
      // failure or cancellation here prevents dispatch, never triggers replay.
      await write(a, state);
      return dispatch(a, state, r, call, false);
    }),
    retry: run(true, async (input, call, a, state) => {
      const id = uuid(input.id), r = state.records.find(r => r.id === id);
      if (!r?.request) throw new Failure('no_pending_payload');
      // Reconcile first. Authentication/conflict/outage errors stop here rather
      // than blindly replaying. Only authoritative absence permits this user's
      // explicit retry of the saved UUID/body, including across UTC midnight.
      let response;
      try { response = await request(a, `daily-submissions/${id}`, call.signal); }
      catch (error) { const e = safe(error); if (e.status !== 404 || e.code !== 'not_found') throw safe(error, true); }
      if (response) {
        try { const s = submission(response.submission, id, r.questId); await reconcile(a, state, s); return { submission: s }; }
        catch (error) { throw safe(error, true); }
      }
      return dispatch(a, state, r, call, true);
    }),
    poll: run(false, async (input, call, a, state) => {
      const id = uuid(input.id), r = state.records.find(r => r.id === id);
      const s = submission((await request(a, `daily-submissions/${id}`, call.signal)).submission, id, r?.questId);
      await reconcile(a, state, s); return { submission: s };
    }),
    forgetPayload: run(true, async (input, _call, a, state) => {
      const id = uuid(input.id), r = state.records.find(r => r.id === id);
      if (!r) throw new Failure('record_not_found');
      r.request = null; await write(a, state); return { ok: true as const };
    }),
  };
}
export async function registerDailyQuestsRpc(ctx: Context) {
  return ctx.rpc.register(DailyQuests, createDailyQuestsRpcHandlers(ctx));
}
