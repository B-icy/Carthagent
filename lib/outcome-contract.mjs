// Shared policy for standard and strict workflows. Content remains authored by
// the planner; these checks enforce traceable obligations, not semantic truth.
const text = value => typeof value === 'string' && value.trim().length > 0;
export function outcomeContractErrors(plan) {
  const errors = [];
  const required = plan.outcomes !== undefined;
  const outcomes = plan.outcomes;
  if (required && (!Array.isArray(outcomes) || !outcomes.length)) return ['Opt-in outcome delivery needs outcomes: [{id,requirement,entrypoint,observable,substitutions,missedFailure,checks}]. Choose critical user paths, not every dependency.'];
  if (outcomes === undefined) return errors;
  if (!Array.isArray(outcomes)) return ['outcomes must be an array'];
  const ids = new Set();
  for (const o of outcomes) {
    if (!o || !text(o.id) || ids.has(o.id)) { errors.push('Outcome IDs must be nonempty and unique'); continue; }
    ids.add(o.id);
    for (const field of ['requirement', 'entrypoint', 'observable', 'missedFailure']) if (!text(o[field])) errors.push(`Outcome ${o.id} needs ${field}`);
    if (!plan.acceptance?.some(a => a.requirement === o.requirement)) errors.push(`Outcome ${o.id} must reference an exact acceptance requirement`);
    if (!Array.isArray(o.substitutions) || o.substitutions.some(s => !text(s))) errors.push(`Outcome ${o.id} needs substitutions:string[] (empty means real path)`);
    if (!Array.isArray(o.checks) || !o.checks.length || o.checks.some(id => !plan.checks?.some(c => c.id === id && c.kind !== 'static'))) errors.push(`Outcome ${o.id} needs existing non-static executable checks`);
  }
  return errors;
}
