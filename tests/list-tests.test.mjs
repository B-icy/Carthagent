import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { formatText, listTestsInSource, main } from '../tools/list-tests.mjs';

const root = resolve(import.meta.dirname, '..');
const tool = join(root, 'tools', 'list-tests.mjs');

const SOURCE = `
import { describe, it, test } from 'node:test';
const pattern = /x/;
describe('outer', () => {
  it('first', () => {});
  it.skip('skipped', () => {});
  describe.only('inner', () => {
    test.todo('later');
    it(\`literal template\`, () => {});
  });
});
test('options skip', { skip: true }, () => {});
test('conditional skip', { skip: process.platform === 'win32' }, () => {});
test('not skipped', { skip: false }, () => {});
for (const name of ['a', 'b']) test(\`case \${name}\`, () => {});
test('parent', async t => {
  await t.test('child', () => {});
  pattern.test('not a subtest');
});
suite('suite form', () => {});
`;

test('lists nested suites, modifiers, templates and subtests from source without executing it', () => {
  const entries = listTestsInSource(SOURCE, 'sample.test.mjs');
  const summary = entries.map(entry => [entry.type, [...entry.path, entry.name].join(' > '), entry.modifier]);
  assert.deepEqual(summary, [
    ['suite', 'outer', null],
    ['test', 'outer > first', null],
    ['test', 'outer > skipped', 'skip'],
    ['suite', 'outer > inner', 'only'],
    ['test', 'outer > inner > later', 'todo'],
    ['test', 'outer > inner > literal template', null],
    ['test', 'options skip', 'skip'],
    ['test', 'conditional skip', 'skip?'],
    ['test', 'not skipped', null],
    ['test', 'case ${name}', null],
    ['test', 'parent', null],
    ['test', 'parent > child', null],
    ['suite', 'suite form', null],
  ]);
  const dynamic = entries.find(entry => entry.name === 'case ${name}');
  assert.equal(dynamic.dynamic, true);
  assert.equal(entries.find(entry => entry.name === 'child').subtest, true);
  assert.equal(entries.find(entry => entry.name === 'first').line, 5);
});

test('parses TypeScript and TSX test files', () => {
  const entries = listTestsInSource('import { test } from "bun:test";\ntest("renders", () => { const view = <box>{1 as number}</box>; });\n', 'view.test.tsx');
  assert.deepEqual(
    entries.map(entry => entry.name),
    ['renders'],
  );
});

test('text output prints file > suite > test lines and a total', () => {
  const output = formatText({ files: [{ file: 'tests/a.test.mjs', tests: listTestsInSource(SOURCE, 'a.test.mjs') }] });
  const lines = output.split('\n');
  assert.ok(lines.includes('tests/a.test.mjs > outer > inner > later [todo]'));
  assert.ok(lines.includes('tests/a.test.mjs > parent > child'));
  assert.ok(!lines.some(line => line.endsWith('> outer')), 'suites are path segments, not test lines');
  assert.equal(lines.at(-1), '10 tests in 1 files');
});

test('CLI lists files by glob without importing them and fails on unmatched patterns', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ctg-list-tests-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const marker = join(dir, 'executed');
  writeFileSync(
    join(dir, 'a.test.mjs'),
    `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'ran');\ntest('a works', () => {});\n`,
  );
  const listed = spawnSync(process.execPath, [tool, '--json', '*.test.mjs'], { cwd: dir, encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  const body = JSON.parse(listed.stdout);
  assert.equal(body.total, 1);
  assert.equal(body.files[0].file, 'a.test.mjs');
  assert.equal(existsSync(marker), false, 'listing must not execute the test file');

  const missing = spawnSync(process.execPath, [tool, 'missing/*.test.mjs'], { cwd: dir, encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No test files match: missing\/\*\.test\.mjs/);
});

test('main rejects unknown options with usage', () => {
  let stderr = '';
  const code = main(['--list-tests'], { stdout: { write() {} }, stderr: { write: chunk => (stderr += chunk) } });
  assert.equal(code, 2);
  assert.match(stderr, /Unknown option: --list-tests/);
  assert.match(stderr, /Usage: node tools\/list-tests\.mjs/);
});

test('repository test files list without parse failures', () => {
  let stdout = '';
  const code = main(['tests/budget.test.mjs'], { stdout: { write: chunk => (stdout += chunk) }, stderr: { write() {} }, cwd: root });
  assert.equal(code, 0);
  assert.match(stdout, /^tests\/budget\.test\.mjs > budget boundaries and configuration fail closed$/m);
});
