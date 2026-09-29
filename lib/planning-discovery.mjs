export const newDiscovery = (active = false) => ({ version: 1, active, reads: 0, blocked: 0 });
const count = n => Number.isInteger(n) && n >= 0 ? Math.min(n, 100000) : 0;
export function restoreDiscovery(value) {
  return { version: 1, active: value?.version === 1 && value.active === true, reads: count(value?.reads), blocked: count(value?.blocked) };
}
export function discoveryEvent(state, kind) {
  if (!state?.active || !['read', 'blocked'].includes(kind)) return state;
  const key = kind === 'read' ? 'reads' : 'blocked';
  return { ...state, [key]: Math.min(100000, count(state[key]) + 1) };
}
export function discoveryCheckpoint(state) {
  if (!state?.active || (state.reads < 8 && state.blocked < 2)) return undefined;
  return `Pre-plan checkpoint: ${state.reads} discovery results, ${state.blocked} blocked implementation attempts. ${state.reads >= 16 ? 'Discovery is expanding without a contract. State the exact unresolved question and use targeted reads if needed.' : 'Prefer the first concrete plan now; identify ONE missing fact if a targeted read is still needed.'} Call delivery_design action="guide" once for exact fields, then delivery_plan with ALL requirements, actual checks and focused scenarios. Do not run shell probes before approval, invent evidence or weaken scope. Necessary reads remain allowed.`;
}
