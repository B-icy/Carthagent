import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildReport, compareBudget, decodeEntities, formatMarkdown, main, parseJUnit, summarize, validateBudget } from '../tools/test-report.mjs';

const root = resolve(import.meta.dirname, '..');
const fixture = join(root, 'tests', 'fixtures', 'test-report', 'junit.xml');
const xml = readFileSync(fixture, 'utf8');

function capture(env = {}) {
  const io = { stdout: '', stderr: '', env };
  return {
    io,
    streams: { stdout: { write: chunk => (io.stdout += chunk) }, stderr: { write: chunk => (io.stderr += chunk) }, env },
  };
}

test('parses Node JUnit test cases, nested suites, statuses and run duration', () => {
  const parsed = parseJUnit(xml, { cwd: '/repo' });
  assert.deepEqual(
    parsed.cases.map(item => [item.file, item.suites.join('/'), item.name, item.status]),
    [
      ['tests/alpha.test.mjs', '', 'fast "quoted" test', 'passed'],
      ['tests/alpha.test.mjs', '', 'slow test', 'passed'],
      ['tests/beta.test.mjs', 'parent & children', 'child passes', 'passed'],
      ['tests/beta.test.mjs', 'parent & children', 'child fails', 'failed'],
      ['tests/beta.test.mjs', 'parent & children', 'child skipped', 'skipped'],
      ['tests/gamma.test.mjs', '', 'planned', 'todo'],
    ],
  );
  assert.equal(parsed.comments.duration_ms, 4321.5);
  assert.equal(decodeEntities('&#x41;&#66;&lt;&unknown;'), 'AB<&unknown;');
});

test('summarizes slowest tests and files without double counting nested suites', () => {
  const summary = summarize(parseJUnit(xml, { cwd: '/repo' }), { top: 2 });
  assert.deepEqual(summary.totals, { tests: 6, passed: 3, failed: 1, skipped: 1, todo: 1, durationSeconds: 4.322, summedTestSeconds: 3.71 });
  assert.deepEqual(
    summary.slowestTests.map(item => [item.id, item.seconds]),
    [
      ['tests/alpha.test.mjs > slow test', 2.5],
      ['tests/beta.test.mjs > parent & children > child passes', 0.7],
    ],
  );
  assert.deepEqual(summary.slowestFiles, [
    { file: 'tests/alpha.test.mjs', seconds: 2.51, tests: 2 },
    { file: 'tests/beta.test.mjs', seconds: 1.2, tests: 1 },
  ]);
});

test('budget comparison flags suite and per-test regressions and honors overrides', () => {
  const summary = summarize(parseJUnit(xml, { cwd: '/repo' }));
  const budget = compareBudget(summary, {
    suiteSeconds: 4,
    testSeconds: 0.5,
    tests: { 'tests/alpha.test.mjs > slow test': 3, 'tests/gone.test.mjs > removed': 1 },
  });
  assert.deepEqual(
    budget.violations.map(item => [item.kind, item.id, item.limit]),
    [
      ['suite', 'suite', 4],
      ['test', 'tests/beta.test.mjs > parent & children > child passes', 0.5],
    ],
  );
  assert.deepEqual(budget.unknownOverrides, ['tests/gone.test.mjs > removed']);
  assert.deepEqual(validateBudget({ suiteSeconds: 0, testSeconds: 'x', tests: { a: -1 } }), [
    'suiteSeconds must be a positive number',
    'testSeconds must be a positive number',
    'tests["a"] must be positive',
  ]);
});

test('markdown summary escapes table cells and lists regressions', () => {
  const report = buildReport(xml, { cwd: '/repo', top: 3, budget: { suiteSeconds: 1, testSeconds: 10 } });
  const markdown = formatMarkdown(report);
  assert.match(markdown, /^## Test timing$/m);
  assert.match(markdown, /\| tests\/alpha\.test\.mjs > slow test \| 2\.50 \|/);
  assert.match(markdown, /- Over budget: suite took 4\.322 s \(limit 1 s\)/);
});

test('CLI writes JSON and step summary, warns on regressions and fails only with --strict', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ctg-test-report-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'budget.json'), JSON.stringify({ suiteSeconds: 60, testSeconds: 1 }));
  writeFileSync(join(dir, 'junit.xml'), xml.replaceAll('/repo/', `${dir}/`));
  const summaryPath = join(dir, 'summary.md');
  const args = ['--input', 'junit.xml', '--budget', 'budget.json', '--json', 'out/timings.json'];

  const warn = capture({ GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summaryPath });
  assert.equal(main(args, { ...warn.streams, cwd: dir }), 0);
  assert.match(warn.io.stdout, /Wall time: 4\.3 s/);
  assert.match(warn.io.stderr, /::warning title=Test time budget::tests\/alpha\.test\.mjs > slow test took 2\.5 s; budget is 1 s/);
  const timings = JSON.parse(readFileSync(join(dir, 'out', 'timings.json'), 'utf8'));
  assert.equal(timings.totals.failed, 1);
  assert.equal(timings.budget.violations.length, 1);
  assert.match(readFileSync(summaryPath, 'utf8'), /## Test timing/);

  const strict = capture();
  assert.equal(main([...args, '--strict'], { ...strict.streams, cwd: dir }), 1);
  assert.match(strict.io.stderr, /Budget regression: tests\/alpha\.test\.mjs > slow test/);

  const missing = capture();
  assert.equal(main(['--input', 'absent.xml'], { ...missing.streams, cwd: dir }), 1);
  assert.match(missing.io.stderr, /JUnit report not found/);
});

test('committed test budget is valid', () => {
  const budget = JSON.parse(readFileSync(join(root, 'tools', 'test-budget.json'), 'utf8'));
  assert.deepEqual(validateBudget(budget), []);
});
