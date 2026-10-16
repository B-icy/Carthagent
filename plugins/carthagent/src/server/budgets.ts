import { budgetLimits, newBudget, budgetReason, budgetSnapshot } from "../../../../lib/budget.mjs"

export type Budget = ReturnType<typeof newBudget>

export function readBudgetLimits(options: Record<string, unknown>) {
  return budgetLimits((name) => options[name] ?? "0")
}

export function budgetForSession(saved: Budget | undefined, limits: ReturnType<typeof budgetLimits>) {
  return saved ? structuredClone(saved) : newBudget(limits)
}

export function checkBudget(budget: Budget, action?: "tool" | "repair", now = Date.now()) {
  const reason = budgetReason(budget, action, now)
  if (reason) return reason
  if (action === "tool") budget.tools++
  if (action === "repair") budget.repairs++
  return null
}

export { budgetSnapshot }
