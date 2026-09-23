#!/usr/bin/env node
/**
 * Carthagent CLI - Evidence-driven delivery & contract verification
 */
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import {
  fingerprint,
  evidenceIdentity,
  evidenceFresh,
  validatePlan,
  planD2,
  runCommand
} from '../lib/delivery.mjs';
import { lockWorkspace, selectReport } from '../lib/workspace.mjs';
import { beginReview, parseFindings } from '../lib/review-state.mjs';
import { latestReport, saveReport } from '../lib/reports.mjs';
import { normalizeReviewMode, resolveReviewMode, loadCarthagentConfig, saveCarthagentConfig, carthagentConfigPath, reviewerPrompt, parseVerdict, resolveStickyDefaults } from '../lib/review.mjs';

// Ensure Carthagent operates completely isolated in its own agent directory (~/.carthagent/agent)
// so it NEVER touches, reads, or piggybacks on any existing ~/.pi/agent installation.
const defaultAgentDir = process.env.CARTHAGENT_AGENT_DIR || process.env.CARTHAGENT_CODING_AGENT_DIR || join(os.homedir(), '.carthagent', 'agent');
if (!process.env.CARTHAGENT_CODING_AGENT_DIR && !process.env.CARTHAGENT_AGENT_DIR) {
  process.env.CARTHAGENT_CODING_AGENT_DIR = defaultAgentDir;
}
if (!process.env.PI_CODING_AGENT_DIR) {
  process.env.PI_CODING_AGENT_DIR = process.env.CARTHAGENT_CODING_AGENT_DIR || defaultAgentDir;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cwd = process.cwd();
const root = resolve(__dirname, '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

const argv = process.argv.slice(2);
const command = argv[0];

function printHelp() {
  console.log(`
\x1b[1m\x1b[36mCarthagent\x1b[0m \x1b[90m${version}\x1b[0m \x1b[2m(ctg)\x1b[0m

\x1b[1mUSAGE:\x1b[0m
  ctg                            Launch the interactive split-terminal delivery console
  ctg <task>                     Open the console and immediately deliver <task>
  ctg --list-models [search]     List available provider models
  ctg <command> [options]

\x1b[1mCOMMANDS:\x1b[0m
  \x1b[32mtui\x1b[0m, \x1b[32mui\x1b[0m                 Interactive console: live run feed + live plan.d2 side panel
  \x1b[32mresume\x1b[0m, \x1b[32msessions\x1b[0m          Open the console with the session picker to resume prior work
  \x1b[32mcontinue\x1b[0m               Open the console on the most recent session
  \x1b[32mdemo\x1b[0m                  Same console driven by a scripted mock run — no provider needed
  \x1b[32mstatus\x1b[0m, \x1b[32ms\x1b[0m             Display workspace fingerprint, active contract & pending checks
  \x1b[32mcheck\x1b[0m [id], \x1b[32mc\x1b[0m [id]     Execute check suite (default: 'all') in bounded subprocess
  \x1b[32mhash\x1b[0m, \x1b[32mfingerprint\x1b[0m     Calculate workspace SHA-256 source freshness fingerprint
  \x1b[32mvalidate\x1b[0m <file.json> Validate acceptance contract against delivery schema
  \x1b[32mlogin\x1b[0m, \x1b[32mauth\x1b[0m             Connect an AI provider (interactive login)
  \x1b[32maccount\x1b[0m               Show Ship credit, plan, grants, and CLI sessions
  \x1b[32mbilling\x1b[0m [checkout|portal] Open Ship subscription billing
  \x1b[32mlogout-cloud\x1b[0m [session] Revoke the current or named Ship CLI session
  \x1b[32mserve\x1b[0m, \x1b[32mweb\x1b[0m, \x1b[32mstart\x1b[0m     Start the interactive web dashboard on port 3000
  \x1b[32mtest\x1b[0m                   Run core unit test suite
  \x1b[32meval\x1b[0m [args...]         Run evaluation harness (evaluate.mjs)
  \x1b[32mreview\x1b[0m                Show self-review default · \x1b[32mreview\x1b[0m ask|yes|no sets it
  \x1b[32mreview\x1b[0m <pr>           Run a fresh-context review of a pull request
  \x1b[32mhelp\x1b[0m, \x1b[32m--help\x1b[0m, \x1b[32m-h\x1b[0m       Display this help message

\x1b[1mTUI OPTIONS:\x1b[0m
  --provider <name>       Provider for the AI agent (default: provider settings)
  --model <id>            Model id or pattern (e.g. openrouter/inkling, sonnet)
                          In the TUI, type on the model row to search/autocomplete
  --thinking <level>      off|minimal|low|medium|high|xhigh|max
  --theme <name>          opencode | tokyonight | nebula | ember | forest | mono |
                          obsidian | midnight | nord | paper | daylight |
                          solarized-dark | solarized-light | solarized |
                          okabe-dark | okabe-light | okabe |
                          contrast-dark | contrast-light | contrast | system
  --agent-cli, --engine-cli   Explicit path to agent entrypoint
  --session <path|id>     Resume a specific session file or partial session id
  --continue, -c          Resume the most recent session for this directory
  --resume, -r            Open the session picker at startup (TUI only)
  --validators <file>     User-owned required-validator manifest (delivery)
  --context <file>        Extra task/delivery context file
  --bash-cap <sec>        Cap un-timed shell tool timeouts during a run
  --max-tools <n>         Session tool-call budget (0 disables)
  --max-seconds <n>       Session elapsed-time budget (0 disables)
  --max-repairs <n>       Session automatic-repair budget (0 disables)
  --review <mode>         Self-review loop after major changes: ask|yes|no
                          (default: ~/.carthagent/config.json, else ask — /review in-session)
  --isolate               Run with only Carthagent's delivery extension (no other extensions/skills)
  --no-strict             Don't require delivery_plan before write/edit tools
  --no-delivery           Run the console without the delivery extension
  --no-guide              Send prompts verbatim instead of auto-applying delivery framing
  --guide                 Force delivery framing on (default)
  --ascii                 Plain-ASCII glyphs (for fonts that render icons as ?)
  --glyphs <mode>         Glyph tier: auto (default) | unicode | ascii
  --demo                  Drive the console with a scripted mock run (no provider)
  -p, --print             Headless passthrough: stream output without TUI

\x1b[1mTUI KEYS:\x1b[0m
  enter send/steer · esc abort (again = force-restart agent) · ^r resume session · tab focus · shift+tab view
  up/down history/scroll · pgup/pgdn/wheel scroll focused pane · drag-select copies · ^t settings · ^n new session · x expand · ^c quit

\x1b[1mEXAMPLES:\x1b[0m
  ctg
  ctg "Build a task CLI with tests"
  ctg --model sonnet --theme opencode "Fix the failing tests in src/"
  ctg --validators validators.json "Migrate the schema"
`);
}

// ---------------------------------------------------------------- TUI routing

import { validateBudgetOptions } from '../lib/budget.mjs';

const TUI_FLAGS = {
  '--provider': 'provider', '--model': 'model', '--thinking': 'thinking', '--theme': 'theme',
  '--engine-cli': 'engineCli', '--agent-cli': 'engineCli', '--validators': 'validators', '--context': 'context', '--bash-cap': 'bashCap',
  '--max-tools': 'maxTools', '--max-seconds': 'maxSeconds', '--max-repairs': 'maxRepairs',
  '--session': 'session', '--review': 'review', '--glyphs': 'glyphs',
};
const TUI_BOOL = {
  '--isolate': ['isolate', true], '--no-strict': ['strict', false], '--strict': ['strict', true],
  '--no-delivery': ['delivery', false], '-p': ['print', true], '--print': ['print', true],
  '--no-guide': ['autoFraming', false], '--guide': ['autoFraming', true],
  '--ascii': ['ascii', true],
  '--demo': ['demo', true],
  '-c': ['continue', true], '--continue': ['continue', true],
  '-r': ['resume', true], '--resume': ['resume', true],
};

function parseTuiArgs(list) {
  const opts = {};
  const prompt = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a === '--') { prompt.push(...list.slice(i + 1)); break; }
    if (TUI_FLAGS[a]) {
      const value = list[++i];
      if (value === undefined || value.startsWith('--')) throw Error(`Missing value for ${a}`);
      opts[TUI_FLAGS[a]] = value; continue;
    }
    if (TUI_BOOL[a]) { const [k, v] = TUI_BOOL[a]; opts[k] = v; continue; }
    if (a.startsWith('-')) { console.error(`\x1b[31mUnknown flag:\x1b[0m ${a}`); process.exit(1); }
    prompt.push(a);
  }
  validateBudgetOptions(opts);
  if (prompt.length) opts.prompt = prompt.join(' ');
  return opts;
}

