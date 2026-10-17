import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withFileLock } from '../../lib/opencode/runtime.mjs';

type Registration = { dispose(): Promise<void> };
const guardLedger = (sessionID: string) => `benchmark/${sessionID}/tools`;

/** Identical native preventive tool gate in every condition. */
export default async function guard(ctx: any): Promise<() => Promise<void>> {
  const limit = Number(process.env.BENCH_TOOL_LIMIT || 120);
  const retryLimit = Number(process.env.BENCH_RETRY_LIMIT || 3);
  if (!Number.isInteger(limit) || limit < 1 || limit > 120) throw Error('Invalid tool limit');
  if (!Number.isInteger(retryLimit) || retryLimit < 0 || retryLimit > 20) throw Error('Invalid benchmark retry limit');

  const registrations: Registration[] = [];
  let disposed = false;
  let disposing: Promise<void> | undefined;
  const tails = new Map<string, Promise<void>>();
  const admitted = new Map<string, boolean>();
  const cancelledSessions = new Set<string>();
  let cancellationEventsAvailable = true;
  const eventAbort = new AbortController();
  const eventTask = (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal:eventAbort.signal })) {
        if (!event.type.startsWith('session.') || !('sessionID' in event.data)) continue;
        if (event.type === 'session.execution.interrupted' || event.type === 'session.deleted') {
          cancelledSessions.add(event.data.sessionID);
        } else if (event.type === 'session.execution.started') {
          cancelledSessions.delete(event.data.sessionID);
        }
      }
      if (!eventAbort.signal.aborted) cancellationEventsAvailable = false;
    } catch {
      if (!eventAbort.signal.aborted) cancellationEventsAvailable = false;
    }
  })();
  void eventTask.catch(() => undefined);
  const callKey = (sessionID: string, callID: string) => `${sessionID}\0${callID}`;
  const lockPath = (sessionID: string) => {
    const safeID = createHash('sha256').update(sessionID).digest('hex');
    const root = process.env.CTG_OPENCODE_HOME;
    return root ? join(root, 'state', 'benchmark-admission', `${safeID}.lock`)
      : join(tmpdir(), 'ctg-opencode-benchmark-admission', `${safeID}.lock`);
  };
  const serializeSession = async (sessionID: string, action: () => Promise<void>) => {
    const previous = tails.get(sessionID) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    tails.set(sessionID, current);
    try {
      await previous;
      await withFileLock(lockPath(sessionID), action);
    } finally {
      release();
      if (tails.get(sessionID) === current) tails.delete(sessionID);
    }
  };
  const register = async (pending: Promise<Registration>) => {
    const registration = await pending;
    registrations.push(registration);
    return registration;
  };
  const dispose = () => {
    if (disposing) return disposing;
    disposed = true;
    disposing = (async () => {
      // Stop new hook dispatch first. Callbacks already queued re-check
      // disposed after acquiring their session lock; drain until every such
      // callback has released its queue before plugin unload completes.
      await Promise.allSettled(registrations.splice(0).reverse().map(registration => registration.dispose()));
      while (tails.size) await Promise.allSettled([...tails.values()]);
      eventAbort.abort();
      await eventTask.catch(() => undefined);
    })();
    return disposing;
  };
  try {
    await register(ctx.session.hook('context', async (event: any) => {
      if (event.kind !== 'primary') return;
      const rows = await ctx.storage.get(guardLedger(event.sessionID));
      const attempts = Array.isArray(rows) ? rows.filter(row => row && typeof row === 'object' && row.admitted === true).length : 0;
      if (attempts >= limit) {
        event.tools = {};
        event.system.push({ type:'text', text:'Native benchmark tool budget is exhausted. Stop issuing tool calls, summarize verified status and remaining work.' });
      }
    }));
    await register(ctx.session.hook('retry', async (event: any) => {
      if (event.attempt >= retryLimit) event.decision = { retry:false };
    }));
    await register(ctx.tool.hook('execute.before', async (event: any) => {
      let blocked = false;
      let attempts = 0;
      await serializeSession(event.sessionID, async () => {
        if (disposed || !cancellationEventsAvailable || cancelledSessions.has(event.sessionID)) throw Error('Benchmark tool admission cancelled before reservation.');
        const currentCallKey = callKey(event.sessionID, `${event.id}:${event.tool}`);
        const previous = await ctx.storage.get(guardLedger(event.sessionID));
        const rows = Array.isArray(previous) ? previous : [];
        // OpenCode Code Mode dispatches nested namespace tools using the parent
        // execute call ID. Include the actual tool name so the outer execute
        // reservation cannot collide with its nested Carthagent invocation.
        const reservationKey = event.tool === 'execute' ? event.id : `${event.id}:${event.tool}`;
        const existing = rows.find(row => row && typeof row === 'object' && (row.reservationKey === reservationKey || (!row.reservationKey && row.id === event.id && row.tool === event.tool)));
        if (existing) {
          if (existing.tool !== event.tool || typeof existing.admitted !== 'boolean') throw Error('Conflicting benchmark tool reservation ID.');
          attempts = rows.filter(row => row && typeof row === 'object' && row.admitted === true).length;
          blocked = true; // Duplicate invocation never executes twice.
        } else {
          attempts = rows.filter(row => row && typeof row === 'object' && row.admitted === true).length;
          blocked = attempts >= limit;
          if (disposed || !cancellationEventsAvailable || cancelledSessions.has(event.sessionID)) throw Error('Benchmark tool admission cancelled before reservation.');
          // Persist a reservation (or rejection) while holding both the
          // per-session queue and inter-process file lock. No tool is admitted
          // until this durable write has succeeded.
          await ctx.storage.set(guardLedger(event.sessionID), [...rows, { id:event.id, tool:event.tool, reservationKey, admitted:!blocked, at:Date.now() }]);
          attempts += Number(!blocked);
          appendFileSync(process.env.BENCH_GUARD_LOG!, JSON.stringify({ type:'tool-attempt', sessionID:event.sessionID, callID:event.id, tool:event.tool, attempts, blocked })+'\n');
        }
        admitted.set(currentCallKey, !blocked);
      });
      if (blocked) throw Error('Benchmark tool budget exhausted before execution.');
    }));
    await register(ctx.tool.hook('execute.after', async (event: any) => {
      const currentCallKey=callKey(event.sessionID,`${event.id}:${event.tool}`);
      if (admitted.get(currentCallKey) === false) return;
      if (event.status !== 'completed' || event.tool !== 'delivery_finish') return;
      const raw = event.result.content.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('\n');
      try {
        const result = JSON.parse(raw);
        if (result.status !== 'verified') event.result.content.push({ type:'text', text:'Benchmark verification policy: only verified status is accepted after the delivery extension checks.' });
      } catch { event.result.content.push({ type:'text', text:'Benchmark verification policy: result shape was not recognized.' }); }
    }));
  } catch (error) {
    await dispose();
    throw error;
  }
  return dispose;
}
