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

export function validateBudgetOptions(opts) {
  const keys = ['maxTools', 'maxSeconds', 'maxRepairs'];
  if (opts.delivery === false && keys.some(k => opts[k] !== undefined)) throw Error('Budget options require the delivery extension');
  budgetLimits(flag => opts[{ 'delivery-max-tools': 'maxTools', 'delivery-max-seconds': 'maxSeconds', 'delivery-max-repairs': 'maxRepairs' }[flag]]);
}
export function budgetSnapshot(budget, now = Date.now()) {
  if (!budget) return { enabled: false };
  return { ...budget, remaining: {
    tools: budget.limits.tools ? Math.max(0, budget.limits.tools - budget.tools) : null,
    repairs: budget.limits.repairs ? Math.max(0, budget.limits.repairs - budget.repairs) : null,
    seconds: budget.limits.seconds ? Math.max(0, Math.ceil((budget.startedAt + budget.limits.seconds * 1000 - now) / 1000)) : null
  }, reason: budgetReason(budget, undefined, now) };
}
