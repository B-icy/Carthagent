import { ADVISOR_QUESTIONS } from './plan-advisor.mjs';

// Production adapter, also usable through an explicitly trusted local billing broker.
export function createOpenRouterJev({ apiKey, broker, fetchImpl = fetch, timeoutMs = 15000, signal } = {}) {
  let url = 'https://openrouter.ai/api/alpha/decisions';
  if (broker) {
    const parsed = new URL(broker);
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.username || parsed.password || parsed.pathname !== '/jev' || parsed.search || parsed.hash) throw Error('Jev broker must be an explicit HTTP 127.0.0.1 /jev endpoint');
    url = parsed.href;
  } else if (typeof apiKey !== 'string' || !apiKey.trim()) throw Error('Explicit OpenRouter key required');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw Error('Invalid Jev timeout');
  return { async classify(plan) {
    const body = JSON.stringify({ model: 'typesafe/jev-1.13', state: { goal: plan.goal, acceptance: plan.acceptance, checks: plan.checks, outputs: plan.outputs, assumptions: plan.assumptions, design: plan.design, workflow: plan.workflow }, questions: ADVISOR_QUESTIONS });
    if (Buffer.byteLength(body) > 64000) throw Error('Jev input exceeds 64KB');
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('Jev timeout')); }, timeoutMs); });
    try { return await Promise.race([timeout, (async () => {
      const response = await fetchImpl(url, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', ...(!broker ? { authorization: `Bearer ${apiKey}` } : {}) }, body, signal: AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]) });
      if (!response.ok) { await response.body?.cancel(); throw Error('Jev HTTP failure'); }
      const reader = response.body?.getReader(); if (!reader) throw Error('Missing Jev body');
      let size = 0; const chunks = [];
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 65536) { await reader.cancel(); throw Error('Jev response too large'); } chunks.push(Buffer.from(value)); } }
      finally { reader.releaseLock(); }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (typeof payload.model !== 'string' || !payload.model.startsWith('typesafe/jev-1.13')) throw Error('Invalid Jev model');
      const probabilities = {};
      for (const key of Object.keys(ADVISOR_QUESTIONS)) {
        const answer = payload.answers?.[key];
        if (answer?.type !== 'noul' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) throw Error('Invalid Jev answer');
        probabilities[key] = answer.noul;
      }
      const usage = payload.usage;
      return { model: payload.model, probabilities, usage: usage ? { inputTokens: usage.prompt_tokens ?? usage.input_tokens ?? null, outputTokens: usage.completion_tokens ?? usage.output_tokens ?? null } : null, costUsd: Number.isFinite(usage?.cost) && usage.cost >= 0 ? usage.cost : null };
    })()]); } finally { clearTimeout(timer); controller.abort(); }
  } };
}
