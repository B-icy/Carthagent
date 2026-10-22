import { randomUUID } from "node:crypto"
import type { Context } from "@opencode/plugin/promise/plugin"
import { Error as NativeToolError, type ToolContext } from "@opencode/plugin/promise/tool"
import type { Tool } from "@opencode/schema/tool"
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { deliveryPhaseGuidance } from "../../../../lib/delivery-guidance.mjs"
import { contextMetrics, deliveryRecovery, designReceipt, recoveryMessages } from "../../../../lib/delivery-context.mjs"
import { validatePlanning, inspectPlanning, recordPlanReview, approvePlanning, planningStatus, startImplementation } from "../../../../lib/planning.mjs"
import { planningGuide, planningNext } from "../../../../lib/planning-guide.mjs"
import { newDiscovery, restoreDiscovery, discoveryCheckpoint, discoveryEvent } from "../../../../lib/planning-discovery.mjs"
import { budgetLimits, newBudget, budgetReason, budgetSnapshot } from "../../../../lib/budget.mjs"
import { validatePlan, fingerprint, runCommand, pendingChecks, shouldContinue, validateRevision, bindRequiredChecks, loadRequiredChecks, updateStepStatus, verificationMode, looksInformational, revisePlan, mergePlanPatch, completionIssues, planSteps, pendingRequirements, planD2WithProgress, evidenceIdentity } from "../../../../lib/delivery.mjs"
import { captureDeliveryReview, recordDeliveryReview } from "../../../../lib/delivery-review.mjs"
import { loadGuidanceProfiles, routeGuidance } from "../../../../lib/guidance.mjs"
import { saveReport, reconcileReport } from "../../../../lib/reports.mjs"
import { lockWorkspace, selectReport, assertActiveReport } from "../../../../lib/workspace.mjs"
import { enforceToolPolicy, requiresPlanApproval } from "./policy.ts"
import { effectiveSessionOptions } from "../../../../lib/opencode/session-options.mjs"
import { archiveContext } from "../../../../lib/context-archive.mjs"
import { probeDiagnostics } from "../../../../lib/probe-diagnostics.mjs"
import { configuredAdvisor, inspectAdvice } from "../../../../lib/planning-advice.mjs"
import { createShipJev } from "../../../../lib/ship-jev.mjs"
import { cloudGatewayUrl } from "../../../../lib/providers/experiential.mjs"
import { isShipAgent } from "./ship-agents.ts"
import { originalTask, shipGuidance } from "./ship-guidance.ts"
import { archiveDeliveryExchanges, localToolName, normalizeDesignReview, shellProtection } from "./ship-context.mjs"

/* eslint-disable @typescript-eslint/no-explicit-any -- Existing workflow snapshots mirror evolving JS domain schemas. */
type SessionState = { state: any; discovery: any; nudges: number; touched: boolean; budget: any; required: any[]; configError?: string; extraGuidance?: string; initialFiles: string[]; lastPrompt?: string; guidance?: string; writeCounts?: Record<string, number>; outcome?: string; cwd?: string; guidanceProfiles?: string[]; probeState?: { failures: number; family: string | null }; statusPoll?: { key: string; count: number }; contextBytes?: number; recovery?: Record<string, any>; initialFilesCaptured?: boolean; model?: { providerID: string; id: string } }
type DeliveryOptions = Record<string, unknown>
type Schema = Record<string, unknown>
type DeliveryInput = Record<string, any>
type RegisteredToolContext = ToolContext
/* eslint-enable @typescript-eslint/no-explicit-any */