async function handleListModels(searchPattern) {
  const { loadAuthRuntime } = await import('../lib/tui/auth.mjs');
  const { modelMatchesQuery } = await import('../lib/tui/models.mjs');
  const { providerDisplayName } = await import('../lib/providers/names.mjs');
  const runtime = await loadAuthRuntime();
  const models = runtime.getAvailableSnapshot()
    .filter(model => !searchPattern || modelMatchesQuery({ ...model, full: `${model.provider}/${model.id}`, provider: providerDisplayName(model.provider) }, searchPattern))
    .sort((a, b) => providerDisplayName(a.provider).localeCompare(providerDisplayName(b.provider)) || a.id.localeCompare(b.id));
  for (const model of models) {
    const fields = [providerDisplayName(model.provider), model.id, model.contextWindow, model.maxTokens, model.input, model.output];
    console.log(fields.map(value => value == null ? '?' : value).join('  '));
  }
}

async function handleTui(list) {
  const opts = parseTuiArgs(list);
  // Sticky theme/model: explicit --theme/--model flags win, else fall back to
  // the last choice persisted in ~/.carthagent/config.json. Undefined lets the engine
  // apply its own default rather than forcing a stale id.
  const sticky = resolveStickyDefaults(opts);
  opts.theme = sticky.theme;
  opts.model = sticky.model;
  if (opts.demo && !process.stdout.isTTY) { console.error('demo requires an interactive terminal'); process.exit(1); }
  // Headless passthrough: explicit --print, or stdout isn't a TTY
  if (opts.print || !process.stdout.isTTY) {
    // The session picker needs a TTY — headless -r continues the most recent.
    if (opts.resume) { opts.resume = false; opts.continue = true; }
    const { locateEngine, buildEngineArgs } = await import('../lib/tui/app.mjs');
    const { shouldFrame, framePrompt } = await import('../lib/tui/framing.mjs');
    let engineCmd;
    try { engineCmd = locateEngine(opts.engineCli); } catch (e) { console.error(e.message); process.exit(1); }
    if (!opts.prompt) { console.error('non-interactive mode requires a prompt'); process.exit(1); }
    const { hasConfiguredProvider, loadAuthRuntime } = await import('../lib/tui/auth.mjs');
    if (!hasConfiguredProvider()) {
      console.error('No AI provider connected. Run `ctg login` to connect one (Carthagent Ship is recommended), or set an API key env var (e.g. ANTHROPIC_API_KEY).');
      process.exit(1);
    }
    // Refresh the dynamic Cloud catalog before the engine child reads its
    // persisted model store. This keeps headless/RPC discovery in sync with
    // browser login without fabricating model metadata.
    await loadAuthRuntime();
    const framingOn = (opts.autoFraming ?? true);
    const prompt = shouldFrame(opts.prompt, { enabled: framingOn, delivery: opts.delivery !== false })
      ? framePrompt(opts.prompt) : opts.prompt;
    const args = [...engineCmd.args, '-p', ...buildEngineArgs({ isolate: true, ...opts }), '--', prompt];
    const child = spawn(engineCmd.cmd, args, {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: {
        ...process.env,
        CARTHAGENT_CODING_AGENT_DIR: process.env.CARTHAGENT_CODING_AGENT_DIR || defaultAgentDir,
        PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR || defaultAgentDir
      }
    });
    child.on('exit', code => process.exit(code || 0));
    return;
  }
  const { runTui } = await import('../lib/tui/app.mjs');
  await runTui(opts);
}

