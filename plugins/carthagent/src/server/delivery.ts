import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { DELIVERY_INVARIANTS, TEST_INFRASTRUCTURE_GUIDANCE, deliveryPhaseGuidance } from "../../../../lib/delivery-guidance.mjs"
import { deliveryRecovery, designReceipt, archivalGroups, replaceArchivedGroups, recoveryMessages } from "../../../../lib/delivery-context.mjs"
import { archiveContext } from "../../../../lib/context-archive.mjs"
import { validatePlanning, inspectPlanning, recordPlanReview, approvePlanning, planningStatus, startImplementation } from "../../../../lib/planning.mjs"
import { PLANNING_START, planningGuide, planningNext } from "../../../../lib/planning-guide.mjs"
import { newDiscovery, restoreDiscovery, discoveryCheckpoint, discoveryEvent } from "../../../../lib/planning-discovery.mjs"
import { budgetLimits, newBudget, budgetReason, budgetSnapshot } from "../../../../lib/budget.mjs"
import { validatePlan, fingerprint, runCommand, pendingChecks, validateRevision, bindRequiredChecks, loadRequiredChecks, updateStepStatus, verificationMode, looksInformational, revisePlan, mergePlanPatch, completionIssues, planSteps, pendingRequirements, planD2WithProgress, evidenceIdentity } from "../../../../lib/delivery.mjs"
import { captureDeliveryReview, recordDeliveryReview } from "../../../../lib/delivery-review.mjs"
import { formatGuidance, loadGuidanceProfiles, routeGuidance } from "../../../../lib/guidance.mjs"
import { saveReport, reconcileReport } from "../../../../lib/reports.mjs"
import { lockWorkspace, selectReport, assertActiveReport, activeReportPath } from "../../../../lib/workspace.mjs"
import { enforceToolPolicy, policyDescription } from "./policy.ts"

type SessionState = { state: any; discovery: any; nudges: number; touched: boolean; budget: any; required: any[]; configError?: string; extraGuidance?: string; initialFiles: string[]; lastPrompt?: string; guidance?: string; writeCounts?: Record<string, number>; outcome?: string; cwd?: string }
type DeliveryOptions = Record<string, unknown>

