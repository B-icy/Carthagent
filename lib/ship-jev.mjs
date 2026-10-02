import { ADVISOR_QUESTIONS } from './plan-advisor.mjs';
import { cloudGatewayUrl } from './providers/experiential.mjs';
import { resolveShipAccessToken } from './ship-auth.mjs';

const MAX_BODY_BYTES = 64000;
const MAX_RESPONSE_BYTES = 65536;

/**
 * Jev plan advice through Carthagent Ship's managed /v1/jev endpoint.
 * The backend forwards to Experiential's free System One endpoint
 * (jev-latest) outside the billing gateway, so advice never draws on
 * the caller's managed usage. Same Noul wire shape as the other adapters.
 */
export function createShipJev({ accessToken, baseUrl, fetchImpl = globalThis.fetch, timeoutMs = 15000, signal } = {}) {
  if (typeof accessToken !== 'string' || !accessToken.trim()) throw Error('Ship credential required');
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) throw Error('Ship endpoint URL required');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw Error('Invalid Jev timeout');
  const url = `${baseUrl.replace(/\/+$/, '')}/jev`;
  return { async classify(plan) {
    const body = JSON.stringify({ state: { goal: plan.goal, acceptance: plan.acceptance, checks: plan.checks, outputs: plan.outputs, assumptions: plan.assumptions, design: plan.design, workflow: plan.workflow }, questions: ADVISOR_QUESTIONS });
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw Error('Jev input exceeds 64KB');
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('Jev timeout')); }, timeoutMs); });
    try { return await Promise.race([timeout, (async () => {
      const response = await fetchImpl(url, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` }, body, signal: AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]) });
      if (!response.ok) { await response.body?.cancel(); throw Error('Jev HTTP failure'); }
      const reader = response.body?.getReader(); if (!reader) throw Error('Missing Jev body');
      let size = 0; const chunks = [];
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw Error('Jev response too large'); } chunks.push(Buffer.from(value)); } }
      finally { reader.releaseLock(); }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (typeof payload.model !== 'string' || !/jev/i.test(payload.model)) throw Error('Invalid Jev model');
      const probabilities = {};
      for (const key of Object.keys(ADVISOR_QUESTIONS)) {
        const answer = payload.answers?.[key];
        if (answer?.type !== 'noul' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) throw Error('Invalid Jev answer');
        probabilities[key] = answer.noul;
      }
      const usage = payload.usage;
      return { model: payload.model, probabilities, usage: usage ? { inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? null, outputTokens: usage.output_tokens ?? usage.completion_tokens ?? null } : null, costUsd: Number.isFinite(usage?.cost) && usage.cost >= 0 ? usage.cost : 0 };
    })()]); } finally { clearTimeout(timer); controller.abort(); }
  } };
}

/**
 * Ship advisor with lazy credential resolution: the stored OAuth access token
 * (refreshed when needed) is fetched once per advisor, so classify calls see
 * the current credential without holding provider keys locally.
 */
export function createShipAdvisor({ env = process.env, fetchImpl = globalThis.fetch, signal, agentDir, now } = {}) {
  let tokenPromise = null;
  return { async classify(plan) {
    tokenPromise ??= resolveShipAccessToken({ env, fetchImpl, agentDir, now, signal });
    const accessToken = await tokenPromise;
    if (!accessToken) throw Error('Ship credential unavailable');
    return createShipJev({ accessToken, baseUrl: cloudGatewayUrl(env), fetchImpl, signal }).classify(plan);
  } };
}