async function handleStatus() {
  const currentFp = fingerprint(cwd, ['.']);
  const report = latestReport(cwd);
  console.log(`\x1b[1mWorkspace:\x1b[0m     ${cwd}`);
  console.log(`\x1b[1mFingerprint:\x1b[0m   \x1b[36m${currentFp}\x1b[0m`);
  if (!report?.state?.plan) {
    console.log('\x1b[90mNo delivery report found for this workspace.\x1b[0m');
    return;
  }
  const { state } = report;
  const checkStatus = check => {
    const evidence = state.evidence?.[check.id];
    if (!evidence) return 'pending';
    if (!evidence.passed) return 'failed';
    return evidenceFresh(check, evidence, currentFp, state) ? 'passed' : 'stale';
  };
  console.log(`\x1b[1mStatus:\x1b[0m        ${state.status}`);
  console.log(`\x1b[1mGoal:\x1b[0m          ${state.plan.goal}`);
  console.log(`\x1b[1mChecks:\x1b[0m        ${state.plan.checks.map(check => `${checkStatus(check)}:${check.id}`).join(', ')}`);
  console.log(`\x1b[1mReport:\x1b[0m        ${report.path}`);
}

async function handleHash() {
  const roots = argv.slice(1).length > 0 ? argv.slice(1) : ['.'];
  try {
    const hash = fingerprint(cwd, roots);
    console.log(hash);
  } catch (err) {
    console.error(`\x1b[31mError calculating fingerprint:\x1b[0m ${err.message}`);
    process.exit(1);
  }
}

