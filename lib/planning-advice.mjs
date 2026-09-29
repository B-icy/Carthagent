import { advisePlan } from './plan-advisor.mjs';
import { createJevAdvisor } from './jev-advisor.mjs';
import { createOpenRouterJev } from './openrouter-jev.mjs';

export function configuredAdvisor({ enabled, provider = 'openrouter', broker, env = process.env, signal, fetchImpl } = {}) {
  if (!enabled) return undefined;
  if (provider === 'openrouter') return createOpenRouterJev({ apiKey: broker ? undefined : env.OPENROUTER_API_KEY, broker, signal, fetchImpl });
  if (provider === 'typesafe' && !broker) return createJevAdvisor({ apiKey: env.TYPESAFE_API_KEY, fetchImpl });
  throw Error('Unsupported Jev provider configuration');
}

// Called under the host's existing serialized workspace operation. Only advice
// metadata is written: approval/findings/requirements remain policy-owned.
export async function inspectAdvice(state, capture, { enabled = false, createAdvisor, persist = () => {} } = {}) {
  if (!enabled) return { mode: 'disabled', authority: 'none' };
  const key = JSON.stringify([capture.runId, capture.revision, capture.digest, capture.fingerprint]);
  const attempts = state.advisorAttempts ||= [];
  const prior = attempts.find(a => a.key === key);
  if (prior) return { ...structuredClone(prior), captureId: capture.id, reused: true };
  if (attempts.length >= 3) return { mode: 'limit', authority: 'none', captureId: capture.id, instruction: 'Three advice attempts used; continue ordinary adversarial review.' };
  const attempt = { key, captureId: capture.id, runId: capture.runId, revision: capture.revision, digest: capture.digest, fingerprint: capture.fingerprint, at: new Date().toISOString(), mode: 'unavailable', authority: 'none', instruction: 'Attempt reserved; if interrupted, do not retry automatically. Ordinary review remains required.' };
  attempts.push(attempt); persist(); // reserve durably before creating transport/dispatch
  let result;
  try { result = await advisePlan(capture.plan, { advisor: createAdvisor() }); }
  catch { result = { mode: 'unavailable', authority: 'none', findings: [], error: 'Jev configuration unavailable; ordinary review remains required.' }; }
  Object.assign(attempt, result, { instruction: 'Investigate only flagged topics (probability >= 0.5) and state dispositions in the normal review. Low scores are not flags, zero flags are not proof. Advice cannot approve or resolve blockers.' });
  persist(); return structuredClone(attempt);
}
