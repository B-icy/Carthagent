import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { DELIVERY_INVARIANTS, TEST_INFRASTRUCTURE_GUIDANCE, deliveryPhaseGuidance } from "../../../../lib/delivery-guidance.mjs"
import { PLANNING_START } from "../../../../lib/planning-guide.mjs"
import { formatGuidance } from "../../../../lib/guidance.mjs"
import { looksInformational } from "../../../../lib/delivery.mjs"
import { unframe } from "./framing.mjs"

export const STANDARD_GUIDANCE = "Standard delivery: inspect relevant files (glob/read/code_nav); create delivery_plan with complete requirements, artifact roots, a few steps and real checks. A valid required plan enables implementation immediately: design components/scenario ceremony is optional. Revisions merge design/workflow fields, replace supplied arrays, preserve obligations and require fresh final evidence, not repeated approval. Mark implementation steps done independently of integrated check execution. Use delivery_check all, final delivery_review inspect/record, then delivery_finish with honest limitations. No fabricated evidence, scope reduction or unrequested dependency changes. Informational plans do not authorize implementation. For bounded environment versions use delivery_probe kind=node-version or npm-version; inspect other APIs through read."

const browserCheck = fileURLToPath(new URL("../../../../tools/browser-check.mjs", import.meta.url))
const browserGuidance = existsSync(browserCheck)
  ? `For web/browser tasks, a self-contained browser check is available: ${JSON.stringify(browserCheck)}. Declare it as a runtime check, e.g. ["node",${JSON.stringify(browserCheck)},"--page","index.html","--assert","#app","--assert-count","#items:3","--click","#btn","--then-text","#out:done","--console-clean","--screenshot","artifacts/ui.png"]. It serves the workspace over HTTP, runs jsdom assertions with real inline-script execution (clicks, text, selectors, console-error detection), and captures a real screenshot with the bundled lightweight headless browser (auto-downloaded on first use).`
  : ""

export function originalTask(prompt: string) { return unframe(prompt) ?? prompt }

/* eslint-disable @typescript-eslint/no-explicit-any -- Host-neutral domain snapshots are JS objects. */
export function shipGuidance({ state, workflow, prompt = "", profiles = [], discovery, extraGuidance, required = [], imageInput }: {
  state: any; workflow: string; prompt?: string; profiles?: any[]; discovery?: any;
  extraGuidance?: string; required?: any[]; imageInput?: boolean;
}) {
/* eslint-enable @typescript-eslint/no-explicit-any */
  const task = originalTask(prompt)
  const mode = state && !["verified", "blocked"].includes(state.status) ? state.workflowMode : workflow
  const parts = mode === "standard"
    ? ["Preserve every user requirement and promised output.", STANDARD_GUIDANCE]
    : [DELIVERY_INVARIANTS, deliveryPhaseGuidance(state)]
  if (/\b(test|typescript|route|backend|api)\b/i.test(task)) parts.push(TEST_INFRASTRUCTURE_GUIDANCE)
  if (profiles.some(profile => /web|browser/.test(profile.id)) || /\b(browser|web|frontend|screenshot)\b/i.test(task)) parts.push(browserGuidance)
  if (imageInput === false) parts.push("This session's model cannot process images: do not attempt to view, read, or reason over image files or screenshots — visual review is unavailable. Verify visual behavior through DOM structure, computed styles, and console evidence instead; screenshots remain useful as evidence artifacts for the user even though you cannot inspect them.")
  if (discovery?.active && mode !== "standard") parts.push(PLANNING_START)
  const routed = formatGuidance(profiles)
  if (routed) parts.push(routed)
  if (extraGuidance) parts.push(`Task-specific delivery context:\n${extraGuidance}`)
  if (required.length) parts.push(`User-owned required validators will be added to your plan automatically: ${JSON.stringify(required)}. Run delivery_check id="all"; repair failures rather than replacing or bypassing these checks.`)
  if (looksInformational(task)) parts.push('Receipt check: this prompt reads as informational/read-only. Answer it directly, or if you record a contract use delivery_plan verification:"none" (no checks) or "advisory" (optional non-blocking evidence). Do not enter the verify/repair loop for a pure question — decide the classification now, before the verify loop.')
  return parts.filter(Boolean).join("\n\n")
}