async function handleCheck() {
  const release = lockWorkspace(cwd);
  try { await runWorkspaceChecks(); } finally { release(); }
}

async function runWorkspaceChecks() {
  const checkId = argv[1] || 'all';
  const report = latestReport(cwd);
  if (!report?.state?.plan) {
    console.error('No delivery report found for this workspace.');
    process.exitCode = 1;
    return;
  }
  selectReport(cwd, report.path);
  const state = report.state;
  const checks = checkId === 'all' ? state.plan.checks : state.plan.checks.filter(check => check.id === checkId);
  if (!checks.length) {
    console.error(`Unknown check ID: ${checkId}`);
    process.exitCode = 1;
    return;
  }

  let allPassed = true;
  const priorStatus = state.status;
  state.status = 'verifying';
  for (const check of checks) {
    const before = fingerprint(cwd, ['.']);
    console.log(`\n\x1b[1m${check.id}\x1b[0m  ${check.argv.join(' ')}`);
    const result = await runCommand(check.argv, {
      cwd,
      timeoutSeconds: check.timeoutSeconds,
      logPath: join(report.dir, `${check.id}-${randomUUID()}.log`)
    });
    const after = fingerprint(cwd, ['.']);
    const passed = result.code === 0 && !result.timedOut && !result.cancelled && !result.outputLimit && before === after;
    state.evidence[check.id] = {
      passed,
      fingerprint: after,
      ...evidenceIdentity(state, check),
      code: result.code,
      timedOut: result.timedOut,
      cancelled: result.cancelled,
      outputLimit: result.outputLimit,
      changedDuringCheck: before !== after,
      durationMs: result.durationMs,
      logPath: result.logPath,
      outputTail: result.output.slice(-1200)
    };
    saveReport(report.path, state);
    if (result.output) console.log(result.output.trim());
    console.log(passed ? `\x1b[32mpassed\x1b[0m (${result.durationMs}ms)` : `\x1b[31mfailed\x1b[0m (exit ${result.code})`);
    allPassed &&= passed;
  }
  state.status = allPassed && priorStatus === 'verified' ? 'verified' : 'implementing';
  saveReport(report.path, state);
  if (!allPassed) process.exitCode = 1;
}

async function handleValidate() {
  const filePath = argv[1];
  if (!filePath) {
    console.error('Usage: ctg validate <path-to-plan.json>');
    process.exit(1);
  }
  try {
    const raw = readFileSync(resolve(cwd, filePath), 'utf8');
    const plan = JSON.parse(raw);
    const validated = validatePlan(plan, cwd);
    console.log('\x1b[32m✓ Acceptance contract is VALID.\x1b[0m');
    console.log(`Goal: ${validated.goal}`);
    console.log(`Checks: ${validated.checks.map(c => c.id).join(', ')}`);
    const d2 = planD2(validated);
    console.log('\n\x1b[1mGenerated D2 Outline:\x1b[0m\n' + d2);
  } catch (err) {
    console.error('\x1b[31m✕ Validation Error:\x1b[0m', err.message);
    process.exit(1);
  }
}

