import { appendFileSync } from 'node:fs';
// Identical non-planning guard in every arm. tool_execution_start is an attempt,
// not proof the tool body ran; tool_call is the preventive boundary.
export default function guard(pi: any) {
  const limit = Number(process.env.BENCH_TOOL_LIMIT || 120);
  if (!Number.isInteger(limit) || limit < 1 || limit > 120) throw Error('Invalid tool limit');
  let attempts = 0;
  pi.on('tool_call', (event: any) => {
    const blocked = ++attempts > limit;
    appendFileSync(process.env.BENCH_GUARD_LOG!, JSON.stringify({ type:'tool-attempt', attempts, tool:event.toolName, blocked })+'\n');
    if (blocked) return { block:true, terminate:true, reason:'Benchmark tool budget exhausted before execution.' };
  });
}
