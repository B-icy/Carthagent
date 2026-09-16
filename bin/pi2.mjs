#!/usr/bin/env node
/**
 * pi2 CLI - Evidence-driven delivery & contract verification
 */
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import {
  fingerprint,
  validatePlan,
  planD2,
  runCommand
} from '../lib/delivery.mjs';
import { latestReport, saveReport } from '../lib/reports.mjs';
import { normalizeReviewMode, resolveReviewMode, loadPi2Config, savePi2Config, pi2ConfigPath, reviewerPrompt, parseVerdict, resolveStickyDefaults } from '../lib/review.mjs';

// Ensure pi2 operates completely isolated in its own agent directory (~/.pi2/agent)
// so it NEVER touches, reads, or piggybacks on any existing ~/.pi/agent installation.
const defaultAgentDir = process.env.PI2_AGENT_DIR || process.env.PI2_CODING_AGENT_DIR || join(os.homedir(), '.pi2', 'agent');
if (!process.env.PI2_CODING_AGENT_DIR && !process.env.PI2_AGENT_DIR) {
  process.env.PI2_CODING_AGENT_DIR = defaultAgentDir;
}
if (!process.env.PI_CODING_AGENT_DIR) {
  process.env.PI_CODING_AGENT_DIR = process.env.PI2_CODING_AGENT_DIR || defaultAgentDir;
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
\x1b[1m\x1b[36mpi2\x1b[0m \x1b[90m${version}\x1b[0m

\x1b[1mUSAGE:\x1b[0m
  pi2                     Launch the interactive split-terminal delivery console
  pi2 <task>              Open the console and immediately deliver <task>
  pi2 <command> [options]

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
  --agent-cli, --pi-cli   Explicit path to agent entrypoint
  --session <path|id>     Resume a specific session file or partial session id
  --continue, -c          Resume the most recent session for this directory
  --resume, -r            Open the session picker at startup (TUI only)
  --validators <file>     User-owned required-validator manifest (delivery)
  --context <file>        Extra task/delivery context file
  --bash-cap <sec>        Cap un-timed shell tool timeouts during a run
  --review <mode>         Self-review loop after major changes: ask|yes|no
                          (default: ~/.pi2/config.json, else ask — /review in-session)
  --isolate               Run with only pi2's delivery extension (no other extensions/skills)
  --no-strict             Don't require delivery_plan before write/edit tools
  --no-delivery           Run the console without the delivery extension
  --no-guide              Send prompts verbatim instead of auto-applying delivery framing
  --guide                 Force delivery framing on (default)
  --ascii                 Plain-ASCII glyphs (for fonts that render icons as ?)
  --glyphs <mode>         Glyph tier: auto (default) | unicode | ascii
  --demo                  Drive the console with a scripted mock run (no provider)
  -p, --print             Headless passthrough: stream output without TUI

\x1b[1mTUI KEYS:\x1b[0m
  enter send/steer · esc abort (again = force-restart agent) · ^r resume session · tab focus · ⇧tab view
  ↑↓ history/scroll · pgup/pgdn/wheel scroll focused pane · drag-select copies · ^t settings · ^n new session · x expand · ^c quit

\x1b[1mEXAMPLES:\x1b[0m
  pi2
  pi2 "Build a task CLI with tests"
  pi2 --model sonnet --theme opencode "Fix the failing tests in src/"
  pi2 --validators validators.json "Migrate the schema"
`);
}

// ---------------------------------------------------------------- TUI routing

const TUI_FLAGS = {
  '--provider': 'provider', '--model': 'model', '--thinking': 'thinking', '--theme': 'theme',
  '--pi-cli': 'piCli', '--agent-cli': 'piCli', '--validators': 'validators', '--context': 'context', '--bash-cap': 'bashCap',
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
    if (TUI_FLAGS[a]) { opts[TUI_FLAGS[a]] = list[++i]; continue; }
    if (TUI_BOOL[a]) { const [k, v] = TUI_BOOL[a]; opts[k] = v; continue; }
    if (a.startsWith('-')) { console.error(`\x1b[31mUnknown flag:\x1b[0m ${a}`); process.exit(1); }
    prompt.push(a);
  }
  if (prompt.length) opts.prompt = prompt.join(' ');
  return opts;
}

async function handleTui(list) {
  const opts = parseTuiArgs(list);
  // Sticky theme/model: explicit --theme/--model flags win, else fall back to
  // the last choice persisted in ~/.pi2/config.json. Undefined lets the engine
  // apply its own default rather than forcing a stale id.
  const sticky = resolveStickyDefaults(opts);
  opts.theme = sticky.theme;
  opts.model = sticky.model;
  if (opts.demo && !process.stdout.isTTY) { console.error('demo requires an interactive terminal'); process.exit(1); }
  // Headless passthrough: explicit --print, or stdout isn't a TTY
  if (opts.print || !process.stdout.isTTY) {
    // The session picker needs a TTY — headless -r continues the most recent.
    if (opts.resume) { opts.resume = false; opts.continue = true; }
    const { locatePi, buildPiArgs } = await import('../lib/tui/app.mjs');
    const { shouldFrame, framePrompt } = await import('../lib/tui/framing.mjs');
    let piCmd;
    try { piCmd = locatePi(opts.piCli); } catch (e) { console.error(e.message); process.exit(1); }
    if (!opts.prompt) { console.error('non-interactive mode requires a prompt'); process.exit(1); }
    const framingOn = (opts.autoFraming ?? true);
    const prompt = shouldFrame(opts.prompt, { enabled: framingOn, delivery: opts.delivery !== false })
      ? framePrompt(opts.prompt) : opts.prompt;
    const args = [...piCmd.args, '-p', ...buildPiArgs({ isolate: true, ...opts }), '--', prompt];
    const child = spawn(piCmd.cmd, args, {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: {
        ...process.env,
        PI2_CODING_AGENT_DIR: process.env.PI2_CODING_AGENT_DIR || defaultAgentDir,
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
    return evidence.fingerprint === currentFp ? 'passed' : 'stale';
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
  const checkId = argv[1] || 'all';
  const report = latestReport(cwd);
  if (!report?.state?.plan) {
    console.error('No delivery report found for this workspace.');
    process.exit(1);
  }
  const state = report.state;
  const checks = checkId === 'all' ? state.plan.checks : state.plan.checks.filter(check => check.id === checkId);
  if (!checks.length) {
    console.error(`Unknown check ID: ${checkId}`);
    process.exit(1);
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
  if (!allPassed) process.exit(1);
}

async function handleValidate() {
  const filePath = argv[1];
  if (!filePath) {
    console.error('Usage: pi2 validate <path-to-plan.json>');
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
  const { locatePi } = await import('../lib/pi.mjs');
  let piCmd;
  try { piCmd = locatePi(); } catch (e) { console.error(e.message); process.exit(1); }
  console.log('Opening auth setup — run \x1b[36m/login\x1b[0m to pick a provider (subscription OAuth or API key), then \x1b[36m/quit\x1b[0m when done.');
  const child = spawn(piCmd.cmd, piCmd.args, {
    stdio: 'inherit',
    cwd,
    env: {
      ...process.env,
      PI2_CODING_AGENT_DIR: process.env.PI2_CODING_AGENT_DIR || defaultAgentDir,
      PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR || defaultAgentDir
    }
  });
  child.on('exit', code => process.exit(code || 0));
}

function handleServe() {
  console.log('\x1b[1m[pi2]\x1b[0m Launching Evidence-Driven Delivery server...');
  const serverScript = join(root, 'server.mjs');
  const child = spawn(process.execPath, [serverScript], {
    stdio: 'inherit',
    cwd: root,
    env: {
      ...process.env,
      PI2_WORKSPACE: cwd,
      PI2_CODING_AGENT_DIR: process.env.PI2_CODING_AGENT_DIR || defaultAgentDir,
      PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR || defaultAgentDir
    }
  });
  child.on('exit', (code) => process.exit(code || 0));
}

function handleTest() {
  console.log('\x1b[1m[pi2]\x1b[0m Running unit test suite...');
  const child = spawn(process.execPath, ['--test', 'tests/*.test.mjs'], {
    stdio: 'inherit',
    cwd: root,
    env: process.env
  });
  child.on('exit', (code) => process.exit(code || 0));
}

/**
 * `pi2 review` — self-review control surface:
 *   pi2 review              show the effective default and where it's set
 *   pi2 review ask|yes|no   persist the default to ~/.pi2/config.json
 *   pi2 review <pr>         run a detached fresh-context reviewer over a PR
 */
async function handleReview(args) {
  const ref = args[0];
  if (!ref || ref === 'status') {
    const config = loadPi2Config();
    console.log(`\x1b[1mself-review default:\x1b[0m \x1b[36m${resolveReviewMode(undefined, config)}\x1b[0m  (config: ${config.review ?? 'unset'} @ ${pi2ConfigPath()})`);
    console.log('\nusage:');
    console.log('  pi2 review ask|yes|no   Set the default for all sessions');
    console.log('  pi2 review <pr>         Fresh-context review of a pull request now');
    console.log('  pi2 --review <mode>     Per-launch override · /review inside a session');
    return;
  }
  const mode = normalizeReviewMode(ref);
  if (mode) {
    savePi2Config({ review: mode });
    console.log(`\x1b[32mself-review default → ${mode}\x1b[0m  (saved to ${pi2ConfigPath()})`);
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
  let timeoutSeconds = 300, piCli;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--timeout') timeoutSeconds = Math.max(1, Number(rest[++i]) || 300);
    else if (rest[i] === '--agent-cli' || rest[i] === '--pi-cli') piCli = rest[++i];
    else { console.error(`\x1b[31mUnknown option:\x1b[0m ${rest[i]}`); process.exit(2); }
  }
  const view = await runCommand(['gh', 'pr', 'view', prRef, '--json', 'title,url,headRefName,baseRefName'], { cwd, timeoutSeconds: 30 });
  if (view.code !== 0) {
    console.error(`\x1b[31mCannot load PR ${prRef}\x1b[0m — is gh installed and authenticated, and is ${cwd} a GitHub repo clone?`);
    if (view.output.trim()) console.error(view.output.trim());
    process.exit(2);
  }
  let meta = {};
  try { meta = JSON.parse(view.output); } catch { }
  const { locatePi } = await import('../lib/pi.mjs');
  let piCmd;
  try { piCmd = locatePi(piCli); } catch (e) { console.error(e.message); process.exit(2); }
  const prompt = reviewerPrompt({ prRef, cwd, meta });
  const logPath = join(cwd, '.harness', 'reviews', `review-${Date.now()}.log`);
  const result = await runCommand(
    [piCmd.cmd, ...piCmd.args, '-p', '--no-extensions', '--no-skills', '--no-prompt-templates', '--', prompt],
    { cwd, timeoutSeconds, logPath }
  );
  if (result.output.trim()) process.stdout.write(result.output.trim() + '\n');
  console.log(`\x1b[90mreview log: ${logPath}\x1b[0m`);
  if (result.timedOut) { console.error(`\x1b[31mreviewer timed out after ${timeoutSeconds}s\x1b[0m`); process.exit(2); }
  if (result.cancelled || result.code !== 0) { console.error(`\x1b[31mreviewer exited abnormally (code ${result.code})\x1b[0m`); process.exit(2); }
  const verdict = parseVerdict(result.output);
  if (!verdict) { console.error('\x1b[31mreviewer produced no VERDICT line — treat as inconclusive\x1b[0m'); process.exit(2); }
  process.exit(verdict === 'APPROVE' ? 0 : 1);
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
  case undefined:
    // Bare `pi2` → interactive split-terminal console
    handleTui([]);
    break;
  default:
    // pi-style: unknown first arg means the args ARE the task prompt
    // e.g. `pi2 "Build a task CLI"` or `pi2 --model sonnet "Fix tests"`
    if (command.startsWith('-') && !TUI_FLAGS[command] && !TUI_BOOL[command]) {
      console.error(`\x1b[31mUnknown command or flag:\x1b[0m ${command}`);
      printHelp();
      process.exit(1);
    }
    handleTui(argv);
}
