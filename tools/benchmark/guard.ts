import { appendFileSync } from 'node:fs';

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
  const admitted = new Map<string, boolean>();
  const register = async (pending: Promise<Registration>) => {
    const registration = await pending;
    registrations.push(registration);
    return registration;
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
      const previous = await ctx.storage.get(guardLedger(event.sessionID));
      const rows = Array.isArray(previous) ? previous : [];
      const attempts = rows.filter(row => row && typeof row === 'object' && row.admitted === true).length;
      const blocked = attempts >= limit;
      admitted.set(event.id, !blocked);
      await ctx.storage.set(guardLedger(event.sessionID), [...rows, { id:event.id, tool:event.tool, admitted:!blocked, at:Date.now() }]);
      appendFileSync(process.env.BENCH_GUARD_LOG!, JSON.stringify({ type:'tool-attempt', sessionID:event.sessionID, callID:event.id, tool:event.tool, attempts:attempts + Number(!blocked), blocked })+'\n');
      if (blocked) throw Error('Benchmark tool budget exhausted before execution.');
    }));
    await register(ctx.tool.hook('execute.after', async (event: any) => {
      if (admitted.get(event.id) === false) return;
      if (event.status !== 'completed' || event.tool !== 'delivery_finish') return;
      const raw = event.result.content.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('\n');
      try {
        const result = JSON.parse(raw);
        if (result.status !== 'verified') event.result.content.push({ type:'text', text:'Benchmark verification policy: only verified status is accepted after the delivery extension checks.' });
      } catch { event.result.content.push({ type:'text', text:'Benchmark verification policy: result shape was not recognized.' }); }
    }));
  } catch (error) {
    disposed = true;
    await Promise.allSettled(registrations.splice(0).reverse().map(registration => registration.dispose()));
    throw error;
  }
  return async () => {
    if (disposed) return;
    disposed = true;
    await Promise.allSettled(registrations.splice(0).reverse().map(registration => registration.dispose()));
  };
}