async function handleLogin() {
  if (!process.stdout.isTTY) {
    console.error('login requires an interactive terminal — or set an API key env var (see README)');
    process.exit(1);
  }
  // Use the same Carthagent provider picker as in-session /login and /auth.
  // This keeps ordering, recommendation metadata, and credential storage from
  // drifting between shell and TUI entry points.
  const { runTui } = await import('../lib/tui/app.mjs');
  await runTui({ autoFraming: false, openAuth: true, loginOnly: true });
}

async function cloudRuntime() {
  const { loadAuthRuntime } = await import('../lib/tui/auth.mjs');
  return loadAuthRuntime();
}

async function cloudFailure(error) {
  if (error.message === 'cloud_login_required') console.error('Carthagent Ship is not signed in. Run `ctg login` and choose Carthagent Ship.');
  else {
    const { cloudManagedUsageRecovery } = await import('../lib/cloud/client.mjs');
    console.error(cloudManagedUsageRecovery(error) || `Carthagent Ship: ${error.message}`);
  }
  process.exitCode = 1;
}

async function handleAccount() {
  try {
    const { formatCloudAccount, loadCloudAccount } = await import('../lib/tui/auth.mjs');
    const account = await loadCloudAccount(await cloudRuntime());
    console.log(formatCloudAccount(account));
    const grants = Array.isArray(account.grants) ? account.grants : [];
    if (grants.length) {
      const { formatNanoUsd } = await import('../lib/cloud/client.mjs');
      console.log('\nCredit grants:');
      for (const grant of grants) console.log(`  ${formatNanoUsd(grant.remainingNanoUsd)} remaining of ${formatNanoUsd(grant.originalNanoUsd)} · ${grant.source}${grant.expiresAt ? ` · expires ${grant.expiresAt}` : ''}`);
    }
    const sessions = Array.isArray(account.sessions) ? account.sessions : [];
    if (sessions.length) {
      console.log('\nCLI sessions:');
      for (const session of sessions) console.log(`  ${session.id} · ${session.revoked_at ? 'revoked' : 'active'} · ${session.client_name || 'Carthagent CLI'} · last used ${session.last_used_at || session.created_at}`);
    }
  } catch (error) { await cloudFailure(error); }
}

async function handleBilling() {
  const action = argv[1] || 'checkout';
  if (!['checkout', 'portal'].includes(action)) { console.error('Usage: ctg billing [checkout|portal]'); process.exitCode = 1; return; }
  try {
    const { createCloudBillingLink } = await import('../lib/tui/auth.mjs');
    const { openBrowser } = await import('../lib/cloud/client.mjs');
    const result = await createCloudBillingLink(await cloudRuntime(), action);
    const opened = await openBrowser(result.url).catch(() => false);
    console.log(`${opened ? 'Opened' : 'Open'} ${result.url}`);
  } catch (error) { await cloudFailure(error); }
}

async function handleCloudLogout() {
  try {
    const runtime = await cloudRuntime();
    const sessionId = argv[1];
    if (sessionId) {
      const { revokeCloudSession } = await import('../lib/tui/auth.mjs');
      await revokeCloudSession(runtime, sessionId);
      console.log(`Revoked Ship session ${sessionId}.`);
    } else {
      const { CloudClient, cloudControlUrl } = await import('../lib/cloud/client.mjs');
      const { CARTHAGENT_SHIP_PROVIDER_ID } = await import('../lib/providers/names.mjs');
      if ((await runtime.checkAuth?.(CARTHAGENT_SHIP_PROVIDER_ID))?.type !== 'oauth') throw new Error('cloud_login_required');
      const accessToken = (await runtime.getAuth(CARTHAGENT_SHIP_PROVIDER_ID))?.auth?.apiKey;
      if (!accessToken) throw new Error('cloud_login_required');
      await new CloudClient({ baseUrl: cloudControlUrl() }).revokeCurrent({ accessToken });
      await runtime.logout(CARTHAGENT_SHIP_PROVIDER_ID);
      console.log('Revoked and removed the current Carthagent Ship session.');
    }
  } catch (error) { await cloudFailure(error); }
}

