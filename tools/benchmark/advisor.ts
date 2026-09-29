// Benchmark-only treatment adapter; never modifies approval state or tool availability.
import { appendFileSync } from 'node:fs';
export default function advisor(pi: any) {
  const seen = new Set<string>();
  pi.on('tool_result', async (event: any, ctx: any) => {
    if (event.toolName !== 'delivery_design' || event.input?.action !== 'inspect' || event.isError || seen.size >= 3) return;
    let capture: any;
    try { capture = event.details?.deliveryCapture || JSON.parse(event.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')).result; } catch { return; }
    if (!capture?.plan || !capture?.id) return;
    const revision = `${capture.runId}:${capture.revision}`;
    if (seen.has(revision)) return;
    seen.add(revision);
    let feedback: any;
    try {
      const { goal, acceptance, design, workflow } = capture.plan;
      const response = await fetch(`${process.env.BENCH_GATEWAY}/jev`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: { goal, acceptance, design, workflow } }), signal: AbortSignal.any([AbortSignal.timeout(15000), ...(ctx.signal ? [ctx.signal] : [])]) });
      if (!response.ok) throw Error('Unavailable');
      const result = await response.json() as any;
      feedback = { authority: 'none', mode: 'advisory', captureId: capture.id, model: result.model, answers: result.answers,
        reviewTopics: Object.entries(result.answers).filter(([,v]: any) => v.noul >= 0.5).map(([k]) => k),
        instruction: 'These are uncertain Jev classifications, not proven defects or approval. Adversarially investigate flagged SRP/DI/test gaps, record your disposition, and revise if warranted. All deterministic gates remain required.' };
    } catch { feedback = { authority: 'none', mode: 'unavailable', captureId: capture.id, instruction: 'Jev unavailable; continue deterministic validation and model-authored adversarial review unchanged.' }; }
    appendFileSync(process.env.BENCH_ADVISOR_LOG!, JSON.stringify(feedback) + '\n');
    return { content: [...event.content, { type: 'text', text: '\nOptional Jev advisory:\n' + JSON.stringify(feedback) }] };
  });
}
