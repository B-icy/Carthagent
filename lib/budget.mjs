// Session accounting is deliberately independent of delivery-plan revisions.
export function budgetLimits(getFlag) {
  const limits = {};
  for (const [key, flag] of [['tools', 'tools'], ['seconds', 'seconds'], ['repairs', 'repairs']]) {
    const raw = getFlag(`delivery-max-${flag}`) ?? '0';
    if (!/^\d+$/.test(String(raw)) || !Number.isSafeInteger(Number(raw)) || Number(raw) > 1000000) throw Error(`delivery-max-${flag} must be an integer from 0 to 1000000`);
    limits[key] = Number(raw);
  }
  return limits;
}
export function newBudget(limits, now = Date.now()) {
  return { startedAt: now, limits, tools: 0, repairs: 0, stopped: null };
}
export function budgetReason(budget, action, now = Date.now()) {
  if (!budget) return null;
  if (budget.stopped) return budget.stopped;
  if (budget.limits.seconds && now - budget.startedAt >= budget.limits.seconds * 1000) return 'elapsed-time';
  if (action === 'tool' && budget.limits.tools && budget.tools >= budget.limits.tools) return 'tool-calls';
  if (action === 'repair' && budget.limits.repairs && budget.repairs >= budget.limits.repairs) return 'repair-rounds';
  return null;
}
