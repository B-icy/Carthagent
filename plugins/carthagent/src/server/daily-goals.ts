import { constants } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { Context } from '@opencode/plugin/promise/plugin';
import { CloudClient, cloudControlUrl } from '../../../../lib/cloud/client.mjs';
import { atomicWrite, runtimePaths } from '../../../../lib/opencode/runtime.mjs';
import { addProgress, readProgress, toolGoalProgress, utcDay, DAILY_GOAL_METRICS } from '../daily-goals.mjs';
import { DailyGoals, type DailyGoal, type DailyGoalCompleted, type DailyGoalsSnapshot } from '../daily-goals-rpc';

type Metrics = Record<string, number>;
type Progress = { day: string; metrics: Metrics };
type CloudPort = { request(path: string, options: { method: string; accessToken: string; signal: AbortSignal; body?: unknown }): Promise<unknown> };
type Port = Pick<Context, 'integration' | 'tool' | 'session' | 'event' | 'rpc'>;
type Options = { cloudClient?: CloudPort; baseUrl?: string; now?: () => number; file?: string; syncDelayMs?: number };
class Failure extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, status = 0) { super(code); this.code = code; this.status = status; }
}

const MAX_PREVIOUS_BYTES = 2_000_000;
const name = (tool: string) => String(tool).replace(/^carthagent[._]/, '');
const record = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Failure('invalid_response'); return value as Record<string, unknown>; };
const int = (value: unknown, min = 0) => { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) throw new Failure('invalid_response'); return value; };
const str = (value: unknown, max = 128) => { if (typeof value !== 'string' || !value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Failure('invalid_response'); return value; };

function goals(body: Record<string, unknown>): DailyGoal[] {
  if (!Array.isArray(body.goals) || body.goals.length > 10) throw new Failure('invalid_response');
  return body.goals.map(value => {
    const g = record(value);
    if (!DAILY_GOAL_METRICS.includes(g.metric as string) || typeof g.completed !== 'boolean') throw new Failure('invalid_response');
    const target = int(g.target, 1);
    return { id: str(g.id, 40), metric: g.metric as DailyGoal['metric'], title: str(g.title, 80), target, progress: Math.min(target, int(g.progress)), completed: g.completed, coins: int(g.coins), xp: int(g.xp) };
  });
}
function completedGoals(body: Record<string, unknown>): DailyGoalCompleted[] {
  if (body.completed === undefined) return [];
  if (!Array.isArray(body.completed) || body.completed.length > 10) throw new Failure('invalid_response');
  return body.completed.map(value => { const c = record(value); return { id: str(c.id, 40), title: str(c.title, 80), coins: int(c.coins), xp: int(c.xp) }; });
}

/**
 * Count everyday habits from this profile's own sessions (any agent), keep today's
 * totals in a small local file, and report them to Voyages, which pays each goal once.
 * Counting is best-effort and never blocks, alters or fails a tool call.
 */
export function createDailyGoals(ctx: Port, options: Options = {}) {
  const baseUrl = (options.baseUrl ?? cloudControlUrl()).replace(/\/+$/, '');
  const cloud: CloudPort = options.cloudClient ?? new CloudClient({ baseUrl });
  const now = options.now ?? Date.now;
  const file = options.file ?? join(runtimePaths().state, 'carthagent', 'daily-goals.json');
  const syncDelayMs = options.syncDelayMs ?? 3000;
  const previous = new Map<string, string>();
  const changedThisTurn = new Set<string>();
  let state: Progress | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let syncing: Promise<unknown> | undefined;
  let disposed = false;
  const listeners = new Set<(completed: DailyGoalCompleted[]) => void>();

  const serial = <T>(work: () => Promise<T>) => { const next = queue.then(work, work); queue = next.catch(() => {}); return next; };
  async function load(): Promise<Progress> {
    const day = utcDay(now());
    if (state?.day === day) return state;
    let raw: unknown;
    try { raw = JSON.parse(await readFile(file, 'utf8')); } catch { raw = undefined; }
    state = readProgress(raw, day);
    return state;
  }
  async function add(increments: Metrics) {
    if (!Object.values(increments).some(v => v > 0)) return;
    await serial(async () => {
      state = addProgress(await load(), increments, utcDay(now()));
      await atomicWrite(file, JSON.stringify(state), 0o600);
    });
    schedule();
  }
  function schedule() {
    if (disposed || timer) return;
    timer = setTimeout(() => { timer = undefined; void sync().catch(() => {}); }, syncDelayMs);
    timer.unref?.();
  }
  async function access() {
    const active = await ctx.integration.connection.active('carthagent-cloud');
    if (!active || active.type !== 'credential' || active.method !== 'oauth') throw new Failure('authentication_required', 401);
    let credential;
    try { credential = await ctx.integration.connection.resolve(active); } catch { throw new Failure('authentication_required', 401); }
    if (credential?.type !== 'oauth' || credential.methodID !== 'carthagent-device' || !credential.access) throw new Failure('authentication_required', 401);
    return credential.access as string;
  }
  async function request(token: string, path: string, signal: AbortSignal, method = 'GET', body?: unknown) {
    try { return record(await cloud.request(`/v1/voyages/${path}`, { method, accessToken: token, signal, ...(body === undefined ? {} : { body }) })); }
    catch (error) {
      if (error instanceof Failure) throw error;
      const e = error as { code?: string; status?: number };
      const status = Number.isInteger(e?.status) ? e.status! : 0;
      throw new Failure(typeof e?.code === 'string' && /^[a-z_]{1,64}$/.test(e.code) ? e.code : status ? 'request_rejected' : 'request_failed', status);
    }
  }
  /** Report today's totals (or just read when nothing was counted). */
  async function sync(signal = AbortSignal.timeout(15_000)) {
    if (syncing) return syncing as Promise<{ body: Record<string, unknown>; local: Progress }>;
    const run = (async () => {
      const token = await access();
      const local = await serial(load);
      const counted = Object.values(local.metrics).some(v => v > 0);
      const body = counted ? await request(token, 'daily-goals/progress', signal, 'POST', { day: local.day, metrics: local.metrics }) : await request(token, 'daily-goals', signal);
      const done = completedGoals(body);
      if (done.length) for (const listener of listeners) listener(done);
      return { body, local };
    })();
    syncing = run;
    try { return await run; } finally { syncing = undefined; }
  }
  async function snapshot(signal: AbortSignal): Promise<DailyGoalsSnapshot> {
    const { body, local } = await sync(signal);
    const token = await access();
    const profile = record((await request(token, 'profile', signal)).profile);
    const list = goals(body).map(g => ({ ...g, progress: g.completed ? g.target : Math.min(g.target, Math.max(g.progress, local.day === body.day ? local.metrics[g.metric] ?? 0 : 0)) }));
    return { day: str(body.day, 10), endsAt: str(body.endsAt, 40), goals: list, coins: int(profile.coins), level: int(profile.level, 1) };
  }

  async function before(event: { tool: string; sessionID: string; id: string; input: unknown }) {
    if (name(event.tool) !== 'write') return;
    const input = event.input as Record<string, unknown> | undefined;
    const target = typeof input?.filePath === 'string' ? input.filePath : typeof input?.path === 'string' ? input.path : undefined;
    if (!target) return;
    let path = target;
    if (!isAbsolute(path)) {
      const session = await ctx.session.get({ sessionID: event.sessionID });
      path = resolve(session.location.directory, target);
    }
    let text = '';
    try {
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try { const stat = await handle.stat(); if (stat.isFile() && stat.size <= MAX_PREVIOUS_BYTES) text = await handle.readFile('utf8'); }
      finally { await handle.close(); }
    } catch { /* A new file starts empty. */ }
    previous.set(event.id, text);
  }
  async function after(event: { tool: string; sessionID: string; id: string; input: unknown; status: string }) {
    const prior = previous.get(event.id); previous.delete(event.id);
    const increments = toolGoalProgress({ tool: event.tool, input: event.input, status: event.status, previous: prior }) as Metrics;
    if ((increments.lines ?? 0) > 0) changedThisTurn.add(event.sessionID);
    await add(increments);
  }
  const safely = <E,>(work: (event: E) => Promise<void>) => async (event: E) => { try { await work(event); } catch { /* Counting never affects the session. */ } };

  return {
    before: safely(before), after: safely(after),
    async prompt(event: { metadata?: Record<string, unknown> }) { if (event.metadata?.['ctg.reviewKickoff'] === true) await add({ reviews: 1 }).catch(() => {}); },
    async succeeded(sessionID: string) { if (changedThisTurn.delete(sessionID)) await add({ tasks: 1 }).catch(() => {}); },
    sync, snapshot, add, load: () => serial(load),
    onCompleted(listener: (completed: DailyGoalCompleted[]) => void) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { disposed = true; if (timer) clearTimeout(timer); timer = undefined; previous.clear(); changedThisTurn.clear(); listeners.clear(); },
  };
}

export async function registerDailyGoals(ctx: Context) {
  const goals = createDailyGoals(ctx);
  const cleanups: Array<() => unknown> = [() => goals.dispose()];
  const hold = (registration: { dispose: () => Promise<void> }) => cleanups.push(() => registration.dispose());
  try {
    hold(await ctx.tool.hook('execute.before', goals.before));
    hold(await ctx.tool.hook('execute.after', goals.after));
    hold(await ctx.session.hook('prompt', async event => { await goals.prompt(event); }));
    const registration = await ctx.rpc.register(DailyGoals, {
      snapshot: async (_input: unknown, call: import('@opencode/plugin/promise/rpc').RpcCallContext<typeof DailyGoals.methods.snapshot>) => {
        try { return await goals.snapshot(AbortSignal.any([call.signal, AbortSignal.timeout(15_000)])); }
        catch (error) {
          const e = error instanceof Failure ? error : new Failure('request_failed');
          return call.error('dailyGoalsError', e.code, { code: e.code, status: e.status });
        }
      },
    });
    hold(registration);
    cleanups.push(goals.onCompleted(done => { void registration.events.emit('completed', { goals: done }).catch(() => {}); }));
    const abort = new AbortController();
    cleanups.push(() => abort.abort());
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: abort.signal })) {
          const sessionID = (event as { data?: { sessionID?: string } }).data?.sessionID;
          if (event.type === 'session.execution.succeeded' && sessionID) await goals.succeeded(sessionID);
        }
      } catch { /* Disposal aborts the stream. */ }
    })();
  } catch (error) {
    for (const cleanup of cleanups.reverse()) await cleanup();
    throw error;
  }
  return async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); };
}
