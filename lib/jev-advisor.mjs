import { ADVISOR_QUESTIONS } from './plan-advisor.mjs';

// HTTP adapter for documented Noul answers. Key/network/time/pricing are injected.
// No env lookup, implicit opt-in, retries, SDK install or approval authority.
export function createJevAdvisor({ apiKey, fetchImpl = fetch, model = 'jev-1.13.0', timeoutMs = 3000, inputPricePerMillion = null } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw Error('Explicit Jev key required');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw Error('Advisor timeout must be 1–30000ms');
  if (inputPricePerMillion !== null && (!Number.isFinite(inputPricePerMillion) || inputPricePerMillion < 0)) throw Error('Explicit nonnegative input pricing required');
  return {
    async classify(plan) {
      const body = JSON.stringify({ model, state: { goal: plan.goal, acceptance: plan.acceptance, design: plan.design, workflow: plan.workflow }, questions: ADVISOR_QUESTIONS });
      if (Buffer.byteLength(body) > 64000) throw Error('Advisor request exceeds conservative 64KB local limit');
      const controller = new AbortController();
      let timer;
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('Advisor timeout')); }, timeoutMs); });
      try {
        return await Promise.race([timeout, (async () => {
          const response = await fetchImpl('https://api.typesafe.ai/v1/systemone', { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body, signal: controller.signal, redirect: 'error' });
          if (!response.ok) throw Error('Advisor HTTP failure');
          const reader = response.body?.getReader();
          if (!reader) throw Error('Advisor response body unavailable');
          const chunks = []; let size = 0;
          try {
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > 65536) { await reader.cancel(); throw Error('Advisor response too large'); }
              chunks.push(Buffer.from(value));
            }
          } finally { reader.releaseLock(); }
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (typeof payload.model !== 'string' || !payload.model.trim()) throw Error('Missing advisor model identity');
          const probabilities = {};
          for (const key of Object.keys(ADVISOR_QUESTIONS)) {
            const answer = payload.answers?.[key];
            if (answer?.type !== 'noul' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) throw Error('Invalid Noul answer');
            probabilities[key] = answer.noul;
          }
          const tokens = payload.usage?.input_tokens;
          const usage = Number.isInteger(tokens) && tokens >= 0 ? { inputTokens: tokens, outputTokens: payload.usage.output_tokens ?? null } : null;
          return { model: payload.model, probabilities, usage, costUsd: usage && inputPricePerMillion !== null ? tokens * inputPricePerMillion / 1e6 : null };
        })()]);
      } finally { clearTimeout(timer); controller.abort(); }
    },
  };
}
