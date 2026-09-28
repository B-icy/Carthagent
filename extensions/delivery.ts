import { validatePlanning, recordPlanReview, approvePlanning, planningStatus, startImplementation } from '../lib/planning.mjs';
import { needsImplementation } from '../lib/planning-access.mjs';
import { budgetLimits, newBudget, budgetReason, budgetSnapshot } from '../lib/budget.mjs';
import { CONFIG_DIR_NAME, truncateTail, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { lockWorkspace, selectReport, assertActiveReport } from '../lib/workspace.mjs';
import { saveReport, reconcileReport } from '../lib/reports.mjs';
import { evidenceIdentity, validatePlan, planD2WithProgress, fingerprint, runCommand, pendingChecks, restoreState, shouldContinue, localPath, createSerialQueue, validateRevision, bindRequiredChecks, loadRequiredChecks, updateStepStatus, verificationMode, looksInformational, revisePlan, completionIssues, planSteps, validatePlanPatch, pendingRequirements } from '../lib/delivery.mjs';
import { captureDeliveryReview, recordDeliveryReview } from '../lib/delivery-review.mjs';
import { formatGuidance, loadGuidanceProfiles, routeGuidance } from '../lib/guidance.mjs';

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const BROWSER_CHECK = join(EXTENSION_DIR, '..', 'tools', 'browser-check.mjs');
const BROWSER_CHECK_GUIDANCE = existsSync(BROWSER_CHECK)
  ? `\nFor web/browser tasks, a self-contained browser check is available: ${JSON.stringify(BROWSER_CHECK)}. Declare it as a runtime check, e.g. ["node","${BROWSER_CHECK}","--page","index.html","--assert","#app","--assert-count","#items:3","--click","#btn","--then-text","#out:done","--console-clean","--screenshot","artifacts/ui.png"]. It serves the workspace over HTTP, runs jsdom assertions with real inline-script execution (clicks, text, selectors, console-error detection), and captures a real Firefox screenshot when Firefox is installed — no external downloads needed.`
  : '';

const text = (value: unknown) => {
  const output = truncateTail(typeof value === 'string' ? value : JSON.stringify(value, null, 2), { maxBytes: 48000, maxLines: 1000 });
  return { content: [{ type: 'text' as const, text: output.content + (output.truncated ? '\n[Output truncated; full check output is in the recorded log files.]' : '') }], details: {} };
};
type JsonSchema = Record<string, unknown>;
const optionalSchemas = new WeakSet<JsonSchema>();
const Type = {
  String: (options: JsonSchema = {}): JsonSchema => ({ type: 'string', ...options }),
  Integer: (options: JsonSchema = {}): JsonSchema => ({ type: 'integer', ...options }),
  Union: (schemas: JsonSchema[]): JsonSchema => ({ anyOf: schemas }),
  Partial: (schema: JsonSchema): JsonSchema => { const copy = { ...schema }; delete copy.required; return copy; },
  Array: (items: JsonSchema, options: JsonSchema = {}): JsonSchema => ({ type: 'array', items, ...options }),
  Optional: (schema: JsonSchema): JsonSchema => { optionalSchemas.add(schema); return schema; },
  Object: (properties: Record<string, JsonSchema>, options: JsonSchema = {}): JsonSchema => {
    const required = Object.entries(properties).filter(([, schema]) => !optionalSchemas.has(schema)).map(([name]) => name);
    return { type: 'object', ...(required.length ? { required } : {}), properties, ...options };
  },
};
const shortString = () => Type.String({ minLength: 1, maxLength: 1200 });
const strings = (maxItems = 20) => Type.Array(shortString(), { minItems: 1, maxItems });
const planFields = {
  design: Type.Optional({ type: 'object', description: 'Tested architecture: components, ports, scenarios, risks. See docs/tested-planning-roadmap.md for field contracts.', additionalProperties: true }),
  workflow: Type.Optional({ type: 'object', additionalProperties: true }),
  goal: shortString(), assumptions: Type.Array(shortString(), { maxItems: 20 }),
  artifacts: strings(40), outputs: Type.Optional(Type.Array(shortString(), { maxItems: 40 })),
  steps: Type.Array(Type.Union([shortString(), Type.Object({
    id: Type.String({ pattern: '^[a-z][a-z0-9_-]{0,39}$' }), title: shortString(),
    kind: Type.Optional(Type.String({ description: 'work (default) or regression; regression captures intentional behavioral failure and must have checks:[]' })),
    dependsOn: Type.Optional(Type.Array(shortString(), { maxItems: 40 })),
    checks: Type.Optional(Type.Array(shortString(), { maxItems: 24 })),
  })]), { minItems: 1, maxItems: 40 }),
  verification: Type.Optional(Type.String({ description: 'required (default) | advisory | none' })),
  acceptance: Type.Array(Type.Object({ requirement: shortString(), checks: strings(24) }), { maxItems: 40 }),
  checks: Type.Array(Type.Object({ id: Type.String({ pattern: '^[a-z][a-z0-9_-]{0,39}$' }), kind: Type.String({ description: 'test, runtime, or static' }), argv: strings(80), timeoutSeconds: Type.Integer({ minimum: 1, maximum: 300 }) }), { maxItems: 24 }),
};
const GUIDANCE = `Software delivery workflow (not required for questions or read-only reviews):
Classify the ask before planning. Pure questions, explanations and read-only reviews are informational: either answer directly without delivery_plan, or — when a written contract helps — call delivery_plan with verification:"none" (no checks) or verification:"advisory" (legacy optional evidence, not permission to execute commands). Reserve verification:"required" (the default) for tasks that change product files. Before running delivery_check, re-check the classification once more: a required plan may be reclassified to advisory/none only before any check has run, so decide before the verify loop. Informational plans finish cleanly with delivery_finish status="verified" and receive no repair nudges.
For substantial implementation work, inspect the repository and installed library APIs first. Identify which domain skills or knowledge bases apply to this task — check the available skills list and read the matching skill before implementing. Use delivery_plan BEFORE implementation: capture assumptions, a small vertical-slice plan, artifact roots, acceptance criteria and real check commands. D2 is generated for the flowchart; use D2 for any additional flowcharts.
Before any code, tests or commands, declare design:{components,ports,scenarios,risks}; read docs/tested-planning.md for the contract. Use delivery_design action=validate, revise findings, action=review with adversarial challenges and every scenario walkthrough, then action=approve. Shell/unknown tools and check execution remain locked until approval. Discovery uses read/ls/find/grep, not executable probes. Every plan revision relocks implementation. Review is model-authored, not independent proof. Confirm proposed assertions can actually detect failure. If the plan is weak or incomplete, call delivery_revise with a reason and a partial plan patch to fix it — the plan is a living contract, not a one-time artifact. Unchanged checks retain evidence only while the workspace fingerprint is unchanged; source edits still require re-verification.
Implement a runnable slice early, then complete the agreed behavior in small coherent steps. Mark progress with delivery_progress as each step finishes so the plan panel stays current. Don't stop at a scaffold. Verify uncertain APIs with installed source or a tiny executable probe; never invent library methods or assume assets exist. Separate testable logic from rendering/services. Include error handling, dependencies, launch instructions, and regression tests. Exercise actual interaction paths in fresh subprocesses with the normal environment, not only compilation or internal function calls. Include non-ASCII text, paths with spaces, and invalid data where applicable. On Windows, stdout may use a legacy code page (e.g. cp1252): use ASCII-escaped JSON or configure the application's UTF-8 output; don't hide failures by changing only the test environment. For visual work, capture and inspect a screenshot if your model supports images; otherwise explicitly disclose that visual review is unperformed.
After creating a file, prefer focused edit calls over repeatedly rewriting the full file. Whole-file rewrites bloat model context, increase provider rate-limit risk, and can accidentally remove previously working behavior. If development reveals a wrong assumption or a step can't be completed as planned, call delivery_revise to adjust the contract — update steps and checks to match reality, but never silently drop original acceptance criteria. For multi-package work use structured steps {id,title,dependsOn:[],checks:[]} with stable IDs: dependencies gate progress and mapped checks must pass before done. Plan near-term slices in detail, leave later slices coarse, and refine them as dependencies become clear. Record architecture boundaries, affected callers, compatibility constraints, risky assumptions and rollback strategy in assumptions; resolve uncertainty with focused probes. Establish baseline failures, add a regression that fails before the fix, then run focused tests followed by integration and repository quality gates. Reopening a prerequisite resets downstream progress. Finish requires all structured steps done; string steps remain supported.
Use a few meaningful check suites (usually 2–4), not one command per criterion: multiple acceptance criteria can share a suite. When user-owned required validators already cover a requirement, do not duplicate them with shallow model-authored checks; add only focused checks for logic they do not cover. Scope honestly: enumerate every explicit requirement in the user's prompt and back each core requirement with an acceptance criterion and a real check. Narrow contracts that omit core requirements make 'verified' a scope failure, not a smaller task; if budget remains once checks pass, implement and verify the missing requirements instead of stopping at the first passing slice. Run delivery_check with id="all" to execute every declared check sequentially. It executes the argv with a deadline, records logs and fingerprints the entire working project (excluding dependencies, caches and generated artifacts), so omitting a source file cannot hide stale evidence. Artifact roots must contain product source/tests/config/docs, never only artifacts/. Use ["."] for the project. Do not edit during checks; run dependent tools in separate batches. Use artifacts/ for generated screenshots/build output; .harness/ is reserved for harness logs. Re-run checks after final edits. When delivery_status reports readyToFinish:true, stop polling: adversarially review the result and call delivery_finish. Repeating an unchanged delivery_status is not progress and is blocked after a small number of calls.
For a regression-first milestone use {id,title,kind:"regression",checks:[]}; capture an actual behavioral assertion failure (not an import or syntax failure) with bash before implementation and record its command/result in progress notes. Keep green suites on acceptance and the later integration milestone. Run focused intermediate gates rather than waiting until every package has changed. New or remapped acceptance criteria require new test executions even if old command evidence is still fresh; add assertions that would catch the newly required behavior.
Before concluding a structured plan, call delivery_review action="inspect" to capture the final Git diff. Read the diff and any new files, challenge each criterion with concrete assertion coverage, and run additional boundary/metamorphic probes (for numbers: different magnitudes, signs, extremes, equivalent representations and permutation invariance, not only tiny happy-path examples). Fix findings, rerun checks, and inspect again after edits. Then call delivery_review action="record" with captureId, coverage:[{requirement,assertions}], probes:[command and observed result], findings:[] and limitations. Nonempty findings must be fixed or handed off blocked. The recorded review and exact check evidence are included in the harness handoff; don't invent provenance in a model-authored report. This traceable self-review is not independent proof. Finally call delivery_finish with the review, launch command and honest limitations. Failed, missing or stale checks cannot produce verified status. If genuinely blocked, use status=blocked with the reason; do not weaken tests to manufacture success. Phased delivery means steady progress across many tool calls within the run, not a single response. No automatic deployments or unrequested destructive changes.`;

export default function delivery(pi: ExtensionAPI) {
  let state: any = null;
  let touched = false, nudges = 0;
  let budget: any = null;
  let statusPollKey = '', statusPollRepeats = 0;
  const resetStatusPolls = () => { statusPollKey = ''; statusPollRepeats = 0; };
  let budgetTimer: ReturnType<typeof setTimeout> | undefined;
  const saveBudget = () => pi.appendEntry('delivery-budget-v1', structuredClone(budget));
  function stopBudget(reason: string, ctx: ExtensionContext) {
    clearTimeout(budgetTimer);
    if (!budget.stopped) {
      budget.stopped = reason;
      saveBudget();
      pi.sendMessage({ customType: 'delivery-budget-stop', display: true, content: JSON.stringify({
        status: 'budget-exhausted', reason, budget,
        requirements: state?.plan.acceptance || [], evidence: state?.evidence || {},
        next: 'Review incomplete work. Use /delivery-budget-reset to explicitly authorize a new budget.'
      }) }, { triggerTurn: false });
    }
    ctx.abort();
    return { block: true, reason: `Delivery budget exhausted: ${reason}. User reset required.` };
  }
  function ensureBudget(ctx: ExtensionContext, action?: string) {
    if (!budget) {
      const limits = budgetLimits(name => pi.getFlag(name));
      if (!Object.values(limits).some(Boolean)) return;
      budget = newBudget(limits); saveBudget();
    }
    const reason = budgetReason(budget, action);
    if (reason) return stopBudget(reason, ctx);
    if (action === 'tool') { budget.tools++; saveBudget(); }
    if (action === 'repair') { budget.repairs++; saveBudget(); }
  }
  pi.registerCommand('delivery-budget-status', { description: 'Show session budget usage, remaining allowance and stop reason', handler: (_args, ctx) => {
    const content = JSON.stringify(budgetSnapshot(budget));
    pi.sendMessage({ customType: 'delivery-budget-status', display: true, content }, { triggerTurn: false });
    if (ctx.hasUI) ctx.ui.notify(content, 'info');
  } });
  pi.registerCommand('delivery-budget-reset', { description: 'Explicitly authorize a fresh session budget with current configured limits', handler: (_args, ctx) => {
    clearTimeout(budgetTimer);
    budget = newBudget(budgetLimits(name => pi.getFlag(name)));
    saveBudget();
    if (ctx.hasUI) ctx.ui.notify('Delivery budget reset', 'info');
  } });
  for (const name of ['tools', 'seconds', 'repairs']) pi.registerFlag(`delivery-max-${name}`, { description: `Session budget for ${name}; 0 disables this limit. Reset only with /delivery-budget-reset.`, type: 'string', default: '0' });
  const exclusive = createSerialQueue();
  const guidanceProfiles = loadGuidanceProfiles();
  let activeGuidance: any[] = [];
  let required: any[] = [], extraGuidance = '', configError = '';
  let writeCounts = new Map<string, number>();
  let initialFiles = new Set<string>();
  pi.registerFlag('delivery-validators', { description: 'Path to user-owned required validator manifest; these checks cannot be omitted by the model', type: 'string' });
  pi.registerFlag('delivery-context', { description: 'Path to optional task/context guidance injected into the delivery system prompt', type: 'string' });
  pi.registerFlag('delivery-strict', { description: 'Deprecated compatibility flag; tested-plan mutation gate is always enabled (not an OS sandbox)', type: 'boolean', default: true });
  pi.registerFlag('delivery-bash-cap', { description: 'Cap bash/powershell tool timeouts at N seconds (0 disables). A single un-timed runaway command (e.g. find /) can otherwise consume an entire bounded run. Instruct the model to set bounded timeouts either way.', type: 'string', default: '0' });
  pi.registerFlag('delivery-protect-existing', { description: 'Require focused edits instead of whole-file replacement for files present at session start', type: 'boolean', default: false });
  pi.registerFlag('delivery-rewrite-cap', { description: 'Maximum built-in write calls per path in a bounded run; later changes must use focused edits (0 disables)', type: 'string', default: '0' });
  pi.registerFlag('delivery-turn-delay-ms', { description: 'Base delay after tool results in bounded runs, scaled by active context size to reduce provider rate-limit bursts (0 disables)', type: 'string', default: '0' });
  pi.registerFlag('delivery-tool-output-cap', { description: 'Maximum characters retained from each text tool result in bounded runs; preserves the beginning and end (0 disables)', type: 'string', default: '0' });
  function restore(ctx: ExtensionContext) {
    clearTimeout(budgetTimer);
    budget = [...ctx.sessionManager.getEntries()].reverse().find((e: any) => e.type === 'custom' && e.customType === 'delivery-budget-v1')?.data || null;
    if (budget) budget = structuredClone(budget);
    budgetLimits(name => pi.getFlag(name));
    state = restoreState(ctx.sessionManager.getBranch());
    if (state) state = reconcileReport(join(directory(ctx), 'report.json'), state);
    activeGuidance = (state?.guidanceProfiles || state?.plan?.guidanceProfiles || [])
      .map((id: string) => guidanceProfiles.find(profile => profile.id === id))
      .filter(Boolean);
    touched = false;
    nudges = state?.nudges ?? 0;
    resetStatusPolls();
    required = [];
    extraGuidance = '';
    configError = '';
    writeCounts = new Map();
    initialFiles = new Set();
    if (pi.getFlag('delivery-protect-existing')) {
      for (const entry of readdirSync(ctx.cwd, { withFileTypes: true })) {
        if (entry.isFile()) initialFiles.add(resolve(ctx.cwd, entry.name));
      }
    }
    const explicit = pi.getFlag('delivery-validators');
    const projectConfig = join(ctx.cwd, CONFIG_DIR_NAME, 'delivery.json');
    const file = typeof explicit === 'string' && explicit ? resolve(ctx.cwd, explicit) : (ctx.isProjectTrusted?.() && existsSync(projectConfig) ? projectConfig : undefined);
    if (file) {
      try { required = loadRequiredChecks(file, ctx.cwd); }
      catch (error) { configError = `Invalid required validators: ${error}`; }
    }
    const context = pi.getFlag('delivery-context');
    if (typeof context === 'string' && context.trim()) {
      try { extraGuidance = readFileSync(resolve(ctx.cwd, context), 'utf8'); }
      catch (error) { configError = `Invalid delivery context: ${error}`; }
    }
    if (state && required.length) {
      for (const check of required) {
        const previous = state.plan.checks.find((c: any) => c.id === check.id);
        if (JSON.stringify(previous) !== JSON.stringify(check)) delete state.evidence[check.id];
      }
      state.plan = bindRequiredChecks(state.plan, required);
      if (required.some(check => !state.evidence[check.id])) state.status = 'verifying';
    }
  }
  function directory(ctx: ExtensionContext) {
    return localPath(ctx.cwd, join('.harness', ctx.sessionManager.getSessionId(), state.runId));
  }
  function refreshState(ctx: ExtensionContext) {
    if (state) {
      assertActiveReport(ctx.cwd, join(directory(ctx), 'report.json'));
      state = reconcileReport(join(directory(ctx), 'report.json'), state);
    }
  }
  async function workspaceOperation(ctx: ExtensionContext, operation: () => Promise<any>, replace = false) {
    const release = lockWorkspace(ctx.cwd);
    try {
      if (replace) { if (state) state = reconcileReport(join(directory(ctx), 'report.json'), state); }
      else refreshState(ctx);
      return await operation();
    }
    finally { release(); }
  }
  function persist(ctx: ExtensionContext) {
    state.nudges = nudges;
    saveReport(join(directory(ctx), 'report.json'), state);
    pi.appendEntry('delivery-state-v1', structuredClone(state));
    if (ctx.hasUI) ctx.ui.setStatus('delivery', `delivery: ${state.status}`);
  }
  pi.on('session_start', (_event, ctx) => restore(ctx));
  pi.on('session_tree', (_event, ctx) => restore(ctx));
  pi.on('session_shutdown', () => clearTimeout(budgetTimer));
  pi.on('agent_start', (_event, ctx) => {
    if (ensureBudget(ctx)) return;
    clearTimeout(budgetTimer);
    if (budget?.limits.seconds) {
      budgetTimer = setTimeout(() => stopBudget('elapsed-time', ctx), Math.max(1, budget.startedAt + budget.limits.seconds * 1000 - Date.now()));
      budgetTimer.unref();
    }
  });
  pi.on('input', event => {
    if (event.source !== 'extension') { nudges = 0; touched = false; resetStatusPolls(); }
    return { action: 'continue' };
  });
  pi.on('before_agent_start', (event, ctx) => {
    const routed = routeGuidance(event.prompt, { cwd: ctx?.cwd || process.cwd(), profiles: guidanceProfiles });
    activeGuidance = state && !['verified', 'blocked'].includes(state.status)
      ? [...new Map([...activeGuidance, ...routed].map(profile => [profile.id, profile])).values()].sort((a, b) => b.priority - a.priority)
      : routed;
    let guidance = GUIDANCE + BROWSER_CHECK_GUIDANCE;
    const routedText = formatGuidance(activeGuidance);
    if (routedText) guidance += `\n\n${routedText}`;
    if (extraGuidance) guidance += `\n\nTask-specific delivery context:\n${extraGuidance}`;
    if (required.length) guidance += `\nUser-owned required validators will be added to your plan automatically: ${JSON.stringify(required)}. Run delivery_check id="all"; repair failures rather than replacing or bypassing these checks.`;
    if (looksInformational(event.prompt)) guidance += `\n\nReceipt check: this prompt reads as informational/read-only. Answer it directly, or if you record a contract use delivery_plan verification:"none" (no checks) or "advisory" (optional non-blocking evidence). Do not enter the verify/repair loop for a pure question — decide the classification now, before the verify loop.`;
    return { systemPrompt: event.systemPrompt + '\n\n' + guidance };
  });
  pi.on('context', event => {
    // Terminal contracts must not keep asking the model to inspect freshness.
    // Explicit checks/finish still validate evidence; a new plan restores context.
    if (!state || ['verified', 'blocked'].includes(state.status)) return;
    // Re-injected after compaction without replacing Pi's summary or pruning user messages.
    const summary = { planning: { approvedRevision: state.planning?.approval?.revision, started: Boolean(state.planning?.started), findings: state.planning?.validation?.findings?.length }, goal: state.plan.goal, revision: state.revision, lastRevision: state.revisions?.at(-1)?.reason, assumptions: state.plan.assumptions, status: state.status, stepStatus: state.stepStatus, verification: verificationMode(state.plan), verificationStarted: state.verificationStarted, outputs: state.plan.outputs, requirementRevisions: state.requirementRevisions, reviewRecorded: Boolean(state.reviewEvidence), progressNotes: state.progressNotes?.slice(-5), acceptance: state.plan.acceptance, steps: state.plan.steps, artifacts: state.plan.artifacts, checks: state.plan.checks, evidence: Object.fromEntries(Object.entries(state.evidence).map(([id, e]: any) => [id, { passed: e.passed, fingerprint: e.fingerprint, code: e.code, outputTail: e.outputTail ? e.outputTail.slice(-400) : undefined }])) };
    return { messages: [...event.messages, { role: 'custom' as const, customType: 'delivery-context', content: `Delivery contract (evidence may be stale after edits):\n${JSON.stringify(summary)}\nInspect freshness with delivery_status once when needed. If it reports readyToFinish:true, call delivery_finish; do not poll unchanged status.`, display: false, timestamp: Date.now() }] };
  });
  pi.on('tool_call', (event, ctx) => {
    const stopped = ensureBudget(ctx, 'tool');
    if (stopped) return stopped;
    if (event.toolName === 'delivery_status') {
      let key = '';
      if (state) {
        try {
          refreshState(ctx);
          const hash = fingerprint(ctx.cwd, ['.']);
          key = JSON.stringify({ runId: state.runId, revision: state.revision, status: state.status, pending: pendingChecks(state, hash), hash });
        } catch (err: any) {
          key = JSON.stringify({ runId: state?.runId, revision: state?.revision, status: state?.status, error: err?.message || String(err) });
        }
      }
      if (key && key === statusPollKey) {
        // Keep blocked retries blocked, but recompute the key first so a real
        // report/workspace change automatically permits a fresh status read.
        if (statusPollRepeats >= 3) {
          return { block: true, reason: 'Repeated unchanged delivery_status calls are blocked. Use the last result: call delivery_finish when readyToFinish is true; otherwise edit, run delivery_check, or report status=blocked. Do not poll again until state or workspace changes.' };
        }
        statusPollRepeats++;
      } else { statusPollKey = key; statusPollRepeats = key ? 1 : 0; }
    } else if (event.toolName.startsWith('delivery_') || ['write', 'edit'].includes(event.toolName)) {
      resetStatusPolls();
    }
    const input = event.input as Record<string, any> | undefined;
    if (
      event.toolName === 'edit' &&
      input &&
      typeof input === 'object' &&
      typeof input.edits === 'string'
    ) {
      try {
        const edits = JSON.parse(input.edits);
        if (
          Array.isArray(edits) &&
          edits.every(edit => edit && typeof edit === 'object' && !Array.isArray(edit))
        ) {
          input.edits = edits;
        }
      } catch {
        // Leave invalid input unchanged so the tool returns its normal validation error.
      }
    }
    if (needsImplementation(event.toolName)) {
      try {
        if (!ctx?.cwd) throw Error('Implementation locked: call delivery_plan and test/approve its design first.');
        const release = lockWorkspace(ctx.cwd);
        try {
          refreshState(ctx);
          startImplementation(state, fingerprint(ctx.cwd, ['.']));
          persist(ctx);
        } finally { release(); }
      } catch (error: any) { return { block: true, reason: error.message }; }
    }
    if (['write', 'edit'].includes(event.toolName) && input && typeof input === 'object') {
      const path = typeof input.path === 'string' ? input.path.replaceAll('\\', '/') : '';
      const cwdAsRelativePath = ctx?.cwd?.replaceAll('\\', '/').replace(/^\/+/, '') ?? '';
      const cwdName = ctx?.cwd ? basename(ctx.cwd).replaceAll('\\', '/') : '';
      if (
        cwdAsRelativePath &&
        (path === cwdAsRelativePath ||
          path.startsWith(`${cwdAsRelativePath}/`) ||
          path === cwdName ||
          path.startsWith(`${cwdName}/`))
      ) {
        return {
          block: true,
          reason: 'This path recreates the working directory inside itself. Use a workspace-relative product path such as README.md or src/index.ts.',
        };
      }
      if (
        event.toolName === 'write' &&
        ctx?.cwd &&
        initialFiles.has(resolve(ctx.cwd, path))
      ) {
        return {
          block: true,
          reason: `Preserve the existing ${path} implementation. Inspect it and use focused edit calls instead of replacing the whole file.`,
        };
      }
    }
    const rewriteCap = Math.max(0, Number(pi.getFlag('delivery-rewrite-cap')) || 0);
    if (rewriteCap > 0 && event.toolName === 'write' && input && typeof input === 'object') {
      const path = typeof input.path === 'string' ? input.path : '';
      if (path) {
        const count = writeCounts.get(path) ?? 0;
        if (count >= rewriteCap) {
          return {
            block: true,
            reason: `Full-file rewrite limit reached for ${path}. Preserve working behavior and use focused edit calls for subsequent changes.`,
          };
        }
        writeCounts.set(path, count + 1);
      }
    }
    // Bounded-run protection: shell tools have no default timeout, so one un-timed
    // runaway command (observed live: `find /`) can block until the wall clock expires.
    // Mutating input is a documented pi guarantee and affects execution.
    const cap = Number(pi.getFlag('delivery-bash-cap')) || 0;
    if (['bash', 'powershell'].includes(event.toolName) && input && typeof input === 'object') {
      const command = typeof input.command === 'string' ? input.command : '';
      if (ctx?.cwd && initialFiles.size) {
        const redirects = [...command.matchAll(/(?:^|[^>])>(?!>)\s*(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g)]
          .map(match => match[1] ?? match[2] ?? match[3])
          .filter(Boolean)
          .map(path => resolve(ctx.cwd, path));
        if (redirects.some(path => initialFiles.has(path))) {
          return {
            block: true,
            reason: 'Shell redirection cannot replace a file that existed at session start. Inspect it and use a focused edit tool instead.',
          };
        }
        const replacesWithScript =
          /\bopen\s*\([^)]*,\s*['"][wax+]+['"]/i.test(command) ||
          /\b(?:write_text|writeFileSync|writeFile)\s*\(/i.test(command);
        if (
          replacesWithScript &&
          [...initialFiles].some(path => command.includes(path) || command.includes(basename(path)))
        ) {
          return {
            block: true,
            reason: 'A script cannot replace a file that existed at session start. Inspect it and use a focused edit tool instead.',
          };
        }
        const removesOrReplaces = /\b(?:rm|mv|touch|truncate)\b/i.test(command);
        if (
          removesOrReplaces &&
          [...initialFiles].some(path => command.includes(path) || command.includes(basename(path)))
        ) {
          return {
            block: true,
            reason: 'Shell commands cannot remove or replace a file that existed at session start. Inspect it and use a focused edit tool instead.',
          };
        }
      }
      const broadTermination =
        /\b(?:pkill|killall)\b/i.test(command) ||
        /\bkill\b\s+(?:-\S+\s+)*(?:-1|0)(?:\s|$)/i.test(command) ||
        /\btaskkill\b[^\n]*(?:\/im|\*)/i.test(command) ||
        /\bstop-process\b[^\n]*\s-name\b/i.test(command) ||
        /\bget-process\b[^\n]*\|\s*stop-process\b/i.test(command);
      if (broadTermination) {
        return { block: true, reason: 'Broad process termination is prohibited in bounded delivery runs. Capture the launched child PID and terminate only that PID.' };
      }
      if (cap > 0 && (typeof input.timeout !== 'number' || input.timeout > cap)) input.timeout = cap;
    }
  });
  pi.on('tool_result', async (event, ctx) => {
    if (!event.isError && ['write', 'edit'].includes(event.toolName)) touched = true;
    const baseDelay = Math.max(0, Number(pi.getFlag('delivery-turn-delay-ms')) || 0);
    const contextTokens = ctx?.getContextUsage?.()?.tokens ?? 0;
    const delay = Math.min(30000, baseDelay * Math.max(1, Math.ceil(contextTokens / 50000)));
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    const cap = Math.max(0, Number(pi.getFlag('delivery-tool-output-cap')) || 0);
    if (cap > 0 && event.content) {
      let changed = false;
      const content = event.content.map(item => {
        if (item.type !== 'text' || item.text.length <= cap) return item;
        changed = true;
        const marker = `\n...[${item.text.length - cap} characters omitted; rerun a narrower command if needed]...\n`;
        if (cap <= marker.length) return { ...item, text: item.text.slice(0, cap) };
        const head = Math.floor((cap - marker.length) / 3);
        const tail = cap - marker.length - head;
        return { ...item, text: item.text.slice(0, head) + marker + item.text.slice(-tail) };
      });
      if (changed) return { content };
    }
  });

  pi.registerTool({
    name: 'delivery_plan', label: 'Delivery plan', description: 'Create an acceptance contract and generate plan.d2. Use delivery_revise for ongoing work; replacing an active plan is treated as a revision. After verified/blocked, this starts a new task. Paths are relative files/directories, not globs. Checks use executable argv (no implicit shell). Set verification:"none" for a pure informational answer, "advisory" for optional non-blocking evidence, or leave the default "required" for tasks that change product files.',
    parameters: Type.Object(planFields),
    async execute(_id, params, _signal, _update, ctx) {
      return exclusive(() => workspaceOperation(ctx, async () => {
        if (configError) throw Error(configError);
        const plan = validatePlan(bindRequiredChecks({ ...params, verification: params.verification ?? 'required' }, required), ctx.cwd);
        validateRevision(state, plan);
        if (state && !['verified', 'blocked'].includes(state.status)) {
          let hash: string | undefined;
          try { hash = fingerprint(ctx.cwd, ['.']); } catch { /* retain stale evidence without rebinding */ }
          state = revisePlan(state, plan, { cwd: ctx.cwd, hash, reason: 'Active plan replaced via delivery_plan' });
        } else {
          state = { version: 1, runId: randomUUID(), revision: (state?.revision || 0) + 1, guidanceProfiles: activeGuidance.map(profile => profile.id), plan, evidence: {}, status: 'implementing', createdAt: new Date().toISOString(), stepStatus: {} };
        }
        const dir = directory(ctx);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'plan.d2'), planD2WithProgress(state.plan, state.stepStatus));
        persist(ctx);
        selectReport(ctx.cwd, join(dir, 'report.json'));
        return text({ plan: join(dir, 'plan.d2'), report: join(dir, 'report.json'), next: 'No code or commands yet. Declare design components/ports/scenarios/risks, then delivery_design validate, review and approve. Revise any findings first.' });
      }, true));
    },
  });
  pi.registerTool({
    name: 'delivery_revise', label: 'Revise delivery plan',
    description: 'Adapt the current task with a reason and partial plan patch. Omitted fields are preserved; supplied arrays replace that field. Keeps run identity, revision history and unambiguous step progress. Only unchanged checks on unchanged source retain fresh evidence. Cannot drop acceptance criteria or erase verification history, even when resuming blocked work.',
    parameters: Type.Object({ reason: shortString(), patch: Type.Partial(Type.Object(planFields)) }),
    async execute(_id, params, _signal, _update, ctx) {
      return exclusive(() => workspaceOperation(ctx, async () => {
        if (configError) throw Error(configError);
        if (!state) throw Error('Call delivery_plan first');
        let hash: string | undefined;
        try { hash = fingerprint(ctx.cwd, ['.']); } catch { /* revisions remain possible at scope limits */ }
        const bound = bindRequiredChecks({ ...state.plan, ...validatePlanPatch(params.patch) }, required);
        state = revisePlan(state, bound, { cwd: ctx.cwd, reason: params.reason, hash });
        persist(ctx);
        return text({ revision: state.revision, report: join(directory(ctx), 'report.json'), stepStatus: state.stepStatus, pendingChecks: pendingChecks(state, hash), unverifiedRequirements: pendingRequirements(state, hash), next: 'Revision relocked implementation. Revalidate, review and approve the design before new code or check execution.' });
      }));
    },
  });
  pi.registerTool({
    name: 'delivery_design', label: 'Test delivery design',
    description: 'Before generating code: validate architecture and scenarios, record adversarial review, then approve. Review is self-reported, not independent proof. Revisions and preimplementation source edits invalidate approval.',
    parameters: Type.Object({ action: Type.String({ enum: ['validate', 'review', 'approve'] }), review: Type.Optional({ type: 'object', additionalProperties: true, description: 'challenges:string[], walkthroughs:[{scenario,trace,assertion}], findings:[{severity,description,disposition?}], limitations:string[]' }) }),
    async execute(_id, params, _signal, _update, ctx) {
      return exclusive(() => workspaceOperation(ctx, async () => {
        if (!state) throw Error('Call delivery_plan first');
        const hash = fingerprint(ctx.cwd, ['.']);
        let result;
        if (params.action === 'validate') result = validatePlanning(state, hash);
        else if (params.action === 'review') result = recordPlanReview(state, hash, params.review);
        else if (params.action === 'approve') result = approvePlanning(state, hash);
        else throw Error('Unknown design action');
        persist(ctx);
        return text({ result, planningStatus: planningStatus(state, hash) });
      }));
    },
  });
  pi.registerTool({
    name: 'delivery_status', label: 'Delivery status', description: 'Show failed/missing/stale checks and the next action. If readyToFinish is true, call delivery_finish instead of polling again.', parameters: Type.Object({}),
    async execute(_id, _params, _signal, _update, ctx) {
      if (!state) return text('No delivery contract.');
      refreshState(ctx);
      let pending: string[] = [];
      let freshnessKnown = true;
      let issues: any = null;
      let designStatus: any = { locked: true, reasons: ['Source fingerprint unavailable.'] };
      try {
        const hash = fingerprint(ctx.cwd, ['.']);
        designStatus = planningStatus(state, hash);
        pending = pendingChecks(state, hash);
        issues = completionIssues(state, ctx.cwd, hash);
      } catch (err: any) {
        freshnessKnown = false;
        pending = [`[scope error: ${err.message}]`];
      }
      const readyToFinish = freshnessKnown && issues && Object.values(issues).every((items: any) => items.length === 0);
      const next = readyToFinish
        ? 'All required checks are fresh and passing. Adversarially review the acceptance criteria, then call delivery_finish with status="verified". Do not call delivery_status again unless the workspace changes.'
        : pending.length
          ? `Run delivery_check for pending checks: ${pending.join(', ')}; repair failures before finishing.`
          : 'Complete outstanding steps/outputs and unverified requirements. For structured plans, use delivery_review action=inspect then action=record before delivery_finish.';
      // History lives in report.json; do not flood model context with old snapshots.
      const { revisions, ...current } = state;
      return text({ ...current, planningStatus: designStatus, revisionHistory: revisions?.map((r: any) => ({ revision: r.revision, reason: r.reason, at: r.at })), pendingChecks: pending, completionIssues: issues, readyToFinish, next });
    },
  });
  pi.registerTool({
    name: 'delivery_progress', label: 'Update step progress', description: 'Mark a plan step as active, done, or failed. Regenerates plan.d2 so the side panel stays current. Use as each step completes or hits a blocker.',
    parameters: Type.Object({
      step: Type.Union([Type.Integer({ minimum: 0 }), shortString()]),
      status: Type.String({ description: 'active, done, failed, or pending' }),
      note: Type.Optional(shortString()),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      return exclusive(() => workspaceOperation(ctx, async () => {
        if (!state) throw Error('Call delivery_plan first');
        const step = planSteps(state.plan).find((s: any, i: number) => typeof params.step === 'string' ? s.id === params.step : i === params.step);
        const hash = params.status === 'done' && step?.checks.length ? fingerprint(ctx.cwd, ['.']) : undefined;
        updateStepStatus(state, params.step, params.status, hash);
        if (params.note) {
          state.progressNotes = [...(state.progressNotes || []), { step: step?.id, status: params.status, note: params.note, revision: state.revision, at: new Date().toISOString() }];
        }
        const dir = directory(ctx);
        writeFileSync(join(dir, 'plan.d2'), planD2WithProgress(state.plan, state.stepStatus));
        persist(ctx);
        return text({ step: params.step, status: params.status, plan: join(dir, 'plan.d2') });
      }));
    },
  });
  pi.registerTool({
    name: 'delivery_check', label: 'Run delivery check', description: 'Execute a declared check, or id="all" to run all checks sequentially. Records real exit status, deadline, logs and source fingerprint. Last 12,000 characters per check, full log capped at 8 MiB. Sibling delivery calls are queued safely; do not edit during checks.',
    parameters: Type.Object({ id: shortString() }),
    async execute(_id, params, signal, onUpdate, ctx) {
      return exclusive(() => workspaceOperation(ctx, async () => {
        if (!state) throw Error('Call delivery_plan first');
        const verification = verificationMode(state.plan);
        // Pre-verify gate: an informational plan has no checks by design. Return a
        // clear route to finish instead of an error that could start a repair loop.
        if (verification === 'none') {
          return text({ verification, note: 'This plan declares verification:"none" (informational), so there are no checks to run. Call delivery_finish with status="verified" and the answer. If evidence is genuinely needed, replan with verification:"advisory" before any check has run.' });
        }
        startImplementation(state, fingerprint(ctx.cwd, ['.']));
        persist(ctx);
        const checks = params.id === 'all' ? state.plan.checks : state.plan.checks.filter((c: any) => c.id === params.id);
        if (!checks.length) throw Error('Unknown check ID. Use delivery_status or id="all".');
        const results = [];
        const failures = [];
        for (const check of checks) {
          const identity = evidenceIdentity(state, check);
          if (signal?.aborted) throw Error('Check cancelled before execution');
          state.status = 'verifying';
          state.verificationStarted = true;
          delete state.evidence[check.id];
          let before: string;
          try {
            before = fingerprint(ctx.cwd, ['.']);
          } catch (err: any) {
            state.evidence[check.id] = {
              passed: false,
              fingerprint: null,
              code: 1,
              timedOut: false,
              cancelled: false,
              logPath: null,
              durationMs: 0,
              changedDuringCheck: false,
              outputTail: `Evidence scope error: ${err.message}`
            };
            persist(ctx);
            throw Error(`Evidence scope error: ${err.message}. If the repository exceeds file limits or cannot be scoped, call delivery_finish with status="blocked" and specific limitations rather than retrying delivery_check.`);
          }
          persist(ctx);
          onUpdate?.(text(`Running ${check.id}: ${JSON.stringify(check.argv)}`));
          const result = await runCommand(check.argv, { cwd: ctx.cwd, timeoutSeconds: check.timeoutSeconds, signal, logPath: join(directory(ctx), `${check.id}-${randomUUID()}.log`) });
          let after: string;
          try {
            after = fingerprint(ctx.cwd, ['.']);
          } catch (err: any) {
            state.evidence[check.id] = {
              passed: false,
              fingerprint: null,
              code: result.code,
              timedOut: result.timedOut,
              cancelled: result.cancelled,
              logPath: result.logPath,
              durationMs: result.durationMs,
              changedDuringCheck: false,
              outputTail: `Post-check evidence scope error: ${err.message}\n${result.output.slice(-800)}`
            };
            persist(ctx);
            throw Error(`Post-check evidence scope error: ${err.message}. If the repository exceeds file limits, call delivery_finish with status="blocked" and specific limitations.`);
          }
          const passed = result.code === 0 && !result.timedOut && !result.cancelled && !result.outputLimit && before === after;
          state.evidence[check.id] = { passed, ...identity, executedRevision: state.revision, fingerprint: after, code: result.code, timedOut: result.timedOut, cancelled: result.cancelled, logPath: result.logPath, durationMs: result.durationMs, changedDuringCheck: before !== after, outputTail: result.output.slice(-1200) };
          persist(ctx);
          const message = { id: check.id, advisory: verification !== 'required', ...state.evidence[check.id], outputTail: result.output };
          // Advisory checks are evidence for an informational answer: record the
          // real failure but do not force the repair loop.
          if (!passed && verification === 'required') failures.push(message);
          results.push(message);
        }
        if (failures.length) throw Error(JSON.stringify({ failures, next: 'All requested checks ran. Repair the failures or revise the plan based on findings; do not weaken acceptance criteria.' }, null, 2));
        let finalHash: string | null = null;
        let pending: string[] = [];
        let freshnessError = '';
        try {
          finalHash = fingerprint(ctx.cwd, ['.']);
          pending = pendingChecks(state, finalHash);
        } catch (err: any) {
          freshnessError = err?.message || String(err);
          pending = [`[scope error: ${freshnessError}]`];
        }
        const issues = finalHash !== null ? completionIssues(state, ctx.cwd, finalHash) : null;
        const readyToFinish = issues !== null && Object.values(issues).every((items: any) => items.length === 0);
        return text({ results, pendingChecks: pending, completionIssues: issues, readyToFinish, next: readyToFinish ? 'All required checks are fresh and passing. Adversarially review the acceptance criteria, then call delivery_finish with status="verified". Do not call delivery_status first.' : freshnessError ? 'Evidence freshness could not be established. Call delivery_finish with status="blocked" and the scope limitation.' : verification !== 'required' ? 'Review the recorded advisory evidence and call delivery_finish; failures are context, not repair orders.' : 'Complete pending steps and outputs, and repair or run remaining checks before delivery_finish.' });
      }));
    },
  });
  pi.registerTool({
    name: 'delivery_review', label: 'Review delivery evidence',
    description: 'Required for structured delivery plans. inspect captures the actual Git diff and lists new files; read it and inspect new-file contents. record binds per-requirement assertion coverage, executed boundary probes and limitations to the unchanged snapshot. Unresolved findings block recording; repair or finish blocked. This is traceable self-review, not independent correctness proof.',
    parameters: Type.Object({
      action: Type.String({ description: 'inspect or record' }),
      captureId: Type.Optional(shortString()),
      coverage: Type.Optional(Type.Array(Type.Object({ requirement: shortString(), assertions: shortString() }), { maxItems: 64 })),
      probes: Type.Optional(Type.Array(shortString(), { maxItems: 40 })),
      findings: Type.Optional(Type.Array(shortString(), { maxItems: 40 })),
      limitations: Type.Optional(Type.Array(shortString(), { maxItems: 20 })),
    }),
    async execute(_id, params, signal, _update, ctx) {
      return exclusive(() => workspaceOperation(ctx, async () => {
        if (!state) throw Error('Call delivery_plan first');
        let result;
        if (params.action === 'inspect') result = await captureDeliveryReview(state, ctx.cwd, directory(ctx), signal);
        else if (params.action === 'record') { recordDeliveryReview(state, ctx.cwd, params); result = { recorded: true, next: 'If steps and outputs are complete, call delivery_finish. Review records model-authored assertions, not a correctness guarantee.' }; }
        else throw Error('Review action must be inspect or record');
        persist(ctx);
        return text(result);
      }));
    },
  });
  pi.registerTool({
    name: 'delivery_finish', label: 'Finish delivery', description: 'Record review and handoff. verified requires all declared checks passing on current artifact hashes for verification:"required" contracts; informational/advisory contracts may verify once with recorded advisory evidence. blocked records an honest incomplete result without pretending success.',
    parameters: Type.Object({ status: Type.String({ description: 'verified or blocked' }), review: shortString(), launch: shortString(), limitations: Type.Array(shortString(), { maxItems: 20 }) }),
    async execute(_id, params, _signal, _update, ctx) {
      return exclusive(() => workspaceOperation(ctx, async () => {
        if (!state) throw Error('Call delivery_plan first');
        if (configError) throw Error(configError);
        if (!['verified', 'blocked'].includes(params.status)) throw Error('status must be verified or blocked');
        const verification = verificationMode(state.plan);
        const advisory = verification !== 'required';
        let hash: string | null = null;
        if (params.status === 'verified') {
          if (advisory) {
            // Informational finish: freshness is not a hard gate, but a best-effort
            // fingerprint keeps later edits visible in the durable report.
            try { hash = fingerprint(ctx.cwd, ['.']); } catch { hash = null; }
          } else {
            hash = fingerprint(ctx.cwd, ['.']);
            const issues = completionIssues(state, ctx.cwd, hash);
            if (Object.values(issues).some((items: any) => items.length)) throw Error(`Cannot verify. Missing artifacts: ${issues.missingArtifacts.join(', ')}. Failed/missing/stale checks: ${issues.pendingChecks.join(', ')}. Missing outputs: ${issues.missingOutputs.join(', ')}. Incomplete steps: ${issues.incompleteSteps.join(', ')}. Unverified requirements: ${issues.unverifiedRequirements.join('; ')}. Review: ${issues.review.join('; ')}`);
          }
        } else {
          if (!params.limitations.length) throw Error('Blocked delivery requires an explicit limitation/reason');
          try {
            hash = fingerprint(ctx.cwd, ['.']);
          } catch {
            hash = 'unfingerprinted:scope_exceeded';
          }
        }
        state.status = params.status;
        const advisoryFailures = Object.entries(state.evidence || {}).filter(([, e]: any) => !e.passed).map(([id]) => id);
        state.handoff = { ...params, verification, advisory, advisoryFailures, fingerprint: hash, at: new Date().toISOString(), evidence: structuredClone(state.evidence), reviewEvidence: state.reviewEvidence ? structuredClone(state.reviewEvidence) : null };
        persist(ctx);
        return text({ status: state.status, verification, advisory, advisoryFailures, report: join(directory(ctx), 'report.json'), note: advisory ? 'Informational/advisory finish: recorded checks are context, not a delivery guarantee. Distinguish them from unperformed manual/visual review.' : 'Evidence covers declared checks, not a guarantee of correctness. Distinguish automated evidence from unperformed manual/visual review.' });
      }));
    },
  });
  pi.on('agent_end', (event, ctx) => {
    clearTimeout(budgetTimer);
    if (ensureBudget(ctx)) return;
    let release: (() => void) | undefined;
    try {
      release = lockWorkspace(ctx.cwd);
      refreshState(ctx);
    } catch { release?.(); return; } // Another operation/run owns continuation; never replay stale repairs.
    try {
    const last = [...event.messages].reverse().find((m: any) => m.role === 'assistant') as any;
    let fresh = false, pending: string[] = [], failures: string[] = [];
    try {
      const hash = fingerprint(ctx.cwd, ['.']);
      fresh = !!state && state.handoff?.fingerprint === hash;
      if (state) {
        pending = pendingChecks(state, hash);
        failures = Object.entries(state.evidence).filter(([, e]: any) => !e.passed)
          .map(([id, e]: any) => `check ${id} failed (exit ${e.code}, timedOut ${e.timedOut})${e.outputTail ? `; last output: ${String(e.outputTail).slice(-400)}` : ''}`);
      }
    } catch { /* explicit re-verification required */ }
    if (!shouldContinue({ state, touched, nudges, stopReason: last?.stopReason, pendingMessages: ctx.hasPendingMessages(), fresh })) return;
    if (ensureBudget(ctx, 'repair')) return;
    nudges++;
    if (state) persist(ctx);
    const specifics = [...(pending.length ? [`pending checks: ${pending.join(', ')}`] : []), ...failures].join('\n');
    pi.sendMessage({ customType: 'delivery-gate', display: true, content: `Delivery follow-up ${nudges}/2: implementation ended without current verified evidence.${specifics ? `\n${specifics}\n` : ''}Read the quoted output, repair the root cause it points to (do not rationalize a failing probe as an environment limitation without evidence), rerun the failing checks, then delivery_finish. If genuinely blocked, record status=blocked with specific limitations. Do not merely repeat a success claim.` }, { triggerTurn: true, deliverAs: 'followUp' });
    } finally { release(); }
  });
}
