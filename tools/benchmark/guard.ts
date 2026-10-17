import { appendFileSync } from 'node:fs';
// Identical native preventive tool gate in every condition.
export default function guard(ctx: any) {
  const limit = Number(process.env.BENCH_TOOL_LIMIT || 120);
  if (!Number.isInteger(limit) || limit < 1 || limit > 120) throw Error('Invalid tool limit');
  let attempts = 0;
  const admitted = new Map<string, boolean>();
  const exhausted = (_sessionID: string) => attempts >= limit;
  ctx.session.hook('context', (event: any) => {
    if (event.kind !== 'primary') return;
    if (exhausted(event.sessionID)) {
      event.tools = {};
      event.system.push({ type:'text', text:'Native benchmark tool budget is exhausted. Stop issuing tool calls, summarize verified status and remaining work.' });
    }
  });
  ctx.session.hook('retry', (event: any) => {
    if (event.attempt >= 3) event.decision = { retry:false };
  });
  ctx.tool.hook('execute.before', (event: any) => {
    const blocked = ++attempts > limit;
    admitted.set(event.id, !blocked);
    appendFileSync(process.env.BENCH_GUARD_LOG!, JSON.stringify({ type:'tool-attempt', attempts, tool:event.tool, blocked })+'\n');
    if (blocked) throw Error('Benchmark tool budget exhausted before execution.');
  });
  ctx.tool.hook('execute.after', (event: any) => {
    if (admitted.get(event.id) === false) return;
    if (event.status !== 'completed' || event.tool !== 'delivery_finish') return;
    const raw = event.result.content.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('\n');
    try {
      const result = JSON.parse(raw);
      if (result.status !== 'verified') event.result.content.push({ type:'text', text:'Benchmark verification policy: only verified status is accepted after the delivery extension checks.' });
    } catch { event.result.content.push({ type:'text', text:'Benchmark verification policy: result shape was not recognized.' }); }
  });
}