function handleServe() {
  console.log('\x1b[1m[Carthagent]\x1b[0m Launching Evidence-Driven Delivery server...');
  const serverScript = join(root, 'server.mjs');
  const child = spawn(process.execPath, [serverScript], {
    stdio: 'inherit',
    cwd: root,
    env: {
      ...process.env,
      CARTHAGENT_WORKSPACE: cwd,
      CARTHAGENT_CODING_AGENT_DIR: process.env.CARTHAGENT_CODING_AGENT_DIR || defaultAgentDir,
      PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR || defaultAgentDir
    }
  });
  child.on('exit', (code) => process.exit(code || 0));
}

function handleTest() {
  console.log('\x1b[1m[Carthagent]\x1b[0m Running unit test suite...');
  const child = spawn(process.execPath, ['--test', 'tests/*.test.mjs'], {
    stdio: 'inherit',
    cwd: root,
    env: process.env
  });
  child.on('exit', (code) => process.exit(code || 0));
}

/**
 * `ctg review` — self-review control surface:
 *   ctg review              show the effective default and where it's set
 *   ctg review ask|yes|no   persist the default to ~/.carthagent/config.json
 *   ctg review <pr>         run a detached fresh-context reviewer over a PR
 */
async function handleReview(args) {
  const ref = args[0];
  if (!ref || ref === 'status') {
    const config = loadCarthagentConfig();
    console.log(`\x1b[1mself-review default:\x1b[0m \x1b[36m${resolveReviewMode(undefined, config)}\x1b[0m  (config: ${config.review ?? 'unset'} @ ${carthagentConfigPath()})`);
    console.log('\nusage:');
    console.log('  ctg review ask|yes|no   Set the default for all sessions');
    console.log('  ctg review <pr>         Fresh-context review of a pull request now');
    console.log('  ctg --review <mode>     Per-launch override · /review inside a session');
    return;
  }
  const mode = normalizeReviewMode(ref);
  if (mode) {
    saveCarthagentConfig({ review: mode });
    console.log(`\x1b[32mself-review default → ${mode}\x1b[0m  (saved to ${carthagentConfigPath()})`);
    return;
  }
  if (ref.startsWith('-')) {
    console.error(`\x1b[31mUnknown review option:\x1b[0m ${ref}`);
    process.exit(2);
  }
  await runReview(ref, args.slice(1));
}

/**
 * Fresh-context review of a pull request: validates the PR via `gh`, then
 * spawns the bundled engine headless with no extensions/skills so the
 * reviewer brings no shared context. Exit 0 = APPROVE, 1 = CHANGES-REQUESTED,
 * 2 = infrastructure failure (gh, engine, timeout).
 */
