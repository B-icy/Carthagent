#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const DEFAULTS = Object.freeze({
  input: 'artifacts/test-results/junit.xml',
  json: 'artifacts/test-timings.json',
  budget: 'tools/test-budget.json',
  top: 10,
});
const USAGE = `Usage: node tools/test-report.mjs [--input junit.xml] [--json out.json] [--budget budget.json] [--top N] [--strict]

Summarizes a Node test runner JUnit report: total duration, slowest tests and
files, and test-time budget regressions. Writes a Markdown summary to
$GITHUB_STEP_SUMMARY when it is set. --strict exits 1 on budget regressions.`;
const ENTITIES = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'" };
const TOKEN = /<!--\s*(\w+)\s+([^\s]+)\s*-->|<(\/?)(testsuites|testsuite|testcase|failure|skipped|error)\b([^>]*?)(\/?)>/g;
const ATTRIBUTE = /([\w:-]+)="([^"]*)"/g;

export function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, entity) => {
    if (entity[0] !== '#') return ENTITIES[entity] ?? match;
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : match;
  });
}

function attributes(raw) {
  const result = {};
  for (const [, key, value] of raw.matchAll(ATTRIBUTE)) result[key] = decodeEntities(value);
  return result;
}

function displayPath(file, cwd) {
  if (!file) return '<unknown>';
  const path = isAbsolute(file) ? relative(cwd, file) : file;
  return (path.startsWith('..') ? file : path).split('\\').join('/');
}

function openSuite(state, attrs, selfClosing) {
  const suite = { name: attrs.name || '', seconds: Number(attrs.time) || 0, depth: state.stack.length, file: null };
  if (!selfClosing) state.stack.push(suite);
}

function openCase(state, attrs, selfClosing) {
  const testCase = {
    name: attrs.name || '',
    suites: state.stack.map(suite => suite.name),
    file: displayPath(attrs.file, state.cwd),
    seconds: Number(attrs.time) || 0,
    status: 'passed',
    depth: state.stack.length,
  };
  state.cases.push(testCase);
  for (const suite of state.stack) suite.file ??= testCase.file;
  if (!selfClosing) state.current = testCase;
}

function markStatus(state, tag, attrs) {
  if (!state.current) return;
  if (tag === 'failure' || tag === 'error') state.current.status = 'failed';
  else if (tag === 'skipped') state.current.status = attrs.type === 'todo' ? 'todo' : 'skipped';
}

function openElement(state, tag, attrs, selfClosing) {
  if (tag === 'testsuite') openSuite(state, attrs, selfClosing);
  else if (tag === 'testcase') openCase(state, attrs, selfClosing);
  else markStatus(state, tag, attrs);
}

function closeElement(state, tag) {
  if (tag === 'testcase') state.current = null;
  else if (tag === 'testsuite') {
    const suite = state.stack.pop();
    if (suite && suite.depth === 0) state.topLevel.push({ file: suite.file || '<unknown>', seconds: suite.seconds });
  }
}

export function parseJUnit(xml, { cwd = process.cwd() } = {}) {
  const state = { cwd, stack: [], cases: [], topLevel: [], current: null, comments: {} };
  for (const match of xml.matchAll(TOKEN)) {
    const [, commentKey, commentValue, closing, tag, rawAttributes, selfClosing] = match;
    if (commentKey) state.comments[commentKey] = Number(commentValue);
    else if (closing) closeElement(state, tag);
    else openElement(state, tag, attributes(rawAttributes), Boolean(selfClosing));
  }
  for (const testCase of state.cases) if (testCase.depth === 0) state.topLevel.push({ file: testCase.file, seconds: testCase.seconds });
  return { cases: state.cases, topLevel: state.topLevel, comments: state.comments };
}

function testId(testCase) {
  return [testCase.file, ...testCase.suites, testCase.name].join(' > ');
}

