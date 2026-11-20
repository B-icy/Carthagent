import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { evaluateStep, exitCodeFor, loadBudget, parseArgs, renderMarkdown, selectSteps, warningsFor } from '../tools/build-timings.mjs';

const BUDGET = loadBudget(
  JSON.stringify({
    version: 1,
    marginPercent: 20,
    steps: { check: { command: 'npm run check', budgetMs: 10000 }, extra: { command: 'echo hi' } },
  }),
);

test('the committed budget file is valid and names real npm scripts', () => {
  const budget = loadBudget(readFileSync(new URL('../tools/build-budget.json', import.meta.url), 'utf8'));
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
  for (const step of Object.values(budget.steps)) {
    const script = step.command.match(/^npm run ([\w:-]+)$/)?.[1];
    if (script) assert.ok(scripts[script], `${step.command} is not a package.json script`);
    assert.ok(step.budgetMs > 0);
  }
});

test('invalid budget files are rejected', () => {
  assert.throws(() => loadBudget('{"version":2,"steps":{}}'), /version/);
  assert.throws(() => loadBudget('{"version":1,"steps":{"x":{}}}'), /needs a command/);
  assert.throws(() => loadBudget('{"version":1,"steps":{"x":{"command":"a","budgetMs":-1}}}'), /invalid budgetMs/);
});

test('steps are selected by name in the requested order', () => {
  assert.deepEqual(
    selectSteps(BUDGET, []).map(step => step.name),
    ['check', 'extra'],
  );
  assert.deepEqual(
    selectSteps(BUDGET, ['extra']).map(step => step.name),
    ['extra'],
  );
  assert.throws(() => selectSteps(BUDGET, ['nope']), /Unknown build step nope/);
});

test('a step is over budget only beyond the margin', () => {
  const step = BUDGET.steps.check;
  assert.equal(evaluateStep({ name: 'check', ...step }, { ms: 12001, status: 0 }, 20).verdict, 'over-budget');
  assert.equal(evaluateStep({ name: 'check', ...step }, { ms: 12000, status: 0 }, 20).verdict, 'ok');
  assert.equal(evaluateStep({ name: 'check', ...step }, { ms: 500, status: 0 }, 20).limitMs, 12000);
  assert.equal(evaluateStep({ name: 'check', ...step }, { ms: 500, status: 2 }, 20).verdict, 'failed');
  assert.equal(evaluateStep({ name: 'extra', command: 'echo hi' }, { ms: 99999, status: 0 }, 20).verdict, 'no-budget');
});

test('exit codes: failures always fail, over-budget fails only with --strict', () => {
  const over = [{ verdict: 'ok' }, { verdict: 'over-budget' }];
  assert.equal(exitCodeFor(over, { strict: false }), 0);
  assert.equal(exitCodeFor(over, { strict: true }), 1);
  assert.equal(exitCodeFor([{ verdict: 'failed' }], { strict: false }), 1);
  assert.equal(exitCodeFor([{ verdict: 'no-budget' }], { strict: true }), 0);
});

test('markdown and warnings describe each step', () => {
  const results = [
    evaluateStep({ name: 'check', ...BUDGET.steps.check }, { ms: 15000, status: 0 }, 20),
    evaluateStep({ name: 'extra', command: 'echo hi' }, { ms: 1000, status: 3 }, 20),
  ];
  const markdown = renderMarkdown(results, { marginPercent: 20 });
  assert.match(markdown, /\| check \| 15\.0 s \| 10\.0 s \| over-budget \|/);
  assert.match(markdown, /\| extra \| 1\.0 s \| - \| failed \|/);
  assert.match(markdown, /\| \*\*total\*\* \| 16\.0 s \|/);
  assert.deepEqual(warningsFor(results), ['check took 15.0 s, over its 10.0 s budget (limit 12.0 s)', 'extra failed with exit status 3']);
});

test('arguments', () => {
  assert.deepEqual(parseArgs(['check', '--strict', '--out', 'x.json']), {
    budget: 'tools/build-budget.json',
    out: 'x.json',
    strict: true,
    list: false,
    steps: ['check'],
  });
  assert.throws(() => parseArgs(['--nope']), /Unknown option/);
});