const S = (description?: string) => ({ type: "string", minLength: 1, maxLength: 1200, ...(description ? { description } : {}) })
const A = (items: Schema, maxItems = 20): Schema => ({ type: "array", items, maxItems })
const O = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({ type: "object", properties, required, additionalProperties: false })
const text = (value: unknown) => ({ content: typeof value === "string" ? value : JSON.stringify(value, null, 2) })
const empty = O({}, [])
const short = S()
const steps = A({ anyOf: [short, O({ id: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,39}$" }, title: short, kind: { type: "string", enum: ["work", "regression"] }, dependsOn: A(short, 40), checks: A(short, 24) }, ["id", "title"])] }, 40)
const checks = A(O({ id: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,39}$" }, kind: { type: "string", enum: ["test", "runtime", "static"] }, argv: A(short, 80), timeoutSeconds: { type: "integer", minimum: 1, maximum: 300 } }), 24)
const acceptance = A(O({ requirement: short, checks: A(short, 24) }), 40)
const planSchema = O({ goal: short, assumptions: A(short), artifacts: A(short, 40), outputs: A(short, 40), steps, verification: { type: "string", enum: ["required", "advisory", "none"] }, acceptance, checks, design: { type: "object", additionalProperties: true }, workflow: { type: "object", additionalProperties: true }, outcomes: A({ type: "object", additionalProperties: true }, 32) }, ["goal", "assumptions", "artifacts", "steps", "acceptance", "checks"])

function sessionKey(sessionID: string) { return `session/${sessionID}` }

/**
 * Register CTG delivery tools and server hooks against OpenCode V2's Promise plugin context.
 * Call from Plugin.define({ setup(ctx) { return registerDelivery(ctx, options) } }).
 * Every operation derives both sessionID and worktree directory from the invocation/session API;
 * no active-session process global is used. State is durable per session in ctx.storage while
 * the existing .harness report and workspace lock remain canonical cross-process coordination.
 */
export async function registerDelivery(ctx: Context, options: DeliveryOptions = {}) {
  const registrations: Array<{ dispose(): Promise<void> }> = []
  const serial = new Map<string, Promise<unknown>>()
  const budgetTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const admittedCalls = new Set<string>()
  const profiles = loadGuidanceProfiles()
  let disposed = false
  const limitOptions: Record<string, string> = { "delivery-max-tools": "maxTools", "delivery-max-seconds": "maxSeconds", "delivery-max-repairs": "maxRepairs" }
  const sessionOptions = (session: Parameters<typeof effectiveSessionOptions>[0]): Record<string, unknown> => effectiveSessionOptions(session, { ...ctx.options, ...options })
  async function scope(sessionID: string) {
    if (!sessionID) throw Error("OpenCode sessionID is required")
    const session = await ctx.session.get({ sessionID })
    const cwd = session.location?.directory
    if (typeof cwd !== "string" || !cwd) throw Error(`OpenCode session ${sessionID} has no worktree location`)
    const opts = sessionOptions(session)
    const saved = await ctx.storage.get(sessionKey(sessionID)) as SessionState | undefined
    const data: SessionState = saved ? structuredClone(saved) : { state: null, discovery: newDiscovery(), nudges: 0, touched: false, budget: null, required: [], initialFiles: [] }
    data.cwd = cwd
    data.outcome = session.outcome
    data.discovery = restoreDiscovery(data.discovery)
    if (data.state) {
      const dir = runDirectory(cwd, sessionID, data.state.runId)
      data.state = reconcileReport(join(dir, "report.json"), data.state)
    }
    const limits = budgetLimits((name: string) => opts[limitOptions[name]] ?? opts[name] ?? "0")
    if (!data.budget) data.budget = newBudget(limits)
    else if (JSON.stringify(data.budget.limits) !== JSON.stringify(limits)) data.budget.limits = limits
    if (data.budget.limits.seconds && !budgetTimers.has(sessionID) && !data.budget.stopped) {
      const remaining = Math.max(1, data.budget.startedAt + data.budget.limits.seconds * 1000 - Date.now())
      const timer = setTimeout(() => {
        void serialized(sessionID, async () => {
          const latest = await scope(sessionID)
          if (!latest.data.budget.stopped) {
            latest.data.budget.stopped = "elapsed-time"
            await ctx.storage.set(sessionKey(sessionID), latest.data)
            await ctx.session.interrupt({ sessionID, resume: false })
          }
        }).catch(error => console.error("Carthagent delivery budget stop failed", error))
      }, remaining)
      timer.unref?.(); budgetTimers.set(sessionID, timer)
    }
    if (!data.required.length) {
      const explicit = typeof opts.validators === "string" ? opts.validators : undefined
      const projectManifest = join(cwd, ".carthagent", "delivery.json")
      const manifest = explicit ? resolve(cwd, explicit) : existsSync(projectManifest) ? projectManifest : undefined
      try { if (manifest) data.required = loadRequiredChecks(manifest, cwd) }
      catch (error) { data.configError = `Invalid required validators: ${error}` }
      if (typeof opts.context === "string") {
        try { data.extraGuidance = readFileSync(resolve(cwd, opts.context), "utf8") }
        catch (error) { data.configError = `Invalid delivery context: ${error}` }
      }
      if (opts.protectExisting && !data.initialFilesCaptured) {
        data.initialFiles = readdirSync(cwd, { withFileTypes: true }).filter(e => e.isFile()).map(e => resolve(cwd, e.name))
        data.initialFilesCaptured = true
      }
    }
    if (data.state && data.required.length) {
      for (const check of data.required) {
        const old = data.state.plan.checks.find((c: { id: string }) => c.id === check.id)
        if (JSON.stringify(old) !== JSON.stringify(check)) delete data.state.evidence[check.id]
      }
      data.state.plan = bindRequiredChecks(data.state.plan, data.required)
    }
    return { session, cwd, data, options: opts, active: Boolean(opts.delivery) && isShipAgent(session.agent) }
  }
  function runDirectory(cwd: string, sessionID: string, runId: string) { return join(cwd, ".harness", sessionID, runId) }
  async function persist(cwd: string, sessionID: string, data: SessionState) {
    if (data.state) {
      const dir = runDirectory(cwd, sessionID, data.state.runId)
      mkdirSync(dir, { recursive: true })
      saveReport(join(dir, "report.json"), data.state)
      selectReport(cwd, join(dir, "report.json"))
    }
    await ctx.storage.set(sessionKey(sessionID), data)
  }
  async function serialized<T>(sessionID: string, job: () => Promise<T>): Promise<T> {
    const previous = serial.get(sessionID) || Promise.resolve()
    const current = previous.then(job)
    serial.set(sessionID, current.catch(() => {}))
    return current
  }
  async function operate<T>(sessionID: string, job: (s: Awaited<ReturnType<typeof scope>>) => Promise<T>, replace = false): Promise<T> {
    return serialized(sessionID, async () => {
      const s = await scope(sessionID)
      const release = lockWorkspace(s.cwd)
      try {
        if (!replace && s.data.state) {
          const dir = runDirectory(s.cwd, sessionID, s.data.state.runId)
          assertActiveReport(s.cwd, join(dir, "report.json"))
          s.data.state = reconcileReport(join(dir, "report.json"), s.data.state)
        }
        return await job(s)
      } finally { release() }
    })
  }
  const add = (editor: Parameters<Parameters<Context["tool"]["transform"]>[0]>[0], name: string, description: string, input: Schema, execute: (input: DeliveryInput, toolContext: RegisteredToolContext) => Promise<{ content: string }>) => editor.add({
    name, description, input: input as Tool.ValueSchema<DeliveryInput>, execute: async (rawValue, tool) => {
      const value = rawValue as DeliveryInput
      const { active } = await scope(tool.sessionID)
      if (!active || !isShipAgent(tool.agent)) throw Error("Carthagent delivery tools are disabled for this session; select Ship mode to use them.")
      try {
        const result = await execute(value, tool)
        const { data } = await scope(tool.sessionID)
        if (!data.state) return result
        return { ...result, metadata: { deliveryPlan: planSnapshot(data.state) } }
      }
      catch (error) { throw new NativeToolError({ message: error instanceof Error ? error.message : String(error) }) }
    }, options: { namespace: "carthagent", codemode: true },
  })

  registrations.push(await ctx.tool.transform(editor => {
    editor.namespace?.({ name: "carthagent", description: "Evidence-driven CTG delivery workflow tools" })
    add(editor, "delivery_plan", "Create the durable acceptance contract and plan.d2. Informational asks may use verification none/advisory; product changes require fresh checks.", planSchema, async (input, tool) => operate(tool.sessionID, async ({ cwd, data, options: opts }) => {
      if (data.configError) throw Error(data.configError)
      const plan = validatePlan(bindRequiredChecks({ ...input, verification: input.verification ?? "required" }, data.required), cwd)
      validateRevision(data.state, plan)
      if (data.state && !["verified", "blocked"].includes(data.state.status)) data.state = revisePlan(data.state, plan, { cwd, hash: fingerprint(cwd, ["."]), reason: "Active plan replaced via delivery_plan" })
      else data.state = { version: 1, workflowMode: opts.workflow === "strict" ? "strict" : "standard", reviewRequired: opts.workflow !== "strict", runId: randomUUID(), revision: (data.state?.revision || 0) + 1, plan, evidence: {}, status: "implementing", createdAt: new Date().toISOString(), stepStatus: {}, guidanceProfiles: data.guidanceProfiles || [] }
      data.discovery = newDiscovery(); const dir = runDirectory(cwd, tool.sessionID, data.state.runId)
      mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "plan.d2"), planD2WithProgress(data.state.plan, data.state.stepStatus))
      await persist(cwd, tool.sessionID, data)
      return text({ plan: join(dir, "plan.d2"), report: join(dir, "report.json"), next: data.state.workflowMode === "standard" ? "Contract accepted; implement, verify all checks, review and finish." : "No code or commands yet. Validate, inspect, adversarially review, then approve the design." })
    }, true))
    add(editor, "delivery_probe", "Bounded pre-plan version probe only; other APIs can be inspected with read.", O({ kind: { type: "string", enum: ["node-version", "npm-version"] } }), async (input, tool) => {
      const { cwd } = await scope(tool.sessionID)
      const argv = input.kind === "node-version" ? [process.execPath, "--version"] : [process.platform === "win32" ? "npm.cmd" : "npm", "--version"]
      return text({ ...(await runCommand(argv, { cwd, signal: tool.signal, timeoutSeconds: 10 } as Parameters<typeof runCommand>[1])), evidence: false })
    })
    add(editor, "delivery_revise", "Revise the current task with a reason and partial patch. Existing obligations and verification history cannot be removed.", O({ reason: short, patch: { type: "object", additionalProperties: true } }), async (input, tool) => operate(tool.sessionID, async ({ cwd, data }) => {
      if (!data.state) throw Error("Call delivery_plan first")
      const hash = fingerprint(cwd, ["."])
      data.state = revisePlan(data.state, bindRequiredChecks(mergePlanPatch(data.state.plan, input.patch), data.required), { cwd, reason: input.reason, hash })
      await persist(cwd, tool.sessionID, data)
      return text({ revision: data.state.revision, pendingChecks: pendingChecks(data.state, hash), unverifiedRequirements: pendingRequirements(data.state, hash), next: data.state.workflowMode === "standard" ? "Continue implementation; changed checks require fresh evidence." : "Revision relocks implementation; validate and re-approve." })
    }))
    add(editor, "delivery_design", "Strict workflow design gate. Guide, validate, inspect, adversarially review every scenario, then approve. Review is model-authored, not independent proof.", O({ action: { type: "string", enum: ["guide", "validate", "inspect", "review", "approve"] }, captureId: short, review: { type: "object", additionalProperties: true }, challenges: A(short, 40), walkthroughs: A({ type: "object", additionalProperties: true }, 80), findings: A({ type: "object", additionalProperties: true }, 80), limitations: A(short) }, ["action"]), async (input, tool) => {
      if (input.action === "guide") return text(planningGuide())
      return operate(tool.sessionID, async ({ session, cwd, data, options: opts }) => {
        if (!data.state) throw Error("Call delivery_plan first")
        const hash = fingerprint(cwd, ["."]); let result
        if (input.action === "validate") result = validatePlanning(data.state, hash)
        else if (input.action === "inspect") result = inspectPlanning(data.state, hash)
        else if (input.action === "review") result = recordPlanReview(data.state, hash, normalizeDesignReview(input))
        else if (input.action === "approve") result = approvePlanning(data.state, hash)
        else throw Error("Unknown delivery_design action")
        let advice
        if (input.action === "inspect") {
          const ship = (session.model ?? data.model)?.providerID === "experiential-labs"
          const enabled = opts.jev === undefined ? ship : opts.jev === true
          const createAdvisor = () => {
            if (opts.jevProvider === "ship" || (ship && !opts.jevProvider)) {
              return { classify: async (plan: unknown) => {
                const active = await ctx.integration.connection.active("experiential-labs")
                if (!active || active.type !== "credential" || active.method !== "oauth") throw Error("Ship OAuth connection required")
                const credential = await ctx.integration.connection.resolve(active)
                if (credential?.type !== "oauth" || credential.methodID !== "carthagent-device" || !credential.access) throw Error("Ship OAuth credential required")
                return createShipJev({ fetchImpl: globalThis.fetch, ...{ accessToken: credential.access, baseUrl: cloudGatewayUrl(), signal: tool.signal } }).classify(plan)
              } }
            }
            return configuredAdvisor({ ...{ enabled, provider: String(opts.jevProvider || "openrouter"), signal: tool.signal } })
          }
          advice = await inspectAdvice(data.state, result, { ...{ enabled, createAdvisor, persist: () => persist(cwd, tool.sessionID, data) } })
        }
        let receipt = designReceipt(input.action, result)
        if (input.action === "inspect" && JSON.stringify(result).length > 16000) {
          try {
            const archive = archiveContext(cwd, runDirectory(cwd, tool.sessionID, data.state.runId), result)
            receipt = { ...result, plan: undefined, capturePath: archive.path, captureDigest: archive.digest, captureBytes: archive.bytes, instruction: "Read the complete capturePath before reviewing. This is not an approval." }
          } catch { /* Retain the original capture if archival fails. */ }
        }
        await persist(cwd, tool.sessionID, data)
        return text({ result: receipt, ...(advice ? { advice } : {}), ...(input.action === "inspect" ? { captureId: result.id } : {}), ...(input.action === "validate" ? planningNext(data.state, result) : {}), planningStatus: planningStatus(data.state, hash) })
      })
    })
    add(editor, "delivery_status", "Show delivery state, stale/failed checks and next action. Call finish instead of polling when readyToFinish is true.", empty, async (_input, tool) => operate(tool.sessionID, async ({ cwd, data }) => {
      if (!data.state) return text("No delivery contract.")
      const dir = runDirectory(cwd, tool.sessionID, data.state.runId)
      let hash: string
      try { hash = fingerprint(cwd, ["."]) }
      catch (error) { return text({ ...deliveryRecovery(data.state, { report: join(dir, "report.json") }), pendingChecks: [`[scope error: ${error}]`], readyToFinish: false, next: 'Evidence scope could not be established. Call delivery_finish with status="blocked" and specific limitations.' }) }
      const issues = completionIssues(data.state, cwd, hash); const readyToFinish = Object.values(issues).every(items => !items.length)
      return text({ ...deliveryRecovery(data.state, { report: join(dir, "report.json") }), pendingChecks: pendingChecks(data.state, hash), completionIssues: issues, readyToFinish, next: readyToFinish ? "Call delivery_finish; do not poll again." : "Run declared checks, complete steps/outputs, and resolve outstanding requirements." })
    }))
    add(editor, "delivery_progress", "Update implementation step progress and regenerate the plan diagram.", O({ step: { anyOf: [{ type: "integer", minimum: 0 }, short] }, status: { type: "string", enum: ["active", "done", "failed", "pending"] }, note: short }, ["step", "status"]), async (input, tool) => operate(tool.sessionID, async ({ cwd, data }) => {
      if (!data.state) throw Error("Call delivery_plan first")
      const step = planSteps(data.state.plan).find((s: { id: string }, i: number) => typeof input.step === "string" ? s.id === input.step : i === input.step)
      const hash = input.status === "done" && step?.checks.length ? fingerprint(cwd, ["."]) : undefined
      updateStepStatus(data.state, input.step, input.status, hash)
      if (input.note) data.state.progressNotes = [...(data.state.progressNotes || []), { step: step?.id, status: input.status, note: input.note, revision: data.state.revision, at: new Date().toISOString() }]
      const dir = runDirectory(cwd, tool.sessionID, data.state.runId); writeFileSync(join(dir, "plan.d2"), planD2WithProgress(data.state.plan, data.state.stepStatus)); await persist(cwd, tool.sessionID, data)
      return text({ step: input.step, status: input.status, plan: join(dir, "plan.d2") })
    }))
    add(editor, "delivery_check", "Run declared check(s) with no implicit shell, deadline, full logs and current workspace fingerprint. Checks never fabricate evidence.", O({ id: short }), async (input, tool) => operate(tool.sessionID, async ({ cwd, data }) => {
      if (!data.state) throw Error("Call delivery_plan first")
      const verification = verificationMode(data.state.plan)
      if (verification === "none") return text({ verification, note: "No checks are declared for this informational plan; call delivery_finish." })
      startImplementation(data.state, fingerprint(cwd, ["."]))
      const selected = input.id === "all" ? data.state.plan.checks : data.state.plan.checks.filter((c: { id: string }) => c.id === input.id)
      if (!selected.length) throw Error("Unknown check ID; use delivery_status or id=all")
      const results = []
      for (const check of selected) {
        if (tool.signal.aborted) throw Error("Check cancelled before execution")
        const identity = evidenceIdentity(data.state, check); data.state.status = "verifying"; data.state.verificationStarted = true; delete data.state.evidence[check.id]
        let before: string
        try { before = fingerprint(cwd, ["."]) }
        catch (error) {
          data.state.evidence[check.id] = { passed: false, ...identity, fingerprint: null, code: 1, outputTail: `Evidence scope error: ${error}` }
          await persist(cwd, tool.sessionID, data)
          throw Error(`Evidence scope error: ${error}. Call delivery_finish with status="blocked" and specific limitations rather than retrying.`)
        }
        await persist(cwd, tool.sessionID, data)
        await tool.progress?.({ title: `Running ${check.id}`, description: JSON.stringify(check.argv) })
        const dir = runDirectory(cwd, tool.sessionID, data.state.runId)
        const result = await runCommand(check.argv, { cwd, timeoutSeconds: check.timeoutSeconds, signal: tool.signal, logPath: join(dir, `${check.id}-${randomUUID()}.log`) } as Parameters<typeof runCommand>[1])
        let after: string
        try { after = fingerprint(cwd, ["."]) }
        catch (error) {
          data.state.evidence[check.id] = { passed: false, ...identity, fingerprint: null, code: result.code, logPath: result.logPath, outputTail: `Post-check evidence scope error: ${error}\n${result.output.slice(-800)}` }
          await persist(cwd, tool.sessionID, data)
          throw Error(`Post-check evidence scope error: ${error}. Call delivery_finish with status="blocked" and specific limitations.`)
        }
        const passed = result.code === 0 && !result.timedOut && !result.cancelled && !result.outputLimit && before === after
        data.state.evidence[check.id] = { passed, ...identity, executedRevision: data.state.revision, fingerprint: after, code: result.code, timedOut: result.timedOut, cancelled: result.cancelled, logPath: result.logPath, durationMs: result.durationMs, changedDuringCheck: before !== after, outputTail: result.output.slice(-1200) }
        results.push({ id: check.id, advisory: verification !== "required", ...data.state.evidence[check.id], outputTail: result.output })
        await persist(cwd, tool.sessionID, data)
      }
      const failures = results.filter(r => !r.passed && verification === "required")
      if (failures.length) throw Error(JSON.stringify({ failures, next: "Repair actual failures; do not weaken obligations." }))
      const hash = fingerprint(cwd, ["."]); const issues = completionIssues(data.state, cwd, hash)
      return text({ results, pendingChecks: pendingChecks(data.state, hash), completionIssues: issues, readyToFinish: Object.values(issues).every(items => !items.length), next: "Complete pending steps, review the evidence, then call delivery_finish." })
    }))
    add(editor, "delivery_review", "Inspect final diff or record assertion coverage, boundary probes and findings. Required for structured plans; assertions are model-authored.", O({ action: { type: "string", enum: ["inspect", "record"] }, captureId: short, coverage: A({ type: "object", additionalProperties: true }, 64), resolutions: A({ type: "object", additionalProperties: true }, 40), outcomes: A({ type: "object", additionalProperties: true }, 32), probes: A(short, 40), findings: A(short, 40), limitations: A(short) }, ["action"]), async (input, tool) => operate(tool.sessionID, async ({ cwd, data }) => {
      if (!data.state) throw Error("Call delivery_plan first")
      const result = input.action === "inspect" ? await captureDeliveryReview(data.state, cwd, runDirectory(cwd, tool.sessionID, data.state.runId), tool.signal) : input.action === "record" ? recordDeliveryReview(data.state, cwd, input) : (() => { throw Error("Review action must be inspect or record") })()
      await persist(cwd, tool.sessionID, data); return text(result)
    }))
    add(editor, "delivery_finish", "Finish delivery. Verified requires every required validator, fresh check, output, step, requirement and review gate; blocked requires specific limitations.", O({ status: { type: "string", enum: ["verified", "blocked"] }, review: short, launch: short, limitations: A(short) }), async (input, tool) => operate(tool.sessionID, async ({ cwd, data }) => {
      if (!data.state) throw Error("Call delivery_plan first")
      if (data.configError) throw Error(data.configError)
      const verification = verificationMode(data.state.plan); let hash: string | null = null
      if (input.status === "verified") {
        if (verification === "required") {
          hash = fingerprint(cwd, ["."])
          const issues = completionIssues(data.state, cwd, hash)
          if (Object.values(issues).some(items => items.length)) throw Error(`Cannot verify: ${JSON.stringify(issues)}`)
        } else { try { hash = fingerprint(cwd, ["."]) } catch { hash = null } }
      } else {
        if (!input.limitations.length) throw Error("Blocked delivery requires an explicit limitation/reason")
        try { hash = fingerprint(cwd, ["."]) } catch { hash = "unfingerprinted:scope_exceeded" }
      }
      const advisory = verification !== "required"
      const advisoryFailures = Object.entries(data.state.evidence).filter(([, value]) => !(value as { passed: boolean }).passed).map(([id]) => id)
      data.state.status = input.status; data.state.handoff = { ...input, verification, advisory, advisoryFailures, fingerprint: hash, at: new Date().toISOString(), evidence: structuredClone(data.state.evidence), reviewEvidence: structuredClone(data.state.reviewEvidence || null) }
      await persist(cwd, tool.sessionID, data)
      return text({ status: data.state.status, verification, advisory, advisoryFailures, note: advisory ? "Informational/advisory finish: recorded checks are context, not a delivery guarantee. Distinguish them from unperformed manual/visual review." : "Evidence covers declared checks, not a guarantee of correctness. Distinguish automated evidence from unperformed manual/visual review.", report: join(runDirectory(cwd, tool.sessionID, data.state.runId), "report.json") })
    }))
  }))

  registrations.push(await ctx.tool.hook("execute.before", async event => serialized(event.sessionID, async () => {
    if (typeof event.id !== "string" || !event.id) throw Error("Tool execution locked: host did not provide an authoritative call ID.")
    if (typeof event.messageID !== "string" || !event.messageID) throw Error("Tool execution locked: host did not provide an authoritative message ID.")
    // Include tool name because Code Mode's dispatcher and its nested tools can
    // share the outer call ID/message ID while still being distinct invocations.
    const callKey = `${event.sessionID}\0${event.messageID}\0${event.id}\0${event.tool}`
    if (admittedCalls.has(callKey)) return
    const { cwd, data, options: opts, active: selected } = await scope(event.sessionID)
    const active = selected && isShipAgent(event.agent)
    const toolName = localToolName(event.tool)
    if (toolName.startsWith("delivery_") && !active) throw Error("Delivery tools require Ship mode.")
    if (!active && Number(data.budget.limits.tools) === 0 && Number(data.budget.limits.seconds) === 0 && Number(data.budget.limits.repairs) === 0) return
    let persistenceAttempted = false
    try {
      const nativeShell = ["bash", "shell", "powershell"].includes(event.tool)
      const input = event.input && typeof event.input === "object" ? event.input as Record<string, unknown> : {}
      if (active && toolName === "delivery_status" && data.state) {
        let source
        try { source = fingerprint(cwd, ["."]) } catch (error) { source = String(error) }
        const key = JSON.stringify([data.state.runId, data.state.revision, source, data.state.evidence, data.state.stepStatus, data.state.reviewEvidence, data.state.planning, data.state.status])
        data.statusPoll = { key, count: data.statusPoll?.key === key ? data.statusPoll.count + 1 : 1 }
        if (data.statusPoll.count > 3) throw Error("Repeated unchanged delivery_status polling is blocked. Execute the next action or finish instead.")
      } else if (active && (toolName.startsWith("delivery_") || ["write", "edit", "patch"].includes(toolName))) data.statusPoll = undefined
      if (active && event.tool !== "execute" && requiresImplementationTool(toolName)) {
        if (!data.state) {
          data.discovery = discoveryEvent(data.discovery, "blocked")
          throw Error(`Implementation locked: call delivery_plan first (tool ${event.tool}). ${discoveryCheckpoint(data.discovery) || ""}`)
        }
        const release = lockWorkspace(cwd)
        try {
          const dir = runDirectory(cwd, event.sessionID, data.state.runId)
          assertActiveReport(cwd, join(dir, "report.json"))
          data.state = reconcileReport(join(dir, "report.json"), data.state)
          enforceToolPolicy(toolName, data.state, cwd)
          await persist(cwd, event.sessionID, data)
        } finally { release() }
      }
      if (active && (event.tool === "write" || event.tool === "edit") && typeof input.path === "string") {
        const path = input.path.replaceAll("\\", "/"), cwdPath = cwd.replaceAll("\\", "/").replace(/^\/+/, ""), name = basename(cwd)
        if ([cwdPath, name].some(prefix => path === prefix || path.startsWith(`${prefix}/`))) throw Error("Path recreates working directory inside itself; use a workspace-relative product path.")
        if (event.tool === "write" && data.initialFiles.includes(resolve(cwd, input.path))) throw Error(`Preserve existing ${input.path}; use focused edits.`)
      }
      const cap = Number(opts.bashCap) || 0
      if (active && nativeShell) {
        const command = String(input.command ?? "")
        const protection = shellProtection(command, opts.protectExisting ? data.initialFiles : [])
        if (protection) throw Error(protection)
        const capMilliseconds = cap * 1000
        if (cap > 0 && (typeof input.timeout !== "number" || input.timeout === 0 || input.timeout > capMilliseconds)) input.timeout = capMilliseconds
      }
      if (active && event.tool === "write" && opts.rewriteCap && Number(opts.rewriteCap) > 0) {
        data.writeCounts ||= {}
        const path = String(input.path || "")
        const count = data.writeCounts[path] || 0
        if (count >= Number(opts.rewriteCap)) throw Error(`Full-file rewrite limit reached for ${path}; preserve behavior and use focused edits.`)
        data.writeCounts[path] = count + 1
      }
      // execute.before is the authoritative per-invocation boundary, including
      // native shell, plugin tools, subagent dispatch, and Code Mode calls. It
      // carries sessionID/call ID; shell.create.before does not.
      if (!admittedCalls.has(callKey)) {
        const reason = budgetReason(data.budget, "tool")
        if (reason) {
          data.budget.stopped ||= reason
          persistenceAttempted = true
          await ctx.storage.set(sessionKey(event.sessionID), data)
          await ctx.session.interrupt({ sessionID: event.sessionID, resume: false })
          throw Error(`Delivery budget exhausted: ${reason}. Explicit delivery-budget-reset required.`)
        }
        data.budget.tools++
      }
      persistenceAttempted = true
      await ctx.storage.set(sessionKey(event.sessionID), data)
      admittedCalls.add(callKey)
    } catch (error) {
      // A policy rejection means no tool executes. Persist the observed state but
      // never leave a provisional shell claim behind for a later user command.
      if (!persistenceAttempted) await ctx.storage.set(sessionKey(event.sessionID), data)
      throw error
    }
  })))

  registrations.push(await ctx.tool.hook("execute.after", async event => serialized(event.sessionID, async () => {
    const { cwd, data, options: opts, active } = await scope(event.sessionID)
    if (!active || !isShipAgent(event.agent)) return
    const tool = localToolName(event.tool)
    const failed = event.status === "error"
    if (!failed && ["write", "edit", "patch"].includes(tool)) data.touched = true
    if (data.discovery.active && ["read", "ls", "glob", "find", "grep", "code_nav"].includes(tool)) data.discovery = discoveryEvent(data.discovery, "read")
    const rawContent = event.status === "error" ? event.error.message : event.result?.content
    const content = typeof rawContent === "string" ? [{ type: "text", text: rawContent }] : rawContent || []
    const diagnostic = probeDiagnostics(data.probeState as Parameters<typeof probeDiagnostics>[0], { toolName: tool === "shell" ? "bash" : tool, isError: failed, content })
    data.probeState = diagnostic.state
    const cap = Math.max(0, Number(opts.toolOutputCap) || 0)
    if (cap && event.status === "completed" && ["bash", "shell", "read", "grep", "glob", "find", "ls", "code_nav"].includes(tool)) {
      event.result = { ...event.result, content: (typeof event.result.content === "string" ? [{ type: "text" as const, text: event.result.content }] : event.result?.content || []).map(part => part.type === "text" && part.text.length > cap ? { ...part, text: `${part.text.slice(-cap)}\n[output capped at ${cap} characters; request a targeted slice]` } : part) }
    }
    if (diagnostic.message) {
      if (event.status === "completed") event.result = { ...event.result, content: [...(typeof event.result.content === "string" ? [{ type: "text" as const, text: event.result.content }] : event.result?.content || []), { type: "text", text: diagnostic.message }] }
      else event.error = new NativeToolError({ message: `${event.error.message}\n\n${diagnostic.message}` })
    }
    if (data.state && ["delivery_check", "delivery_progress", "delivery_review", "delivery_finish", "delivery_revise", "delivery_design", "delivery_plan"].includes(tool)) {
      const dir = runDirectory(cwd, event.sessionID, data.state.runId)
      const release = lockWorkspace(cwd)
      try {
        assertActiveReport(cwd, join(dir, "report.json"))
        data.state = reconcileReport(join(dir, "report.json"), data.state)
        writeFileSync(join(dir, "plan.d2"), planD2WithProgress(data.state.plan, data.state.stepStatus))
      } finally { release() }
    }
    if (event.status === "completed" && data.state && (tool === "execute" || tool.startsWith("delivery_"))) {
      event.result = { ...event.result, metadata: { ...event.result.metadata, deliveryPlan: planSnapshot(data.state) } }
    }
    await ctx.storage.set(sessionKey(event.sessionID), data)
    const delay = Math.min(30000, Math.max(0, Number(opts.turnDelayMs) || 0) * Math.max(1, Math.ceil((data.contextBytes || 0) / 4 / 50000)))
    if (delay) await new Promise(resolve => setTimeout(resolve, delay))
  })))

  registrations.push(await ctx.shell.hook("create.before", async event => {
    // Session-scoped policy, limits, and budget were handled at execute.before.
    // This hook intentionally does not attribute commands: 2.0.32 has no
    // authoritative source.sessionID/callID on ShellCreateBefore.
    const capMilliseconds = (Number(options.bashCap) || 0) * 1000
    if (capMilliseconds > 0 && (event.timeout === 0 || event.timeout > capMilliseconds)) event.timeout = capMilliseconds
    if (/\b(?:pkill|killall)\b|\bkill\s+(?:-\S+\s+)*(?:-1|0)(?:\s|$)/i.test(event.command)) throw Error("Broad process termination is prohibited; terminate only a captured child PID.")
  }))

  registrations.push(await ctx.session.hook("prompt", async event => serialized(event.sessionID, async () => {
    const { cwd, data, active } = await scope(event.sessionID)
    if (!active) return
    const prompt = originalTask(event.prompt.text)
    const routed = routeGuidance(prompt, { cwd, profiles })
    const prior = data.state && !["verified", "blocked"].includes(data.state.status) ? data.guidanceProfiles || data.state.guidanceProfiles || [] : []
    data.guidanceProfiles = [...new Set([...prior, ...routed.map(profile => profile.id)])]
    data.lastPrompt = prompt
    if (!data.state || ["verified", "blocked"].includes(data.state.status)) data.discovery = newDiscovery(!looksInformational(prompt))
    data.touched = false
    data.statusPoll = undefined
    await ctx.storage.set(sessionKey(event.sessionID), data)
  })))
  registrations.push(await ctx.session.hook("context", async event => serialized(event.sessionID, async () => {
    const { session, cwd, data, options: opts, active } = await scope(event.sessionID)
    const reason = budgetReason(data.budget)
    if (reason) {
      data.budget.stopped ||= reason
      await ctx.storage.set(sessionKey(event.sessionID), data)
      await ctx.session.interrupt({ sessionID: event.sessionID, resume: false })
      throw Error(`Delivery budget exhausted: ${reason}. Do not dispatch another model request until an explicit delivery-budget-reset.`)
    }
    if (!active || !isShipAgent(event.agent)) {
      if (event.tools) for (const name of Object.keys(event.tools)) if (localToolName(name).startsWith("delivery_")) delete event.tools[name]
      return
    }
    data.model = { providerID: event.model.providerID, id: event.model.id }
    let imageInput: boolean | undefined
    if (ctx.model) {
      const models = await ctx.model.list({ location: { directory: session.location.directory } })
      imageInput = models.data.find(model => model.providerID === event.model.providerID && model.id === event.model.id)?.capabilities.input.includes("image")
    }
    const activeProfiles = profiles.filter(profile => (data.guidanceProfiles || data.state?.guidanceProfiles || []).includes(profile.id))
    event.system.push({ type: "text", text: shipGuidance({ state: data.state, workflow: String(opts.workflow || "standard"), prompt: data.lastPrompt, profiles: activeProfiles, discovery: data.discovery, extraGuidance: data.extraGuidance, required: data.required, imageInput }) })
    if (data.budget.limits.tools || data.budget.limits.seconds || data.budget.limits.repairs) event.system.push({ type: "text", text: `Delivery budget: ${JSON.stringify(budgetSnapshot(data.budget))}. Reserve tools for verification/review/handoff; stop at exhaustion. Only the explicit delivery-budget-reset command authorizes a new budget.` })
    const checkpoint = discoveryCheckpoint(data.discovery)
    if (checkpoint) event.system.push({ type: "text", text: checkpoint })
    if (event.tools && !data.state) for (const name of Object.keys(event.tools)) if (requiresImplementationTool(name) && name !== "execute") delete event.tools[name]
    if (data.state && !["verified", "blocked"].includes(data.state.status)) {
      const dir = runDirectory(cwd, event.sessionID, data.state.runId)
      const archived = archiveDeliveryExchanges(event.messages, { cwd, directory: dir, allow: Boolean(data.state.planning?.approval) })
      event.messages = archived.messages
      const summary = deliveryRecovery(data.state, { report: join(dir, "report.json") })
      data.recovery ||= {}
      const records = recoveryMessages([], summary, data.recovery)
      const pressure = (data.contextBytes || 0) > 240000 ? "Context pressure: inspect the current recovery record and targeted source slices; avoid repeating whole captures." : ""
      event.system.push({ type: "text", text: `${records.map((record: { content: string }) => record.content).join("\n")}\nInspect freshness before execution/finish; readyToFinish means finish, not polling.\n${pressure}\n${archived.failed ? "Archive unavailable: affected originals retained." : ""}\n${deliveryPhaseGuidance(data.state)}` })
      try {
        const metrics = contextMetrics({ system: event.system, messages: event.messages })
        data.contextBytes = metrics.totalBytes
        appendFileSync(join(dir, "context-metrics.jsonl"), JSON.stringify(metrics) + "\n")
      } catch { /* Metrics are advisory, never an execution gate. */ }
      if (!data.state.planning?.approval && data.state.workflowMode !== "standard" && event.tools) for (const name of Object.keys(event.tools)) if (requiresImplementationTool(name) && name !== "execute") delete event.tools[name]
    }
    await ctx.storage.set(sessionKey(event.sessionID), data)
  })))
  registrations.push(await ctx.session.hook("compaction", async event => {
    const { data, active } = await scope(event.sessionID)
    if (!active || !isShipAgent(event.agent) || !data.state || ["verified", "blocked"].includes(data.state.status)) return
    event.system.push({ type: "text", text: JSON.stringify(deliveryRecovery(data.state, { report: join(runDirectory(data.cwd!, event.sessionID, data.state.runId), "report.json") })) })
  }))
  registrations.push(await ctx.command.transform(editor => {
    editor.add({ name: "delivery-budget-status", description: "Show this session's persistent delivery budget", execute: async ({ sessionID }) => {
      const { data } = await scope(sessionID)
      await ctx.session.synthetic({ sessionID, resume: false, metadata: { carthagentBudget: true }, text: `Delivery budget status: ${JSON.stringify(budgetSnapshot(data.budget))}` })
    } })
    editor.add({ name: "delivery-budget-reset", description: "Explicitly authorize a fresh budget for this session", execute: async ({ sessionID }) => {
      const snapshot = await serialized(sessionID, async () => {
        const { data, options: opts } = await scope(sessionID); clearTimeout(budgetTimers.get(sessionID)); budgetTimers.delete(sessionID); data.budget = newBudget(budgetLimits((name: string) => opts[limitOptions[name]] ?? opts[name] ?? "0")); await ctx.storage.set(sessionKey(sessionID), data)
        for (const key of admittedCalls) if (key.startsWith(`${sessionID}\0`)) admittedCalls.delete(key)
        return budgetSnapshot(data.budget)
      })
      await ctx.session.synthetic({ sessionID, resume: false, metadata: { carthagentBudget: true }, text: `Delivery budget explicitly reset: ${JSON.stringify(snapshot)}` })
    } })
  }))

  const abort = new AbortController()
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: abort.signal })) {
        if (event.type === "session.idle" && event.data?.sessionID) {
          const sessionID = event.data.sessionID
          let followup: string | undefined
          await serialized(sessionID, async () => {
            const { cwd, data, session, active } = await scope(sessionID)
            if (!active) return
            const reason = budgetReason(data.budget)
            if (reason && !data.budget.stopped) {
              data.budget.stopped = reason
              await ctx.storage.set(sessionKey(sessionID), data)
               await ctx.session.interrupt({ sessionID, resume: false })
              return
            }
            if (data.discovery.active) data.discovery = discoveryEvent(data.discovery, "blocked")
            const state = data.state
            if (!state || !shouldContinue({ state, touched: data.touched, nudges: data.nudges, stopReason: session.outcome === "succeeded" ? "stop" : "error", pendingMessages: false, fresh: false })) {
              await ctx.storage.set(sessionKey(sessionID), data)
              return
            }
            const release = lockWorkspace(cwd)
            try {
              const dir = runDirectory(cwd, sessionID, state.runId)
              assertActiveReport(cwd, join(dir, "report.json"))
              data.state = reconcileReport(join(dir, "report.json"), state)
              const hash = fingerprint(cwd, ["."])
              const issues = completionIssues(data.state, cwd, hash)
              const fresh = data.state.handoff?.fingerprint === hash
              if (fresh || !Object.values(issues).some(items => items.length)) {
                await ctx.storage.set(sessionKey(sessionID), data)
                return
              }
              const repairReason = budgetReason(data.budget, "repair")
              if (repairReason) {
                data.budget.stopped = repairReason
                await ctx.storage.set(sessionKey(sessionID), data)
                await ctx.session.interrupt({ sessionID, resume: false })
                return
              }
              data.budget.repairs++
              data.nudges++
              const pending = issues.pendingChecks.join(", ") || "none"
              await ctx.storage.set(sessionKey(sessionID), data)
              const failures = Object.entries(data.state.evidence || {}).filter(([, e]) => !(e as { passed: boolean }).passed).map(([id, e]) => {
                const evidence = e as { code: number; outputTail?: string }
                return `${id}: exit ${evidence.code}\n${evidence.outputTail || ""}`
              }).join("\n")
              followup = `${failures}\nDelivery follow-up ${data.nudges}/2: the required contract has no fresh verified handoff. Pending checks: ${pending}. Inspect current delivery_status, repair the actual cause, rerun checks and finish verified, or record status=blocked with specific limitations. Do not repeat a success claim or weaken obligations.`
            } catch (error) {
              console.error("Carthagent delivery recovery failed closed", error)
            } finally { release() }
          })
          if (followup) await ctx.session.prompt({ sessionID, metadata: { carthagentRecovery: true }, text: followup, delivery: "steer" })
          for (const key of admittedCalls) if (key.startsWith(`${sessionID}\0`)) admittedCalls.delete(key)
        }
      }
    } catch (error) { if (!abort.signal.aborted) console.error("Carthagent delivery event subscription failed", error) }
  })()
  return async () => {
    if (disposed) return
    disposed = true; abort.abort()
    admittedCalls.clear()
    for (const timer of budgetTimers.values()) clearTimeout(timer)
    budgetTimers.clear()
    await Promise.all(registrations.map(registration => registration.dispose()))
    serial.clear()
  }
}

function requiresImplementationTool(name: string) {
  // V2 exposes namespaced tools as `namespace_name` in model context and hooks.
  const toolName = name.startsWith("carthagent_") ? name.slice("carthagent_".length) : name
  return toolName !== "execute" && !["delivery-budget-status", "delivery-budget-reset"].includes(toolName) && requiresPlanApproval(toolName)
}

function planSnapshot(state: SessionState["state"]) {
  const items = planSteps(state.plan).map((step: { id: string; title: string }, i: number) => ({ id: step.id, content: step.title, status: state.stepStatus[`step${i}`] || "pending" }))
  return { runId: state.runId, revision: state.revision, status: state.status, items }
}
