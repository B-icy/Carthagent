#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const ROOT = resolve(import.meta.dirname, '..');
const USAGE = 'Usage: build-timings.mjs [step ...] [--budget tools/build-budget.json] [--out artifacts/build-timings.json] [--strict] [--list]';

export function loadBudget(text) {
  const budget = JSON.parse(text);
  if (budget.version !== 1 || typeof budget.steps !== 'object' || budget.steps === null) throw Error('Build budget must be { "version": 1, "steps": { ... } }');
  for (const [name, step] of Object.entries(budget.steps)) {
    if (typeof step.command !== 'string' || !step.command.trim()) throw Error(`Build budget step ${name} needs a command`);
    if (step.budgetMs !== undefined && !(Number.isFinite(step.budgetMs) && step.budgetMs > 0)) throw Error(`Build budget step ${name} has an invalid budgetMs`);
  }
  return { marginPercent: budget.marginPercent ?? 20, steps: budget.steps };
}

export function selectSteps(budget, names) {
  const chosen = names.length ? names : Object.keys(budget.steps);
  return chosen.map(name => {
    if (!budget.steps[name]) throw Error(`Unknown build step ${name}. Known steps: ${Object.keys(budget.steps).join(', ')}`);
    return { name, ...budget.steps[name] };
  });
}

export function evaluateStep({ name, command, budgetMs }, { ms, status }, marginPercent) {
  const result = { name, command, ms: Math.round(ms), status, budgetMs: budgetMs ?? null, limitMs: null, verdict: 'ok' };
  if (budgetMs) result.limitMs = Math.round(budgetMs * (1 + marginPercent / 100));
  if (status !== 0) result.verdict = 'failed';
  else if (result.limitMs === null) result.verdict = 'no-budget';
  else if (result.ms > result.limitMs) result.verdict = 'over-budget';
  return result;
}

export function exitCodeFor(results, { strict }) {
  if (results.some(result => result.verdict === 'failed')) return 1;
  return strict && results.some(result => result.verdict === 'over-budget') ? 1 : 0;
}

const seconds = ms => (ms === null ? '-' : `${(ms / 1000).toFixed(1)} s`);

export function renderMarkdown(results, { marginPercent }) {
  const total = results.reduce((sum, result) => sum + result.ms, 0);
  const rows = results.map(result => `| ${result.name} | ${seconds(result.ms)} | ${seconds(result.budgetMs)} | ${result.verdict} |`);
  return [
    '### Build timings',
    '',
    `Budgets allow a ${marginPercent}% margin before a step counts as over budget.`,
    '',
    '| Step | Time | Budget | Result |',
    '| --- | ---: | ---: | --- |',
    ...rows,
    `| **total** | ${seconds(total)} | | |`,
    '',
  ].join('\n');
}

export function warningsFor(results) {
  return results
    .filter(result => result.verdict === 'over-budget' || result.verdict === 'failed')
    .map(result =>
      result.verdict === 'failed'
        ? `${result.name} failed with exit status ${result.status}`
        : `${result.name} took ${seconds(result.ms)}, over its ${seconds(result.budgetMs)} budget (limit ${seconds(result.limitMs)})`,
    );
}

export function parseArgs(argv) {
  const options = { budget: 'tools/build-budget.json', out: 'artifacts/build-timings.json', strict: false, list: false, steps: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--strict') options.strict = true;
    else if (arg === '--list') options.list = true;
    else if ((arg === '--budget' || arg === '--out') && argv[i + 1]) options[arg.slice(2)] = argv[++i];
    else if (!arg.startsWith('--')) options.steps.push(arg);
    else throw Error(`Unknown option ${arg}\n${USAGE}`);
  }
  return options;
}

function runStep(step) {
  console.error(`\n> ${step.name}: ${step.command}`);
  const start = performance.now();
  const child = spawnSync(step.command, { cwd: ROOT, shell: true, stdio: 'inherit' });
  return { ms: performance.now() - start, status: child.status ?? 1 };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const budget = loadBudget(readFileSync(resolve(ROOT, options.budget), 'utf8'));
  const steps = selectSteps(budget, options.steps);
  if (options.list) return steps.forEach(step => console.log(`${step.name}\t${step.budgetMs ?? '-'} ms\t${step.command}`));
  const results = steps.map(step => evaluateStep(step, runStep(step), budget.marginPercent));
  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    cpus: availableParallelism(),
    marginPercent: budget.marginPercent,
    steps: results,
  };
  const out = resolve(ROOT, options.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  const markdown = renderMarkdown(results, budget);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + '\n');
  console.error(`\n${markdown}`);
  const annotate = process.env.GITHUB_ACTIONS === 'true' ? '::warning::' : 'warning: ';
  for (const warning of warningsFor(results)) console.error(`${annotate}${warning}`);
  process.exitCode = exitCodeFor(results, options);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
