/**
 * OpenCode-facing command-line adapter.
 *
 * The CLI deliberately depends on a small runtime port rather than importing
 * OpenCode implementation modules. The native service owns process startup,
 * authentication, model discovery, and session execution; this module owns
 * stable ctg argv compatibility and output/exit-code behavior.
 */

const VALUE_FLAGS = new Map([
  ['--provider', 'provider'], ['--model', 'model'], ['--thinking', 'thinking'],
  ['--theme', 'theme'], ['--engine-cli', 'engineCli'], ['--agent-cli', 'engineCli'],
  ['--session', 'session'], ['--validators', 'validators'], ['--context', 'context'],
  ['--bash-cap', 'bashCap'], ['--max-tools', 'maxTools'], ['--max-seconds', 'maxSeconds'],
  ['--max-repairs', 'maxRepairs'], ['--review', 'review'], ['--glyphs', 'glyphs'],
  ['--codegraph-max-files', 'codegraphMaxFiles'], ['--workflow', 'workflow'],
  ['--rewrite-cap', 'rewriteCap'], ['--tool-output-cap', 'toolOutputCap'], ['--turn-delay-ms', 'turnDelayMs'],
  ['--jev-provider', 'jevProvider'], ['--agent', 'agent'], ['--mode', 'agent'],
]);

const BOOL_FLAGS = new Map([
  ['--isolate', ['isolate', true]], ['--strict', ['strict', true]], ['--no-strict', ['strict', false]],
  ['--no-delivery', ['delivery', false]], ['--delivery', ['delivery', true]],
  ['--no-guide', ['autoFraming', false]], ['--guide', ['autoFraming', true]],
  ['--ascii', ['ascii', true]], ['--json', ['json', true]], ['-p', ['print', true]],
  ['--protect-existing', ['protectExisting', true]], ['--jev', ['jev', true]], ['--no-jev', ['jev', false]], ['--fast-lane', ['fastLane', true]], ['--no-fast-lane', ['fastLane', false]],
  ['--print', ['print', true]], ['--demo', ['demo', true]], ['-c', ['continue', true]],
  ['--continue', ['continue', true]], ['-r', ['resume', true]], ['--resume', ['resume', true]],
  ['--reset-budget', ['resetBudget', true]],
]);

const aliases = new Map([
  ['ui', 'tui'], ['interactive', 'tui'], ['sessions', 'resume'], ['s', 'status'],
  ['fingerprint', 'hash'], ['c', 'check'], ['auth', 'login'], ['cloud', 'account'], ['upgrade', 'update'],
  ['archives', 'archive'],
  ['web', 'serve'], ['start', 'serve'],
]);

export function parseOpenCodeArgs(argv) {
  const options = {};
  const prompt = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      prompt.push(...argv.slice(i + 1));
      break;
    }
    if (VALUE_FLAGS.has(arg)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[VALUE_FLAGS.get(arg)] = value;
      continue;
    }
    if (BOOL_FLAGS.has(arg)) {
      const [key, value] = BOOL_FLAGS.get(arg);
      options[key] = value;
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`Unknown flag: ${arg}`);
    prompt.push(arg);
  }
  if (prompt.length) options.prompt = prompt.join(' ');
  return options;
}

