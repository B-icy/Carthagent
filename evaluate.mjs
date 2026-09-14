#!/usr/bin/env node
/** Opt-in live A/B runs. Separate directories are NOT security sandboxes.
 *  Task domains are pluggable scenario manifests under scenarios/<name>/ —
 *  a game, a CLI task, or any future profile is one directory of config,
 *  graders and seeds, not a special case in this file.
 */
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { basename, delimiter, dirname, join } from 'node:path';
import { existsSync, mkdirSync, copyFileSync, cpSync, realpathSync, readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { atomicJson, runCommand, turnBudgetExceeded } from './lib/delivery.mjs';
import { loadScenario, expandPlaceholders } from './lib/scenarios.mjs';
import { locatePi } from './lib/pi.mjs';

const { values: args } = parseArgs({ options: {
  mode: { type: 'string', default: 'both' }, task: { type: 'string', default: 'cli' }, scenario: { type: 'string' },
  model: { type: 'string', default: 'mercury-2.5' }, provider: { type: 'string', default: 'inception' },
  thinking: { type: 'string', default: 'medium' },
  timeout: { type: 'string', default: '600' }, 'max-turns': { type: 'string', default: '100' }, 'max-cost': { type: 'string', default: '3' },
  'pi2-cli': { type: 'string' }, 'pi-cli': { type: 'string' }, python: { type: 'string' }, 'seed-from': { type: 'string' }, 'allow-live': { type: 'boolean', default: false },
  'dry-run': { type: 'boolean', default: false },
} });
if (!args['allow-live'] && !args['dry-run']) throw Error('Live calls spend API credit and generated code runs with your permissions. Use --allow-live explicitly (or --dry-run to preview the assembled run without calling a provider).');
if (!['baseline', 'custom', 'both'].includes(args.mode)) throw Error('Use --mode baseline|custom|both');
for (const key of ['timeout', 'max-turns', 'max-cost']) if (!(Number(args[key]) > 0 && Number.isFinite(Number(args[key])))) throw Error(`Invalid ${key}`);

const root = dirname(fileURLToPath(import.meta.url)), project = dirname(root);
// Layout: standalone checkouts keep evaluation fixtures beside this script;
// when this package is nested inside a workspace, the venv and evidence
// directories live in the parent project instead.
const home = existsSync(join(root, 'scenarios')) ? root : project;
const pi = (() => { try { return locatePi(args['pi2-cli'] || args['pi-cli']); } catch (e) { throw Error(`${e.message}`); } })();
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
Set a bounded timeout on every shell command and never run filesystem-wide searches (find /, ls -R from the root, find of whole drives): one hung command can consume the entire time budget. Do not touch files outside this work directory or run nested pi agents. No network installs or deployment.
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
  const flags = [...pi.args, '--offline', '--mode', 'json', '--no-session', '--no-approve', '--no-context-files', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--provider', args.provider, '--model', args.model, '--thinking', args.thinking, '--append-system-prompt', environmentPath];
  if (mode === 'custom') {
    const manifest = join(base, 'required-validators.json');
    if (!args['dry-run']) atomicJson(manifest, { version: 1, checks: scenarioChecks(scenario.developmentChecks, cwd) });
    flags.push(
      '-e', join(root, 'extensions', 'delivery.ts'),
      '--skill', join(root, 'skills'),
      '--delivery-strict',
      '--delivery-validators', manifest,
      '--delivery-bash-cap', '120',
      '--delivery-protect-existing',
      '--delivery-rewrite-cap', '3',
      '--delivery-turn-delay-ms', '3000',
      '--delivery-tool-output-cap', '12000',
    );
    // Domain context from the manifest, plus generic continuation guidance.
    const context = [
      scenario.context,
      seedFrom && 'This workspace contains an earlier generated candidate. Every behavior not listed in the independent failures already passes. Preserve those behaviors, avoid subsystem rewrites, and make the smallest focused correction that addresses only the listed failures.',
      continuationEvidence && `Independent failures from the candidate being continued:\n${continuationEvidence}`,
    ].filter(Boolean).join('\n\n');
    if (context) {
      const contextPath = join(base, `${basename(scenarioName)}-context.md`);
      if (!args['dry-run']) writeFileSync(contextPath, context);
      flags.push('--delivery-context', contextPath);
    }
  }
  flags.push('--', scenario.prompt);
  const controller = new AbortController();
  let buffer = '', turns = 0, providerErrors = 0, cost = 0, tokens = 0, budgetReason = null, lastStop = null, deliveryStatus = null;
  const tools = {}, errors = [];
  function budget(reason) { if (!budgetReason) { budgetReason = reason; controller.abort(); } }
  console.log(`Starting ${mode} ${scenarioName} with ${args.provider}/${args.model}; ${cwd}`);
  if (args['dry-run']) {
    console.log(JSON.stringify({
      mode, cwd, spawn: [pi.cmd, ...flags], seeds: scenario.seeds.map(s => s.to),
      ...(mode === 'custom' ? { requiredValidators: scenarioChecks(scenario.developmentChecks, cwd) } : {}),
    }, null, 2));
    continue;
  }
  const result = await runCommand([pi.cmd, ...flags], {
    cwd, timeoutSeconds: Number(args.timeout), signal: controller.signal, logPath: join(base, `${mode}-events.jsonl`),
    onOutput(chunk) {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let event; try { event = JSON.parse(line); } catch { continue; }
        if (event.type === 'turn_start') { turns++; if (turnBudgetExceeded({ turns, providerErrors, maxTurns: Number(args['max-turns']) })) budget('productive model turn limit'); }
        if (event.type === 'tool_execution_start') tools[event.toolName] = (tools[event.toolName] || 0) + 1;
        if (event.type === 'tool_execution_end' && event.toolName === 'delivery_finish' && !event.isError) {
          try { deliveryStatus = JSON.parse(event.result.content.find(c => c.type === 'text').text).status; } catch { /* no verified result */ }
        }
        if (event.type === 'message_end' && event.message?.role === 'assistant') {
          cost += event.message.usage?.cost?.total || 0;
          tokens += event.message.usage?.totalTokens || 0;
          lastStop = event.message.stopReason;
          if (lastStop === 'error') { providerErrors++; errors.push(event.message.errorMessage); }
          if (cost >= Number(args['max-cost'])) budget('reported cost limit');
        }
      }
      if (buffer.length > 2 * 1024 * 1024) budget('oversized event');
    },
  });
  const productiveTurnStarts = turns - providerErrors;
  const productiveTurns = budgetReason === 'productive model turn limit'
    ? Math.min(productiveTurnStarts, Number(args['max-turns']))
    : productiveTurnStarts;
  const summary = {
    mode,
    task: scenarioName,
    oracleGuided: mode === 'custom',
    provider: args.provider,
    model: args.model,
    cwd,
    exitCode: result.code,
    timedOut: result.timedOut,
    budgetReason,
    turns,
    productiveTurns,
    providerErrors,
    endedOnProviderError: lastStop === 'error',
    reportedCost: cost,
    reportedTokens: tokens,
    lastStop,
    deliveryStatus,
    errors,
    tools,
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