function fileTotals(topLevel) {
  const files = new Map();
  for (const { file, seconds } of topLevel) {
    const entry = files.get(file) || { file, seconds: 0, tests: 0 };
    entry.seconds += seconds;
    entry.tests += 1;
    files.set(file, entry);
  }
  return [...files.values()].sort((a, b) => b.seconds - a.seconds);
}

function countStatuses(cases) {
  const counts = { tests: cases.length, passed: 0, failed: 0, skipped: 0, todo: 0 };
  for (const { status } of cases) counts[status] += 1;
  return counts;
}

export function summarize(parsed, { top = DEFAULTS.top } = {}) {
  const summed = parsed.topLevel.reduce((sum, item) => sum + item.seconds, 0);
  const wallSeconds = Number.isFinite(parsed.comments.duration_ms) ? parsed.comments.duration_ms / 1000 : summed;
  const tests = parsed.cases
    .map(testCase => ({ id: testId(testCase), file: testCase.file, name: testCase.name, seconds: testCase.seconds, status: testCase.status }))
    .sort((a, b) => b.seconds - a.seconds);
  return {
    totals: { ...countStatuses(parsed.cases), durationSeconds: round(wallSeconds), summedTestSeconds: round(summed) },
    slowestTests: tests.slice(0, top).map(roundSeconds),
    slowestFiles: fileTotals(parsed.topLevel).slice(0, top).map(roundSeconds),
    allTests: tests,
  };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function roundSeconds(item) {
  return { ...item, seconds: round(item.seconds) };
}

export function validateBudget(budget) {
  const errors = [];
  if (!budget || typeof budget !== 'object') return ['budget must be a JSON object'];
  for (const key of ['suiteSeconds', 'testSeconds']) {
    if (!(Number.isFinite(budget[key]) && budget[key] > 0)) errors.push(`${key} must be a positive number`);
  }
  const overrides = budget.tests ?? {};
  if (typeof overrides !== 'object' || Array.isArray(overrides)) errors.push('tests must map "file > test" IDs to seconds');
  else for (const [id, seconds] of Object.entries(overrides)) if (!(Number.isFinite(seconds) && seconds > 0)) errors.push(`tests["${id}"] must be positive`);
  return errors;
}

export function compareBudget(summary, budget) {
  const violations = [];
  if (summary.totals.durationSeconds > budget.suiteSeconds) {
    violations.push({ kind: 'suite', id: 'suite', seconds: summary.totals.durationSeconds, limit: budget.suiteSeconds });
  }
  const overrides = budget.tests ?? {};
  for (const test of summary.allTests) {
    const limit = overrides[test.id] ?? budget.testSeconds;
    if (test.seconds > limit) violations.push({ kind: 'test', id: test.id, seconds: round(test.seconds), limit });
  }
  const unknownOverrides = Object.keys(overrides).filter(id => !summary.allTests.some(test => test.id === id));
  return { suiteSeconds: budget.suiteSeconds, testSeconds: budget.testSeconds, violations, unknownOverrides };
}

function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function formatMarkdown(report) {
  const { totals, slowestTests, slowestFiles, budget } = report;
  const lines = [
    '## Test timing',
    '',
    `${totals.tests} tests: ${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped, ${totals.todo} todo. Wall time ${totals.durationSeconds.toFixed(1)} s.`,
    '',
    '| Slowest tests | Seconds |',
    '| --- | ---: |',
    ...slowestTests.map(test => `| ${escapeCell(test.id)} | ${test.seconds.toFixed(2)} |`),
    '',
    '| Slowest files | Seconds | Top-level tests |',
    '| --- | ---: | ---: |',
    ...slowestFiles.map(file => `| ${escapeCell(file.file)} | ${file.seconds.toFixed(2)} | ${file.tests} |`),
  ];
  if (budget) {
    lines.push('', `Budget: suite ${budget.suiteSeconds} s, per test ${budget.testSeconds} s.`);
    if (!budget.violations.length) lines.push('No budget regressions.');
    for (const violation of budget.violations)
      lines.push(`- Over budget: ${escapeCell(violation.id)} took ${violation.seconds} s (limit ${violation.limit} s)`);
  }
  return `${lines.join('\n')}\n`;
}

export function formatText(report) {
  const { totals, slowestTests, slowestFiles } = report;
  const lines = [
    `Tests: ${totals.tests} (passed ${totals.passed}, failed ${totals.failed}, skipped ${totals.skipped}, todo ${totals.todo})`,
    `Wall time: ${totals.durationSeconds.toFixed(1)} s (sum of top-level test times ${totals.summedTestSeconds.toFixed(1)} s)`,
    '',
    'Slowest tests:',
    ...slowestTests.map(test => `  ${test.seconds.toFixed(2).padStart(8)} s  ${test.id}`),
    '',
    'Slowest files:',
    ...slowestFiles.map(file => `  ${file.seconds.toFixed(2).padStart(8)} s  ${file.file} (${file.tests} top-level tests)`),
  ];
  return lines.join('\n');
}

function parseArgs(argv) {
  const options = { ...DEFAULTS, strict: false, help: false };
  const valued = { '--input': 'input', '--json': 'json', '--budget': 'budget', '--top': 'top' };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--strict') options.strict = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--no-budget') options.budget = null;
    else if (valued[arg] && index + 1 < argv.length) options[valued[arg]] = argv[++index];
    else throw new Error(`Unknown or incomplete option: ${arg}`);
  }
  options.top = Number(options.top);
  if (!Number.isInteger(options.top) || options.top < 1) throw new Error('--top must be a positive integer');
  return options;
}