export function cliHelp(version = '') {
  return `\n\x1b[1m\x1b[36mCarthagent\x1b[0m${version ? ` \x1b[90m${version}\x1b[0m` : ''} \x1b[2m(ctg)\x1b[0m

\x1b[1mUSAGE:\x1b[0m
  ctg                            Launch the native Carthagent delivery console
  ctg <task>                     Start a session and deliver <task>
  ctg --list-models [search]     List available provider models
  ctg <command> [options]
  ctg service stop        Stop this profile’s background service safely
  ctg review workspace --request-file <task.txt> [--provider <name> --model <id>]

\x1b[1mCOMMANDS:\x1b[0m
  native [args]           Compatibility alias; native is now the default
  \x1b[32mtui\x1b[0m, \x1b[32mui\x1b[0m                 Interactive console
  \x1b[32mresume\x1b[0m, \x1b[32msessions\x1b[0m          Open the session picker
  \x1b[32mcontinue\x1b[0m               Continue the most recent session
  \x1b[32mdemo\x1b[0m                  Run the scripted demonstration
  \x1b[32mstatus\x1b[0m, \x1b[32ms\x1b[0m             Display workspace fingerprint, contract and checks
  \x1b[32mcheck\x1b[0m [id], \x1b[32mc\x1b[0m [id]     Execute a declared check
  \x1b[32mhash\x1b[0m, \x1b[32mfingerprint\x1b[0m     Calculate workspace SHA-256 fingerprint
  \x1b[32mvalidate\x1b[0m <file.json> Validate acceptance contract
  \x1b[32mlogin\x1b[0m, \x1b[32mauth\x1b[0m             Connect Carthagent Cloud or your own provider (free)
  \x1b[32mdoctor\x1b[0m                 Check Node, runtime, service, providers and sign-in
  \x1b[32maccount\x1b[0m               Show Cloud credit, plan, grants and CLI sessions
  \x1b[32mbilling\x1b[0m [checkout|portal|refresh] Open or refresh Cloud billing
  \x1b[32mlogout-cloud\x1b[0m [session] Revoke the current or named Cloud session
  \x1b[32marchive\x1b[0m [list|search|read|export] Read-only legacy session archive
  \x1b[32mreview\x1b[0m                Configure self-review or review a PR
  \x1b[32mserve\x1b[0m, \x1b[32mweb\x1b[0m, \x1b[32mstart\x1b[0m     Start the web dashboard
  \x1b[32mtest\x1b[0m                   Run core tests
  \x1b[32meval\x1b[0m [args...]         Run evaluation harness
  \x1b[32mupdate\x1b[0m [--check] [--channel stable|beta|experimental]  Update Carthagent
  \x1b[32mhelp\x1b[0m, \x1b[32m--help\x1b[0m, \x1b[32m-h\x1b[0m       Display this help

\x1b[1mOPTIONS:\x1b[0m
  --provider <name>       Provider for the agent
  --model <id>            Model id or pattern
  --agent, --mode <name>  Agent: ship (default), quick, plan or build
  --thinking <level>      off|minimal|low|medium|high|xhigh|max
  --theme <name>          Carthagent theme name
  --engine-cli, --agent-cli <path>  Explicit native runtime executable override
  --session <path|id>     Resume a specific session
  --continue, -c          Resume the most recent session
  --resume, -r            Open the session picker
  --validators <file>     Required-validator manifest
  --context <file>        Extra task context file
  --bash-cap <sec>        Cap shell tool timeouts
  --max-tools <n>          Session tool-call budget (0 disables)
  --max-seconds <n>        Session elapsed-time budget (0 disables)
  --max-repairs <n>        Automatic-repair budget (0 disables)
  --reset-budget           Explicitly reset a resumed session's execution budget
                           Budgets persist across continuation, including idle time.
  --protect-existing      Preserve files present at session start
  --rewrite-cap <n>        Whole-file writes per path (0 disables)
  --tool-output-cap <n>    Bound text output per tool result
  --turn-delay-ms <n>      Pace tool loops
  --jev, --no-jev          Enable/disable advisory plan analysis (on for Ship models)
  --jev-provider <name>    ship|openrouter|typesafe
  --no-fast-lane           Ship: always use the full delivery flow, even for small edits
  --review <mode>          Self-review: ask|yes|no
  --isolate                Isolate extension/skill discovery (not a worktree)
  --no-strict              Disable delivery-plan write gate
  --no-delivery            Run without delivery behavior
  --no-guide               Disable prompt framing
  -p, --print              Headless text output
  --json                   Headless JSONL events
`;
}

// Per-command usage for `ctg <command> --help`. Help never performs the
// command's side effects (sign-in, account fetches, checks, updates).
const COMMAND_HELP = {
  tui: 'Usage: ctg tui [options]\n\nOpen the interactive Carthagent console in this directory. Accepts the run options shown in `ctg --help`.',
  resume: 'Usage: ctg resume [options]\n\nOpen the session picker for this workspace.',
  continue: 'Usage: ctg continue [options]\n\nContinue the most recent session in this workspace.',
  demo: 'Usage: ctg demo\n\nRun the scripted, provider-free delivery walkthrough. Needs no account or API key.',
  status: 'Usage: ctg status [--json]\n\nShow the workspace fingerprint and the latest delivery report (status, goal, checks).',
  hash: 'Usage: ctg hash [path...]\n\nPrint the SHA-256 evidence fingerprint of the workspace or of the given relative paths.',
  check: 'Usage: ctg check [check-id|all]\n\nRe-run a declared check (default: all) from the latest delivery report and record fresh evidence.',
  validate: 'Usage: ctg validate <plan.json>\n\nValidate an acceptance contract (goal, artifacts, steps, checks) and print its outline.',
  login: 'Usage: ctg login [provider]\n\nConnect a model provider. Choose Carthagent Cloud (Google or email sign-in; starter credit when eligible)\nor bring your own provider for free: Claude/Anthropic, Codex/OpenAI, Gemini, xAI and others.\nRequires an interactive terminal; for CI set a provider API key environment variable instead\n(for example ANTHROPIC_API_KEY or OPENAI_API_KEY).',
  account: 'Usage: ctg account [--json]\n\nShow Carthagent Cloud credit, plan, credit grants and signed-in CLI sessions. Requires `ctg login` with Carthagent Cloud.',
  billing: 'Usage: ctg billing [checkout [builder|pro|max]|portal|refresh]\n\n  checkout   Review a Cloud plan and open Stripe checkout (default: builder)\n  portal     Manage an existing paid subscription\n  refresh    Re-read your Cloud account after paying',
  'logout-cloud': 'Usage: ctg logout-cloud [session-id]\n\nRevoke the current Carthagent Cloud session (and remove it from this profile), or revoke another session by id (see `ctg account`).',
  archive: 'Usage: ctg archive [list|search <query>|read <id>|export <id> [--format json|jsonl]]\n\nBrowse read-only legacy sessions.',
  review: 'Usage: ctg review [status|ask|yes|no]\n       ctg review workspace --request-file <task.txt> [--timeout 1..300]\n       ctg review <PR number|PR URL> [--timeout 1..300]\n\nSet the self-review default or run an independent review. Exit 0 approve, 1 changes requested, 2 inconclusive.',
  serve: 'Usage: ctg serve\n\nStart the local web dashboard for this workspace.',
  service: 'Usage: ctg service stop\n\nStop this profile’s background service. Sessions and credentials are preserved.',
  test: 'Usage: ctg test\n\nRun the Carthagent core test suite.',
  doctor: 'Usage: ctg doctor\n\nCheck Node, the runtime, the background service, connected providers and Carthagent Cloud sign-in, with a fix for anything that fails.',
  eval: 'Usage: ctg eval [args...]\n\nRun the evaluation harness.',
  update: 'Usage: ctg update [--check] [--channel stable|beta|experimental]\n\nCheck for or install a Carthagent update on the selected channel.',
};

export function commandHelp(command) {
  return COMMAND_HELP[aliases.get(command) || command];
}

const commandNames = new Set([
  'tui', 'resume', 'continue', 'demo', 'status', 'hash', 'check', 'validate', 'login',
  'account', 'billing', 'logout-cloud', 'archive', 'serve', 'test', 'eval', 'review', 'update', 'quit', 'q', 'exit',
  'logout', 'service', 'doctor',
]);

function fail(message, code = 1, io = console) {
  io.error(message);
  return code;
}

function ensureMethod(runtime, method) {
  if (typeof runtime?.[method] !== 'function') {
    throw new Error(`Native Carthagent CLI runtime does not provide ${method}()`);
  }
  return runtime[method].bind(runtime);
}

/**
 * Execute a CLI invocation using the native runtime port.
 *
 * Runtime contract (all operations are real operations, not optional no-ops):
 * run({mode, options, prompt, args}), listModels({query}), login(), account(),
 * billing({action}), logout({session}), review({args}), domain({command,args}),
 * and help/version metadata are supplied by the caller. Interactive vs
 * headless selection is made here so all aliases share identical behavior.
 */
export async function runOpenCodeCli({ argv = [], runtime, io = console, stdoutIsTTY = Boolean(process.stdout.isTTY), version = '' } = {}) {
  const first = argv[0];
  const normalized = aliases.get(first) || first;
  const rest = commandNames.has(normalized) ? argv.slice(1) : (first === '--list-models' ? [] : argv);

  if (['help', '--help', '-h'].includes(first)) {
    const usage = argv[1] ? commandHelp(argv[1]) : undefined;
    io.log(usage ?? cliHelp(version));
    return 0;
  }
  if (['--version', '-v'].includes(first)) {
    io.log(version);
    return 0;
  }
  const optionArgs = rest.includes('--') ? rest.slice(0, rest.indexOf('--')) : rest;
  if (commandNames.has(normalized) && (optionArgs.includes('--help') || optionArgs.includes('-h') || (rest[0] === 'help' && rest.length === 1))) {
    const usage = commandHelp(normalized);
    if (usage) { io.log(usage); return 0; }
  }
  if (first === '--list-models') {
    try { await ensureMethod(runtime, 'listModels')({ query: argv.slice(1).join(' ') }); return 0; }
    catch (error) {
      if (error?.name === 'AbortError' || error?.code === 'SIGINT') return 130;
      return fail(error.message, 1, io);
    }
  }
  if (['status', 'hash', 'fingerprint', 'check', 'c', 'validate'].includes(normalized)) {
    try { return Number((await ensureMethod(runtime, 'domain')({ command: normalized, args: rest })) ?? 0); }
    catch (error) { return fail(error.message, 1, io); }
  }
  if (normalized === 'review') {
    try { return Number((await ensureMethod(runtime, 'review')({ args: rest, cwd: process.cwd() })) ?? 0); }
    catch (error) { return fail(error.message, error.exitCode ?? 1, io); }
  }
  if (normalized === 'login' || normalized === 'auth') {
    if (!stdoutIsTTY) return fail('login requires an interactive terminal — or set a provider API key environment variable', 1, io);
    try { return Number((await ensureMethod(runtime, 'login')({ args: rest })) ?? 0); }
    catch (error) {
      if (error?.name === 'AbortError' || error?.code === 'SIGINT') return 130;
      return fail(error.message, 1, io);
    }
  }
  if (normalized === 'logout') return fail('Use `logout-cloud` to revoke a Carthagent Cloud session; provider credentials are managed by the native runtime.', 1, io);
  if (normalized === 'account' || normalized === 'cloud') {
    try { return Number((await ensureMethod(runtime, 'account')({ args: rest })) ?? 0); }
    catch (error) { return fail(error.message, 1, io); }
  }
  if (normalized === 'billing') {
    const action = rest[0] || 'checkout';
    const plan = rest[1];
    if (!['checkout', 'portal', 'refresh'].includes(action) || (plan && !['builder', 'pro', 'max'].includes(plan))) return fail('Usage: ctg billing [checkout [builder|pro|max]|portal|refresh]', 1, io);
    try { return Number((await ensureMethod(runtime, 'billing')({ action, ...(plan ? { plan } : {}) })) ?? 0); }
    catch (error) { return fail(error.message, 1, io); }
  }
  if (normalized === 'logout-cloud') {
    try { return Number((await ensureMethod(runtime, 'logout')({ session: rest[0] })) ?? 0); }
    catch (error) { return fail(error.message, 1, io); }
  }
  if (normalized === 'archive') {
    try { return Number((await ensureMethod(runtime, 'archive')({ args: rest })) ?? 0); }
    catch (error) { return fail(error.message, error.exitCode ?? 1, io); }
  }
  if (['serve', 'service', 'test', 'eval', 'update', 'quit', 'q', 'exit', 'demo', 'doctor'].includes(normalized)) {
    try { return Number((await ensureMethod(runtime, 'command')({ command: normalized, args: rest })) ?? 0); }
    catch (error) { return fail(error.message, error.exitCode ?? 1, io); }
  }

  let mode = normalized;
  let args = rest;
  if (first === undefined) { mode = 'tui'; args = []; }
  else if (!commandNames.has(normalized)) {
    if (first.startsWith('-') && !VALUE_FLAGS.has(first) && !BOOL_FLAGS.has(first)) {
      io.error(`Unknown command or flag: ${first}`);
      io.log(cliHelp(version));
      return 1;
    }
    mode = 'tui';
  }
  if (mode === 'resume') mode = 'tui';
  if (mode === 'continue') mode = 'tui';
  if (mode === 'demo') mode = 'tui';

  let options;
  try { options = parseOpenCodeArgs(args); }
  catch (error) { return fail(error.message, 1, io); }
  if (normalized === 'resume' || normalized === 'continue' || normalized === 'demo') {
    options[normalized === 'resume' ? 'resume' : normalized === 'continue' ? 'continue' : 'demo'] = true;
  }
  if (options.demo && !stdoutIsTTY) return fail('demo requires an interactive terminal', 1, io);
  const headless = options.print || options.json || !stdoutIsTTY;
  if (headless && options.resume) { options.resume = false; options.continue = true; }
  if (headless && !options.prompt) return fail('non-interactive mode requires a prompt', 1, io);
  try { return Number((await ensureMethod(runtime, 'run')({ mode: headless ? 'headless' : 'interactive', options, prompt: options.prompt, args })) ?? 0); }
  catch (error) {
    if (error?.name === 'AbortError' || error?.code === 'SIGINT') return 130;
    return fail(error.message, Number.isInteger(error?.exitCode) ? error.exitCode : 1, io);
  }
}

export const openCodeCliManifest = Object.freeze({
  aliases: Object.freeze(Object.fromEntries(aliases)),
  valueFlags: Object.freeze(Object.fromEntries(VALUE_FLAGS)),
  boolFlags: Object.freeze(Object.fromEntries([...BOOL_FLAGS].map(([flag, [key, value]]) => [flag, { key, value }]))),
});