async function runReview(prRef, rest) {
  let timeoutSeconds = 300, engineCli;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--timeout') {
      timeoutSeconds = Number(rest[++i]);
      if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 300) { console.error('Review timeout must be an integer from 1 to 300'); process.exit(2); }
    }
    else if (rest[i] === '--agent-cli' || rest[i] === '--engine-cli') engineCli = rest[++i];
    else { console.error(`\x1b[31mUnknown option:\x1b[0m ${rest[i]}`); process.exit(2); }
  }
  const view = await runCommand(['gh', 'pr', 'view', prRef, '--json', 'title,url,headRefName,baseRefName,headRefOid'], { cwd, timeoutSeconds: 30 });
  if (view.code !== 0) {
    console.error(`\x1b[31mCannot load PR ${prRef}\x1b[0m — is gh installed and authenticated, and is ${cwd} a GitHub repo clone?`);
    if (view.output.trim()) console.error(view.output.trim());
    process.exit(2);
  }
  let meta = {};
  try { meta = JSON.parse(view.output); } catch { }
  if (!/^[a-f0-9]{40,64}$/i.test(meta.headRefOid || '')) { console.error('PR head identity unavailable'); process.exit(2); }
  const { locateEngine } = await import('../lib/engine.mjs');
  let engineCmd;
  try { engineCmd = locateEngine(engineCli); } catch (e) { console.error(e.message); process.exit(2); }
  const snapshot = fingerprint(cwd, ['.']);
  let round;
  try { round = beginReview(cwd, meta.url || String(prRef), snapshot, meta.headRefOid); }
  catch (error) { console.error(error.message); process.exitCode = 2; return; }
  try {
  const prompt = reviewerPrompt({ prRef, cwd, meta }) + `\nImmediately before the final VERDICT line emit one single-line REVIEW_JSON: object with version:1, snapshot:${JSON.stringify(snapshot)}, head:${JSON.stringify(meta.headRefOid)}, findings:[{file,line,severity,issue,fix}]. Severity must be blocking or nonblocking; line is a positive integer. Approval requires no blocking findings. No markdown fences.`;
  const logPath = join(cwd, '.harness', 'reviews', `review-${Date.now()}.log`);
  const result = await runCommand(
    [engineCmd.cmd, ...engineCmd.args, '-p', '--no-extensions', '--no-skills', '--no-prompt-templates', '--', prompt],
    { cwd, timeoutSeconds, logPath }
  );
  if (result.output.trim()) process.stdout.write(result.output.trim() + '\n');
  console.log(`\x1b[90mreview log: ${logPath}\x1b[0m`);
  if (result.timedOut) throw Error(`reviewer timed out after ${timeoutSeconds}s`);
  if (result.cancelled || result.code !== 0) throw Error(`reviewer exited abnormally (code ${result.code})`);
  const after = await runCommand(['gh', 'pr', 'view', prRef, '--json', 'title,url,headRefName,baseRefName,headRefOid'], { cwd, timeoutSeconds: 30 });
  let afterMeta;
  try { afterMeta = JSON.parse(after.output); } catch { }
  if (after.code !== 0 || afterMeta?.headRefOid !== meta.headRefOid) throw Error('PR head changed or unavailable; verdict is stale');
  if (fingerprint(cwd, ['.']) !== snapshot) throw Error('Review source snapshot changed; verdict is stale');
  const verdict = parseVerdict(result.output);
  if (!verdict) throw Error('reviewer produced no VERDICT line — treat as inconclusive');
  const findings = parseFindings(result.output, snapshot, meta.headRefOid, verdict);
  round.finish(verdict === 'APPROVE' ? 'approved' : 'changes-requested', findings);
  process.exitCode = verdict === 'APPROVE' ? 0 : 1;
  } catch (error) {
    round.finish('inconclusive', { error: error.message });
    console.error(error.message);
    process.exitCode = 2;
  } finally { round.release(); }
}

function handleEval() {
  const evalScript = join(root, 'evaluate.mjs');
  const child = spawn(process.execPath, [evalScript, ...argv.slice(1)], {
    stdio: 'inherit',
    cwd: root,
    env: process.env
  });
  child.on('exit', (code) => process.exit(code || 0));
}

// Router
switch (command) {
  case 'tui':
  case 'ui':
  case 'interactive':
    handleTui(argv.slice(1));
    break;
  case 'demo':
    handleTui([...argv.slice(1), '--demo']);
    break;
  case 'resume':
  case 'sessions':
    handleTui([...argv.slice(1), '--resume']);
    break;
  case 'continue':
    handleTui([...argv.slice(1), '--continue']);
    break;
  case 'status':
  case 's':
    handleStatus();
    break;
  case 'hash':
  case 'fingerprint':
    handleHash();
    break;
  case 'check':
  case 'c':
    handleCheck();
    break;
  case 'validate':
    handleValidate();
    break;
  case 'login':
  case 'auth':
    handleLogin();
    break;
  case 'account':
  case 'cloud':
    handleAccount();
    break;
  case 'billing':
    handleBilling();
    break;
  case 'logout-cloud':
    handleCloudLogout();
    break;
  case 'serve':
  case 'web':
  case 'start':
    handleServe();
    break;
  case 'test':
    handleTest();
    break;
  case 'eval':
    handleEval();
    break;
  case 'review':
    handleReview(argv.slice(1));
    break;
  case 'help':
  case '--help':
  case '-h':
    printHelp();
    break;
  case '--version':
  case '-v':
    console.log(version);
    break;
  case '--list-models':
    handleListModels(argv.slice(1).join(' '));
    break;
  case undefined:
    // Bare `ctg` → interactive split-terminal console
    handleTui([]);
    break;
  default:
    // engine-style: unknown first arg means the args ARE the task prompt
    // e.g. `ctg "Build a task CLI"` or `ctg --model sonnet "Fix tests"`
    if (command.startsWith('-') && !TUI_FLAGS[command] && !TUI_BOOL[command]) {
      console.error(`\x1b[31mUnknown command or flag:\x1b[0m ${command}`);
      printHelp();
      process.exit(1);
    }
    handleTui(argv);
}
