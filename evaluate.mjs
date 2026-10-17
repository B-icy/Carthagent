#!/usr/bin/env node
/** Opt-in live A/B runs. Separate directories are NOT security sandboxes.
 *  Task domains are pluggable scenario manifests under scenarios/<name>/ —
 *  a game, a CLI task, or any future profile is one directory of config,
 *  graders and seeds, not a special case in this file.
 */
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { basename, delimiter, dirname, join } from 'node:path';
import { existsSync, mkdirSync, copyFileSync, cpSync, realpathSync, readdirSync, statSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { atomicJson, runCommand } from './lib/delivery.mjs';
import { loadScenario, expandPlaceholders } from './lib/scenarios.mjs';
import { runNativeEvaluation, NATIVE_EVALUATION_RUNTIME } from './lib/opencode/evaluation.mjs';
import { spawn } from 'node:child_process';

const { values: args } = parseArgs({ options: {
  mode: { type: 'string', default: 'both' }, task: { type: 'string', default: 'cli' }, scenario: { type: 'string' },
  model: { type: 'string', default: 'inception/mercury-2.5-preview' }, provider: { type: 'string', default: 'openrouter' },
  thinking: { type: 'string', default: 'medium' },
  timeout: { type: 'string', default: '600' }, 'max-turns': { type: 'string', default: '100' }, 'max-cost': { type: 'string', default: '3' },
  python: { type: 'string' }, 'seed-from': { type: 'string' }, 'allow-live': { type: 'boolean', default: false },
  'dry-run': { type: 'boolean', default: false },
} });
if (!args['allow-live'] && !args['dry-run']) throw Error('Live calls spend API credit and generated code runs with your permissions. Use --allow-live explicitly (or --dry-run to preview the assembled run without calling a provider).');
if (!['baseline', 'custom', 'both'].includes(args.mode)) throw Error('Use --mode baseline|custom|both');
for (const key of ['timeout', 'max-turns', 'max-cost']) if (!(Number(args[key]) > 0 && Number.isFinite(Number(args[key])))) throw Error(`Invalid ${key}`);
if (Number(args['max-turns']) > 1000 || Number(args.timeout) > 3600) throw Error('Evaluation bounds may not exceed 1000 turns or 3600 seconds.');

const root = dirname(fileURLToPath(import.meta.url)), project = dirname(root);
// Layout: standalone checkouts keep evaluation fixtures beside this script;
// when this package is nested inside a workspace, the venv and evidence
// directories live in the parent project instead.
const home = existsSync(join(root, 'scenarios')) ? root : project;
const providerKey = process.env[`${args.provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`];
if (!args['dry-run'] && !providerKey) throw Error(`Set ${args.provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY explicitly; evaluation never discovers credentials from a home-directory agent config.`);
const scenarioName = args.scenario || args.task;
const scenario = loadScenario(root, scenarioName);
const findExecutable = name => {
  const names = process.platform === 'win32' ? [`${name}.exe`, name] : [name];
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    for (const candidate of names.map(file => join(dir, file))) if (existsSync(candidate)) return candidate;
  }
  return null;
};
const venvPython = join(home, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = args.python || (existsSync(venvPython) ? venvPython : findExecutable('python3') || findExecutable('python') || venvPython);
if (scenario.needsPython && !existsSync(python)) {
  const msg = `Scenario ${scenarioName} needs Python — pass --python /absolute/path/to/python${existsSync(join(scenario.dir, 'requirements.txt')) ? ` after installing scenarios/${scenarioName}/requirements.txt` : ''}`;
  if (args['dry-run']) console.error(`warning: ${msg}`); else throw Error(msg);
}
const seedFrom = args['seed-from'] ? realpathSync(args['seed-from']) : null;
if (seedFrom && !statSync(seedFrom).isDirectory()) throw Error('--seed-from must name a candidate directory');
const continuationEvidence = (() => {
  if (!seedFrom) return '';
  const summaryPath = join(dirname(seedFrom), 'summary.json');
  if (!existsSync(summaryPath)) return '';
  try {
    const parsed = JSON.parse(readFileSync(summaryPath, 'utf8'));
    const summary = Array.isArray(parsed) ? parsed.at(-1) : parsed;
    const failed = (summary.finalChecks || [])
      .filter(check => check.code !== 0)
      .map(check => `${check.id}:\n${check.output}`)
      .join('\n\n');
    return failed.slice(-6000);
  } catch {
    return '';
  }
})();

const vars = ({ cwd }) => ({ python, node: process.execPath, root, home, cwd, scenario: scenario.dir, ...(scenario.runtimes || {}) });
const scenarioChecks = (list, cwd) => list.map(c => ({ ...c, argv: expandPlaceholders(c.argv, vars({ cwd })) }));

const base = join(home, '.harness', 'evaluations', `${Date.now()}-${scenarioName}-${randomUUID().slice(0, 6)}`);
if (!args['dry-run']) mkdirSync(base, { recursive: true });
const runtimeInfo = [
  scenario.needsPython ? `Python executable: ${JSON.stringify(python)}.` : null,
  `Node: ${JSON.stringify(process.execPath)}.`,
].filter(Boolean).join(' ');
const environment = `Evaluation execution context:
The current working directory is the isolated product workspace. Write product files with workspace-relative paths such as README.md or src/index.ts; do not prefix them with the current directory or recreate an absolute path as nested folders. ${runtimeInfo} Invoke these exact executable paths and quote them in shell commands. Absolute paths in this context identify external tools and are valid as-is; do not hunt for them.
Set a bounded timeout on every shell command and never run filesystem-wide searches (find /, ls -R from the root, find of whole drives): one hung command can consume the entire time budget. Do not touch files outside this work directory or run nested engine agents. No network installs or deployment.
You have at most ${args['max-turns']} productive model turns (recovered provider connection errors do not consume that budget) and ${args.timeout} seconds; reserve time for verification. If declared checks pass with budget unused, re-check every user requirement and finish missing behavior rather than stopping at the first passing slice. Generated logs/screenshots go in artifacts/.
${expandPlaceholders(scenario.setup, vars({ cwd: '<the isolated product workspace>' }))}`;
const environmentPath = join(base, 'execution-context.md');
if (!args['dry-run']) writeFileSync(environmentPath, environment);
const summaries = [];

function copySeeds(cwd) {
  if (seedFrom) {
    const excluded = new Set(['.harness', 'artifacts', '__pycache__', '.pytest_cache', '.venv', 'node_modules', 'dist', 'build', 'coverage', '.turbo']);
    for (const entry of readdirSync(seedFrom, { withFileTypes: true })) {
      if (!excluded.has(entry.name)) {
        cpSync(join(seedFrom, entry.name), join(cwd, entry.name), { recursive: true });
      }
    }
    return;
  }
  for (const seed of scenario.seeds) {
    const target = join(cwd, seed.to);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(seed.from, target);
  }
}

async function runScenarioChecks(mode, cwd, tier, checks) {
  const results = [];
  for (const check of scenarioChecks(checks, cwd)) {
    const result = await runCommand(check.argv, {
      cwd,
      timeoutSeconds: check.timeoutSeconds,
      logPath: join(base, `${mode}-${tier}-${check.id}.log`),
    });
    results.push({
      id: check.id,
      tier,
      code: result.code,
      timedOut: result.timedOut,
      output: result.output,
    });
  }
  return results;
}

for (const mode of args.mode === 'both' ? ['baseline', 'custom'] : [args.mode]) {
  const cwd = join(base, mode);
  if (!args['dry-run']) {
    mkdirSync(cwd, { recursive: true });
    copySeeds(cwd);
  }
  const systemPrompt = `${environment}\n\n${mode === 'custom' ? scenario.context : ''}`;
  if (mode === 'custom') {
    const manifest = join(base, 'required-validators.json');
    if (!args['dry-run']) atomicJson(manifest, { version: 1, checks: scenarioChecks(scenario.developmentChecks, cwd) });
    // The native plugin owns delivery configuration; the manifest remains an
    // explicit piece of immutable evidence for that treatment.
    // Domain context from the manifest, plus generic continuation guidance.
    const context = [
      scenario.context,
      seedFrom && 'This workspace contains an earlier generated candidate. Every behavior not listed in the independent failures already passes. Preserve those behaviors, avoid subsystem rewrites, and make the smallest focused correction that addresses only the listed failures.',
      continuationEvidence && `Independent failures from the candidate being continued:\n${continuationEvidence}`,
    ].filter(Boolean).join('\n\n');
    if (context) {
      const contextPath = join(base, `${basename(scenarioName)}-context.md`);
       if (!args['dry-run']) writeFileSync(contextPath, context);
    }
  }
  const controller = new AbortController();
  console.log(`Starting ${mode} ${scenarioName} with ${args.provider}/${args.model}; ${cwd}`);
  if (args['dry-run']) {
    console.log(JSON.stringify({
      mode, cwd, runtime: NATIVE_EVALUATION_RUNTIME, nativeRequest: { directory: cwd, provider: args.provider, model: args.model, prompt: scenario.prompt, systemPrompt, timeoutSeconds: Number(args.timeout), maxTurns: Number(args['max-turns']), maxCost: Number(args['max-cost']) }, seeds: scenario.seeds.map(s => s.to),
      ...(mode === 'custom' ? { requiredValidators: scenarioChecks(scenario.developmentChecks, cwd) } : {}),
    }, null, 2));
    continue;
  }
  const isolation = join(base, 'native-service');
  mkdirSync(isolation, { recursive: true });
  const serviceEnv = {
    HOME: join(isolation, 'home'),
    XDG_CONFIG_HOME: join(isolation, 'home', '.config'),
    XDG_DATA_HOME: join(isolation, 'home', '.local/share'),
    XDG_CACHE_HOME: join(isolation, 'home', '.cache'),
    PATH: process.env.PATH || '', LANG: process.env.LANG || 'C.UTF-8', CI: '1',
    OPENROUTER_API_KEY: providerKey,
    CTG_EVALUATION_MAX_TURNS: String(args['max-turns']),
    CTG_EVALUATION_MAX_COST: String(args['max-cost']),
  };
  const configDir = join(serviceEnv.XDG_CONFIG_HOME, 'opencode');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'opencode.json'), JSON.stringify({ '$schema':'https://opencode.ai/config.json', model:`${args.provider}/${args.model}`, default_agent:'build', plugins:[join(root,'lib/opencode/evaluation-budget-plugin'), ...(mode === 'custom' ? [`${root}/plugins/carthagent`] : [])], skills:mode === 'custom' ? [`${root}/skills`] : [], instructions:[environmentPath] }, null, 2));
  const port = Number(process.env.CTG_OPENCODE_PORT || 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid CTG_OPENCODE_PORT');
  const server = spawn(process.env.OPENCODE_BIN || 'opencode', ['serve', '--hostname','127.0.0.1', ...(port ? ['--port',String(port)] : [])], { cwd, env:serviceEnv, stdio:['ignore','pipe','pipe'] });
  let serverOutput = '';
  server.stdout.on('data', chunk => { serverOutput = (serverOutput + chunk.toString()).slice(-20000); });
  server.stderr.on('data', chunk => { serverOutput = (serverOutput + chunk.toString()).slice(-20000); });
  let endpoint;
  try {
    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline && server.exitCode === null) {
      const match = serverOutput.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) endpoint = match[0];
      if (endpoint) try { const response = await fetch(`${endpoint}/api/info`, { signal:AbortSignal.timeout(1000) }); if (response.ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready) throw Error(`Isolated OpenCode service failed readiness: ${serverOutput.slice(-4000)}`);
    process.env.CTG_OPENCODE_URL = endpoint;
  const result = await runNativeEvaluation({ directory: cwd, systemPrompt, prompt: scenario.prompt, model: args.model, provider: args.provider, timeoutSeconds: Number(args.timeout), maxTurns: Number(args['max-turns']), maxCost: Number(args['max-cost']), signal: controller.signal, onEvent: event => appendFileSync(join(base, `${mode}-events.jsonl`), `${JSON.stringify(event)}\n`) });
  const summary = {
    mode,
    task: scenarioName,
    oracleGuided: mode === 'custom',
    provider: args.provider,
    model: args.model,
    cwd,
    evidenceSchema: 2,
    runtime: NATIVE_EVALUATION_RUNTIME,
    runtimeVersion: result.opencodeVersion,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    budgetReason: result.budgetReason,
    outcome: result.outcome,
    interruptionStatus: result.interruptionStatus,
    sessionInfo: { costScope:'session', usageSource:'session.get', terminalAuthority:'session.outcome', outcome:result.outcome },
    turns: result.turns,
    productiveTurns: result.productiveTurns,
    providerErrors: result.providerErrors,
    endedOnProviderError: result.lastStop === 'error',
    reportedCost: result.cost,
    costEvidence: 'native-session-usage; fail-closed when absent',
    reportedTokens: result.tokens,
    lastStop: result.lastStop,
    deliveryStatus: result.deliveryStatus,
    errors: result.errors,
    tools: result.tools,
    sessionID: result.sessionID,
    campaignComparability: 'not-comparable-to-pi-runtime',
    durationMs: result.durationMs,
  };
  summary.developmentChecks = await runScenarioChecks(mode, cwd, 'development', scenario.developmentChecks);
  summary.holdoutChecks = await runScenarioChecks(mode, cwd, 'holdout', scenario.holdoutChecks);
  summary.finalChecks = [...summary.developmentChecks, ...summary.holdoutChecks];
  summary.externalGrade = {
    code: summary.holdoutChecks.some(check => check.code !== 0 || check.timedOut) ? 1 : 0,
    output: summary.holdoutChecks.map(check => `# ${check.id}\n${check.output}`).join('\n'),
  };
  summaries.push(summary);
  atomicJson(join(base, 'summary.json'), summaries);
  console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (server.exitCode === null) {
      const exited = new Promise(resolve => server.once('exit', resolve));
      server.kill('SIGTERM');
      await exited;
    }
    delete process.env.CTG_OPENCODE_URL;
  }
}
console.log(`Evidence: ${join(base, 'summary.json')}`);
if (summaries.some(s =>
  s.exitCode !== 0 ||
  (s.endedOnProviderError && s.deliveryStatus !== 'verified') ||
  (s.mode === 'custom' && s.deliveryStatus !== 'verified') ||
  s.timedOut ||
  s.budgetReason ||
  s.finalChecks?.some(check => check.code !== 0 || check.timedOut)
)) process.exitCode = 1;