function loadBudget(path) {
  if (!path) return null;
  const budget = JSON.parse(readFileSync(path, 'utf8'));
  const errors = validateBudget(budget);
  if (errors.length) throw new Error(`Invalid budget ${path}: ${errors.join('; ')}`);
  return budget;
}

function writeJson(path, report) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}

function emitBudget(report, io) {
  const { budget } = report;
  if (!budget) return;
  for (const id of budget.unknownOverrides) io.stderr.write(`Budget override does not match any test: ${id}\n`);
  if (!budget.violations.length) {
    io.stdout.write(`\nBudget: no regressions (suite ${budget.suiteSeconds} s, per test ${budget.testSeconds} s).\n`);
    return;
  }
  for (const violation of budget.violations) {
    const message = `${violation.id} took ${violation.seconds} s; budget is ${violation.limit} s`;
    io.stderr.write(io.env.GITHUB_ACTIONS ? `::warning title=Test time budget::${message}\n` : `Budget regression: ${message}\n`);
  }
}

export function buildReport(xml, { cwd = ROOT, top = DEFAULTS.top, budget = null, input = '' } = {}) {
  const summary = summarize(parseJUnit(xml, { cwd }), { top });
  const { allTests: _allTests, ...rest } = summary;
  return { generatedAt: new Date().toISOString(), input, ...rest, budget: budget ? compareBudget(summary, budget) : null };
}

export function main(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr, env: process.env, cwd: ROOT }) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    io.stderr.write(`${error.message}\n${USAGE}\n`);
    return 2;
  }
  if (options.help) {
    io.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const input = resolve(io.cwd, options.input);
  if (!existsSync(input)) {
    io.stderr.write(`JUnit report not found: ${input}\n`);
    return 1;
  }
  const budget = loadBudget(options.budget && resolve(io.cwd, options.budget));
  const report = buildReport(readFileSync(input, 'utf8'), { cwd: io.cwd, top: options.top, budget, input: displayPath(input, io.cwd) });
  io.stdout.write(`${formatText(report)}\n`);
  emitBudget(report, io);
  if (options.json) writeJson(resolve(io.cwd, options.json), report);
  if (io.env.GITHUB_STEP_SUMMARY) appendFileSync(io.env.GITHUB_STEP_SUMMARY, formatMarkdown(report));
  if (!report.totals.tests) {
    io.stderr.write('The JUnit report contains no test cases.\n');
    return 1;
  }
  return options.strict && report.budget?.violations.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main();
