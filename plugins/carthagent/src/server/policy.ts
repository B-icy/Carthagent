/** Delivery's participating-tool policy. This deliberately is not an OS sandbox. */
import { needsImplementation } from "../../../../lib/planning-access.mjs"
import { startImplementation } from "../../../../lib/planning.mjs"
import { fingerprint } from "../../../../lib/delivery.mjs"

type DeliveryState = Parameters<typeof startImplementation>[0]

export const READ_ONLY_TOOLS = new Set(["read", "ls", "find", "grep", "code_nav", "delivery_probe"])

export function requiresPlanApproval(tool: string) {
  return !["glob", "skill", "question"].includes(tool) && needsImplementation(tool.replace(/^carthagent_/, ""))
}

export function enforceToolPolicy(tool: string, state: DeliveryState, cwd: string) {
  if (!requiresPlanApproval(tool)) return
  if (!state) throw Error(`Implementation locked: ${tool} requires a delivery_plan first.`)
  startImplementation(state, fingerprint(cwd, ["."]))
}

export function policyDescription(workflow: "standard" | "strict") {
  return workflow === "standard"
    ? "Standard workflow: a valid required delivery_plan permits implementation; all declared checks, final review and delivery_finish gates remain mandatory."
    : "Strict workflow: implementation, tests and commands remain locked until the current plan revision has passed design validation, inspection, adversarial review and approval."
}