const S = (description?: string) => ({ type: "string", minLength: 1, maxLength: 1200, ...(description ? { description } : {}) })
const A = (items: any, maxItems = 20) => ({ type: "array", items, maxItems })
const O = (properties: Record<string, any>, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false })
const optional = (schema: any) => schema
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
export async function registerDelivery(ctx: any, options: DeliveryOptions = {}) {
  const registrations: Array<{ dispose(): Promise<void> }> = []
  const serial = new Map<string, Promise<unknown>>()
  const budgetTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const profiles = loadGuidanceProfiles()
  let disposed = false
  const limitOptions: Record<string, string> = { "delivery-max-tools": "maxTools", "delivery-max-seconds": "maxSeconds", "delivery-max-repairs": "maxRepairs" }
  const limits = budgetLimits((name) => options[limitOptions[name]] ?? options[name] ?? "0")
  const workflowOption = options.workflow === "standard" ? "standard" : "strict"

  async function scope(sessionID: string) {
    if (!sessionID) throw Error("OpenCode sessionID is required")
    const session = await ctx.session.get({ sessionID })
    const cwd = session.location?.directory
    if (typeof cwd !== "string" || !cwd) throw Error(`OpenCode session ${sessionID} has no worktree location`)
    const saved = await ctx.storage.get(sessionKey(sessionID)) as SessionState | undefined
    const data: SessionState = saved ? structuredClone(saved) : { state: null, discovery: newDiscovery(), nudges: 0, touched: false, budget: null, required: [], initialFiles: [] }
    data.cwd = cwd
    data.outcome = session.outcome
    data.discovery = restoreDiscovery(data.discovery)
    if (data.state) {
      const dir = runDirectory(cwd, sessionID, data.state.runId)
      data.state = reconcileReport(join(dir, "report.json"), data.state)
    }
    if (!data.budget) data.budget = newBudget(limits)
    if (data.budget.limits.seconds && !budgetTimers.has(sessionID) && !data.budget.stopped) {
      const remaining = Math.max(1, data.budget.startedAt + data.budget.limits.seconds * 1000 - Date.now())
      const timer = setTimeout(() => {
        void (async () => {
          const latest = await scope(sessionID)
          if (!latest.data.budget.stopped) {
            latest.data.budget.stopped = "elapsed-time"
            await ctx.storage.set(sessionKey(sessionID), latest.data)
            await ctx.session.interrupt({ sessionID, continue: false })
          }
        })().catch(error => console.error("Carthagent delivery budget stop failed", error))
      }, remaining)
      timer.unref?.(); budgetTimers.set(sessionID, timer)
    }
    if (!data.required.length) {
      const explicit = typeof options.validators === "string" ? options.validators : undefined
      const projectManifest = join(cwd, ".carthagent", "delivery.json")
      const manifest = explicit ? resolve(cwd, explicit) : existsSync(projectManifest) ? projectManifest : undefined
      try { if (manifest) data.required = loadRequiredChecks(manifest, cwd) }
      catch (error) { data.configError = `Invalid required validators: ${error}` }
      if (typeof options.context === "string") {
        try { data.extraGuidance = readFileSync(resolve(cwd, options.context), "utf8") }
        catch (error) { data.configError = `Invalid delivery context: ${error}` }
      }
      if (options.protectExisting) data.initialFiles = readdirSync(cwd, { withFileTypes: true }).filter((e: any) => e.isFile()).map((e: any) => resolve(cwd, e.name))
    }
    if (data.state && data.required.length) {
      for (const check of data.required) {
        const old = data.state.plan.checks.find((c: any) => c.id === check.id)
        if (JSON.stringify(old) !== JSON.stringify(check)) delete data.state.evidence[check.id]
      }
      data.state.plan = bindRequiredChecks(data.state.plan, data.required)
    }
    return { session, cwd, data }
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
  const add = (editor: any, name: string, description: string, input: any, execute: (input: any, toolContext: any) => Promise<any>) => editor.add({ name, description, input, execute })

  registrations.push(await ctx.tool.transform((editor: any) => {
    editor.namespace?.({ name: "carthagent", description: "Evidence-driven CTG delivery workflow tools" })
    add(editor, "delivery_plan", "Create the durable acceptance contract and plan.d2. Informational asks may use verification none/advisory; product changes require fresh checks.", planSchema, async (input, tool) => operate(tool.sessionID, async ({ cwd, data }) => {
      if (data.configError) throw Error(data.configError)
      const plan = validatePlan(bindRequiredChecks({ ...input, verification: input.verification ?? "required" }, data.required), cwd)
      validateRevision(data.state, plan)
      if (data.state && !["verified", "blocked"].includes(data.state.status)) data.state = revisePlan(data.state, plan, { cwd, hash: fingerprint(cwd, ["."]), reason: "Active plan replaced via delivery_plan" })
      else data.state = { version: 1, workflowMode: workflowOption, reviewRequired: workflowOption === "standard", runId: randomUUID(), revision: (data.state?.revision || 0) + 1, plan, evidence: {}, status: "implementing", createdAt: new Date().toISOString(), stepStatus: {} }
      data.discovery = newDiscovery(); const dir = runDirectory(cwd, tool.sessionID, data.state.runId)
      mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "plan.d2"), planD2WithProgress(data.state.plan, data.state.stepStatus))
      await persist(cwd, tool.sessionID, data)
      return text({ plan: join(dir, "plan.d2"), report: join(dir, "report.json"), next: workflowOption === "standard" ? "Contract accepted; implement, verify all checks, review and finish." : "No code or commands yet. Validate, inspect, adversarially review, then approve the design." })
    }, true))
    add(editor, "delivery_probe", "Bounded pre-plan version probe only; other APIs can be inspected with read.", O({ kind: { type: "string", enum: ["node-version", "npm-version"] } }), async (input, tool) => {
      const { cwd } = await scope(tool.sessionID)
      const argv = input.kind === "node-version" ? [process.execPath, "--version"] : [process.platform === "win32" ? "npm.cmd" : "npm", "--version"]
      return text({ ...(await runCommand(argv, { cwd, signal: tool.signal, timeoutSeconds: 10 })), evidence: false })
    })
    add(editor, "delivery_revise", "Revise the current task with a reason and partial patch. Existing obligations and verification history cannot be removed.", O({ reason: short, patch: { type: "object", additionalProperties: true } }), async (input, tool) => operate(tool.sessionID, async ({ cwd, data }) => {
      if (!data.state) throw Error("Call delivery_plan first")
      const hash = fingerprint(cwd, ["."])
      data.state = revisePlan(data.state, bindRequiredChecks(mergePlanPatch(data.state.plan, input.patch), data.required), { cwd, reason: input.reason, hash })
      await persist(cwd, tool.sessionID, data)
      return text({ revision: data.state.revision, pendingChecks: pendingChecks(data.state, hash), unverifiedRequirements: pendingRequirements(data.state, hash), next: data.state.workflowMode === "standard" ? "Continue implementation; changed checks require fresh evidence." : "Revision relocks implementation; validate and re-approve." })
    }))
    add(editor, "delivery_design", "Strict workflow design gate. Guide, validate, inspect, adversarially review every scenario, then approve. Review is model-authored, not independent proof.", O({ action: { type: "string", enum: ["guide", "validate", "inspect", "review", "approve"] }, captureId: short, review: { type: "object", additionalProperties: true } }, ["action"]), async (input, tool) => {
      if (input.action === "guide") return text(planningGuide())
      return operate(tool.sessionID, async ({ cwd, data }) => {
        if (!data.state) throw Error("Call delivery_plan first")
        const hash = fingerprint(cwd, ["."]); let result: any
        if (input.action === "validate") result = validatePlanning(data.state, hash)
        else if (input.action === "inspect") result = inspectPlanning(data.state, hash)
        else if (input.action === "review") result = recordPlanReview(data.state, hash, { ...input.review, captureId: input.review?.captureId ?? input.captureId })
        else if (input.action === "approve") result = approvePlanning(data.state, hash)
        else throw Error("Unknown delivery_design action")
        await persist(cwd, tool.sessionID, data)
        return text({ result: designReceipt(input.action, result), ...(input.action === "inspect" ? { captureId: result.id } : {}), ...(input.action === "validate" ? planningNext(data.state, result) : {}), planningStatus: planningStatus(data.state, hash) })
      })
    })
    add(editor, "delivery_status", "Show delivery state, stale/failed checks and next action. Call finish instead of polling when readyToFinish is true.", empty, async (_input, tool) => operate(tool.sessionID, async ({ cwd, data }) => {
      if (!data.state) return text("No delivery contract.")
      const dir = runDirectory(cwd, tool.sessionID, data.state.runId); const hash = fingerprint(cwd, ["."])
      const issues = completionIssues(data.state, cwd, hash); const readyToFinish = Object.values(issues).every((items: any) => !items.length)
      return text({ ...deliveryRecovery(data.state, { report: join(dir, "report.json") }), pendingChecks: pendingChecks(data.state, hash), completionIssues: issues, readyToFinish, next: readyToFinish ? "Call delivery_finish; do not poll again." : "Run declared checks, complete steps/outputs, and resolve outstanding requirements." })
    }))
    add(editor, "delivery_progress", "Update implementation step progress and regenerate the plan diagram.", O({ step: { anyOf: [{ type: "integer", minimum: 0 }, short] }, status: { type: "string", enum: ["active", "done", "failed", "pending"] }, note: short }, ["step", "status"]), async (input, tool) => operate(tool.sessionID, async ({ cwd, data }) => {
      if (!data.state) throw Error("Call delivery_plan first")
      const step = planSteps(data.state.plan).find((s: any, i: number) => typeof input.step === "string" ? s.id === input.step : i === input.step)
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
      const selected = input.id === "all" ? data.state.plan.checks : data.state.plan.checks.filter((c: any) => c.id === input.id)
      if (!selected.length) throw Error("Unknown check ID; use delivery_status or id=all")
      const results = []
      for (const check of selected) {
        if (tool.signal.aborted) throw Error("Check cancelled before execution")
        const identity = evidenceIdentity(data.state, check); data.state.status = "verifying"; data.state.verificationStarted = true; delete data.state.evidence[check.id]
        const before = fingerprint(cwd, ["."]); await persist(cwd, tool.sessionID, data)
        const dir = runDirectory(cwd, tool.sessionID, data.state.runId)
        const result = await runCommand(check.argv, { cwd, timeoutSeconds: check.timeoutSeconds, signal: tool.signal, logPath: join(dir, `${check.id}-${randomUUID()}.log`) })
        const after = fingerprint(cwd, ["."]); const passed = result.code === 0 && !result.timedOut && !result.cancelled && !result.outputLimit && before === after
        data.state.evidence[check.id] = { passed, ...identity, executedRevision: data.state.revision, fingerprint: after, code: result.code, timedOut: result.timedOut, cancelled: result.cancelled, logPath: result.logPath, durationMs: result.durationMs, changedDuringCheck: before !== after, outputTail: result.output.slice(-1200) }
        results.push({ id: check.id, advisory: verification !== "required", ...data.state.evidence[check.id], outputTail: result.output })
        await persist(cwd, tool.sessionID, data)
      }
      const failures = results.filter((r: any) => !r.passed && verification === "required")
      if (failures.length) throw Error(JSON.stringify({ failures, next: "Repair actual failures; do not weaken obligations." }))
      const hash = fingerprint(cwd, ["."]); const issues = completionIssues(data.state, cwd, hash)
      return text({ results, pendingChecks: pendingChecks(data.state, hash), completionIssues: issues, readyToFinish: Object.values(issues).every((items: any) => !items.length) })
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
        hash = fingerprint(cwd, ["."])
        if (verification === "required") {
          const issues = completionIssues(data.state, cwd, hash)
          if (Object.values(issues).some((items: any) => items.length)) throw Error(`Cannot verify: ${JSON.stringify(issues)}`)
        }
      } else {
        if (!input.limitations.length) throw Error("Blocked delivery requires an explicit limitation/reason")
        try { hash = fingerprint(cwd, ["."]) } catch { hash = "unfingerprinted:scope_exceeded" }
      }
      data.state.status = input.status; data.state.handoff = { ...input, verification, advisory: verification !== "required", fingerprint: hash, at: new Date().toISOString(), evidence: structuredClone(data.state.evidence), reviewEvidence: data.state.reviewEvidence || null }
      await persist(cwd, tool.sessionID, data); return text({ status: data.state.status, verification, report: join(runDirectory(cwd, tool.sessionID, data.state.runId), "report.json") })
    }))
  }))

  registrations.push(await ctx.tool.hook("execute.before", async (event: any) => {
    const { cwd, data } = await scope(event.sessionID)
    const reason = budgetReason(data.budget, "tool")
    if (reason) throw Error(`Delivery budget exhausted: ${reason}. Explicit delivery-budget-reset required.`)
    data.budget.tools++
    const input = event.input && typeof event.input === "object" ? event.input as Record<string, any> : {}
    if (requiresImplementationTool(event.tool)) {
      if (!data.state) throw Error(`Implementation locked: call delivery_plan first (tool ${event.tool}).`)
      const release = lockWorkspace(cwd)
      try {
        const dir = runDirectory(cwd, event.sessionID, data.state.runId)
        assertActiveReport(cwd, join(dir, "report.json"))
        data.state = reconcileReport(join(dir, "report.json"), data.state)
        enforceToolPolicy(event.tool, data.state, cwd)
        await persist(cwd, event.sessionID, data)
      } finally { release() }
    }
    if ((event.tool === "write" || event.tool === "edit") && typeof input.path === "string") {
      const path = input.path.replaceAll("\\", "/"), cwdPath = cwd.replaceAll("\\", "/").replace(/^\/+/, ""), name = basename(cwd)
      if ([cwdPath, name].some(prefix => path === prefix || path.startsWith(`${prefix}/`))) throw Error("Path recreates working directory inside itself; use a workspace-relative product path.")
      if (event.tool === "write" && data.initialFiles.includes(resolve(cwd, input.path))) throw Error(`Preserve existing ${input.path}; use focused edits.`)
    }
    const cap = Number(options.bashCap) || 0
    if (event.tool === "bash" || event.tool === "shell" || event.tool === "powershell") {
      const command = String(input.command ?? "")
      if (/\b(?:pkill|killall)\b|\bkill\s+(?:-\S+\s+)*(?:-1|0)(?:\s|$)/i.test(command)) throw Error("Broad process termination is prohibited; terminate only a captured child PID.")
      if (cap > 0 && (typeof input.timeout !== "number" || input.timeout > cap)) input.timeout = cap
    }
    if (event.tool === "write" && options.rewriteCap && Number(options.rewriteCap) > 0) {
      data.writeCounts ||= {}
      const path = String(input.path || "")
      const count = data.writeCounts[path] || 0
      if (count >= Number(options.rewriteCap)) throw Error(`Full-file rewrite limit reached for ${path}; preserve behavior and use focused edits.`)
      data.writeCounts[path] = count + 1
    }
    await ctx.storage.set(sessionKey(event.sessionID), data)
  }))

  registrations.push(await ctx.tool.hook("execute.after", async (event: any) => {
    const { cwd, data } = await scope(event.sessionID)
    const failed = event.status === "error"
    if (!failed && ["write", "edit"].includes(event.tool)) data.touched = true
    if (data.discovery.active && ["read", "ls", "find", "grep", "code_nav"].includes(event.tool)) data.discovery = discoveryEvent(data.discovery, "read")
    if (data.state && ["delivery_check", "delivery_progress", "delivery_review", "delivery_finish", "delivery_revise", "delivery_design", "delivery_plan"].includes(event.tool)) {
      const dir = runDirectory(cwd, event.sessionID, data.state.runId)
      if (existsSync(join(dir, "report.json"))) data.state = reconcileReport(join(dir, "report.json"), data.state)
    }
    const outputCap = Math.max(0, Number(options.toolOutputCap) || 0)
    if (!failed && outputCap > 0 && event.result?.content) {
      event.result.content = event.result.content.map((item: any) => {
        if (item.type !== "text" || item.text.length <= outputCap) return item
        const marker = `\n...[${item.text.length - outputCap} chars omitted; rerun a narrower command]...\n`
        const head = Math.floor(Math.max(0, outputCap - marker.length) / 3)
        const tail = Math.max(0, outputCap - marker.length - head)
        return { ...item, text: outputCap <= marker.length ? item.text.slice(0, outputCap) : item.text.slice(0, head) + marker + item.text.slice(-tail) }
      })
    }
    await ctx.storage.set(sessionKey(event.sessionID), data)
  }))

  registrations.push(await ctx.shell.hook("create.before", async (event: any) => {
    // V2's shell hook has no session ID. Resolve the exact active run through
    // the existing .harness active-report pointer, never through a global
    // current-session variable or latest-mtime guess.
    const activeReport = activeReportPath(event.cwd)
    if (!activeReport) throw Error("Shell execution locked: create a delivery plan in this worktree first.")
    const relativeReport = activeReport.slice(resolve(event.cwd, ".harness").length + 1).split(/[\\/]/)
    const sessionID = relativeReport[0]
    const entries = await ctx.storage.scan({ prefix: `session/${sessionID}`, limit: 10 })
    const candidate = entries.entries.find((entry: any) => entry.key === sessionKey(sessionID) && entry.value?.cwd === event.cwd)
    if (!candidate) throw Error("Shell execution locked: the active report has no matching OpenCode session state.")
    const { cwd, data } = await scope(sessionID)
    const reason = budgetReason(data.budget, "tool")
    if (reason) throw Error(`Delivery budget exhausted: ${reason}. Explicit delivery-budget-reset required.`)
    if (!data.state) throw Error("Shell execution locked: call delivery_plan first.")
    const release = lockWorkspace(cwd)
    try {
      const dir = runDirectory(cwd, sessionID, data.state.runId)
      assertActiveReport(cwd, join(dir, "report.json"))
      data.state = reconcileReport(join(dir, "report.json"), data.state)
      enforceToolPolicy("shell", data.state, cwd)
      const cap = Number(options.bashCap) || 0
      if (cap > 0 && event.timeout > cap) event.timeout = cap
      if (/\b(?:pkill|killall)\b|\bkill\s+(?:-\S+\s+)*(?:-1|0)(?:\s|$)/i.test(event.command)) throw Error("Broad process termination is prohibited; terminate only a captured child PID.")
      data.budget.tools++
      await persist(cwd, sessionID, data)
    } finally { release() }
  }))

  for (const kind of ["context", "compaction"] as const) registrations.push(await ctx.session.hook(kind, async (event: any) => {
    const { cwd, data } = await scope(event.sessionID)
    // Prevent bypass through built-in shell/edit, plugin and child-session tools,
    // and Code Mode while the participating-tool policy is locked. Runtime hooks
    // still repeat the check at invocation time; hiding a model tool is not the
    // authorization boundary by itself.
    const locked = !data.state || planningStatus(data.state, fingerprint(cwd, ["."])).locked
    if (locked && event.tools && typeof event.tools === "object") {
      for (const name of Object.keys(event.tools)) if (requiresImplementationTool(name)) delete event.tools[name]
    }
    if (!data.state || ["verified", "blocked"].includes(data.state.status)) {
      const checkpoint = discoveryCheckpoint(data.discovery)
      if (checkpoint) event.system.push({ type: "text", text: checkpoint })
      return
    }
    const dir = runDirectory(cwd, event.sessionID, data.state.runId)
    const recovery = deliveryRecovery(data.state, { report: join(dir, "report.json"), planningStatus: planningStatus(data.state, fingerprint(cwd, ["."])) })
    const checkpoint = recoveryMessages([], recovery).map(message => message.content).join("\n")
    event.system.push({ type: "text", text: `${data.guidance || DELIVERY_INVARIANTS}\n\nCurrent delivery recovery record (not authorization; recompute freshness before checks/finish):\n${checkpoint}\n\n${deliveryPhaseGuidance(data.state)}` })
  }))

  registrations.push(await ctx.session.hook("prompt", async (event: any) => {
    const { cwd, data } = await scope(event.sessionID)
    const workflow = data.state && !["verified", "blocked"].includes(data.state.status) ? data.state.workflowMode : workflowOption
    const routed = routeGuidance(event.prompt.text, { cwd, profiles })
    let guidance = DELIVERY_INVARIANTS + "\n" + deliveryPhaseGuidance(data.state) + "\n" + policyDescription(workflow)
    if (workflow === "standard") guidance += "\nA valid required plan allows implementation; final evidence and review stay mandatory."
    if (/\b(test|typescript|route|backend|api)\b/i.test(event.prompt.text)) guidance += `\n${TEST_INFRASTRUCTURE_GUIDANCE}`
    if (data.discovery.active && workflow === "strict") guidance += `\n${PLANNING_START}`
    const routedText = formatGuidance(routed); if (routedText) guidance += `\n${routedText}`
    if (data.extraGuidance) guidance += `\nTask-specific delivery context:\n${data.extraGuidance}`
    if (data.required.length) guidance += `\nUser-owned required validators are enforced: ${JSON.stringify(data.required)}. Run every required check; do not bypass.`
    if (looksInformational(event.prompt.text)) guidance += `\nReceipt check: informational/read-only ask; answer directly or use verification none/advisory. Do not enter a repair loop.`
    data.lastPrompt = event.prompt.text
    data.guidance = `${guidance}\n\n${data.state ? deliveryRecovery(data.state, { report: join(runDirectory(cwd, event.sessionID, data.state.runId), "report.json") }) ? "Existing delivery state remains authoritative; do not trust summary claims over current report/fingerprint." : "" : ""}`
    const internal = event.metadata?.carthagentRecovery === true || event.metadata?.carthagentBudget === true
    if (!internal) { data.discovery = newDiscovery(!looksInformational(event.prompt.text)); data.nudges = 0; data.touched = false }
    await ctx.storage.set(sessionKey(event.sessionID), data)
  }))

  registrations.push(await ctx.command.transform((editor: any) => {
    editor.add({ name: "delivery-budget-status", description: "Show this session's persistent delivery budget", execute: async ({ sessionID }: any) => {
      const { data } = await scope(sessionID)
      await ctx.session.prompt({ sessionID, delivery: "steer", metadata: { carthagentBudget: true }, text: `Delivery budget status: ${JSON.stringify(budgetSnapshot(data.budget))}` })
    } })
    editor.add({ name: "delivery-budget-reset", description: "Explicitly authorize a fresh budget for this session", execute: async ({ sessionID }: any) => {
      const { data } = await scope(sessionID); clearTimeout(budgetTimers.get(sessionID)); budgetTimers.delete(sessionID); data.budget = newBudget(limits); await ctx.storage.set(sessionKey(sessionID), data)
      await ctx.session.prompt({ sessionID, delivery: "steer", metadata: { carthagentBudget: true }, text: `Delivery budget explicitly reset: ${JSON.stringify(budgetSnapshot(data.budget))}` })
    } })
  }))

  const abort = new AbortController()
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: abort.signal })) {
        if (event.type === "session.idle" && event.data?.sessionID) {
          const sessionID = event.data.sessionID
          await serialized(sessionID, async () => {
            const { cwd, data, session } = await scope(sessionID)
            const reason = budgetReason(data.budget)
            if (reason && !data.budget.stopped) {
              data.budget.stopped = reason
              await ctx.storage.set(sessionKey(sessionID), data)
              await ctx.session.interrupt({ sessionID, continue: false })
              return
            }
            if (data.discovery.active) data.discovery = discoveryEvent(data.discovery, "blocked")
            const state = data.state
            if (!state || data.nudges >= 2 || ["verified", "blocked"].includes(state.status) || !data.touched || verificationMode(state.plan) !== "required" || session.outcome !== "succeeded") {
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
              if (fresh || !Object.values(issues).some((items: any) => items.length)) {
                await ctx.storage.set(sessionKey(sessionID), data)
                return
              }
              const repairReason = budgetReason(data.budget, "repair")
              if (repairReason) {
                data.budget.stopped = repairReason
                await ctx.storage.set(sessionKey(sessionID), data)
                await ctx.session.interrupt({ sessionID, continue: false })
                return
              }
              data.budget.repairs++
              data.nudges++
              const pending = issues.pendingChecks.join(", ") || "none"
              await ctx.storage.set(sessionKey(sessionID), data)
              await ctx.session.prompt({
                sessionID,
                metadata: { carthagentRecovery: true },
                text: `Delivery follow-up ${data.nudges}/2: the required contract has no fresh verified handoff. Pending checks: ${pending}. Inspect current delivery_status, repair the actual cause, rerun checks and finish verified, or record status=blocked with specific limitations. Do not repeat a success claim or weaken obligations.`,
                delivery: "steer",
              })
            } catch (error) {
              console.error("Carthagent delivery recovery failed closed", error)
            } finally { release() }
          })
        }
      }
    } catch (error) { if (!abort.signal.aborted) console.error("Carthagent delivery event subscription failed", error) }
  })()
  return async () => {
    if (disposed) return
    disposed = true; abort.abort()
    for (const timer of budgetTimers.values()) clearTimeout(timer)
    budgetTimers.clear()
    await Promise.all(registrations.map(registration => registration.dispose()))
    serial.clear()
  }
}

function requiresImplementationTool(name: string) {
  return !["read", "ls", "find", "grep", "code_nav", "delivery_probe", "delivery_plan", "delivery_revise", "delivery_design", "delivery_status", "delivery_finish", "delivery-budget-status", "delivery-budget-reset"].includes(name)
}
