import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findMarkers, isScanned, summarize } from '../tools/check-debt-markers.mjs';
import { repositoryRoot, runTool, tempRepo } from './helpers/temp-git-repo.mjs';

const brief = markers => markers.map(({ line, marker, issue }) => [line, marker, issue]);

test('markers count only inside comments and record their tracking issue', () => {
  const source = [
    '// TODO tidy this up',
    'const a = 1; // FIXME(#12) linked by number',
    '/* HACK(B-icy/Carthagent#7): cross-repository reference */',
    ' * XXX https://github.com/B-icy/Carthagent/issues/9 in a block comment',
    'const text = "TODO inside a string is data";',
    'const TODO_LIMIT = 3; // unrelated comment',
    'const todo = 1; // todo in lower case is prose',
  ].join('\n');
  assert.deepEqual(brief(findMarkers('lib/example.mjs', source)), [
    [1, 'TODO', null],
    [2, 'FIXME', '#12'],
    [3, 'HACK', 'B-icy/Carthagent#7'],
    [4, 'XXX', 'https://github.com/B-icy/Carthagent/issues/9'],
  ]);
});

test('hash-comment languages and hooks use # comments', () => {
  assert.deepEqual(brief(findMarkers('tools/run.py', 'x = 1  # TODO(#4) follow up\nprint("FIXME")\n')), [[1, 'TODO', '#4']]);
  assert.deepEqual(brief(findMarkers('.githooks/pre-commit', '# HACK keep this\n')), [[1, 'HACK', null]]);
  assert.deepEqual(findMarkers('README.md', '<!-- TODO -->'), []);
});

test('fixtures, vendored code, docs, scenarios and data files are not scanned', () => {
  for (const file of [
    'tests/fixtures/ship-routes.json',
    'tests/fixtures/plugin/index.ts',
    'vendor/agent/index.js',
    'docs/a.mjs',
    'scenarios/x/main.py',
    'package.json',
  ]) {
    assert.equal(isScanned(file), false, file);
  }
  for (const file of ['lib/a.mjs', 'plugins/carthagent/src/ui/a.tsx', 'tools/a.py', 'script/build.sh', '.github/workflows/ci.yml']) {
    assert.equal(isScanned(file), true, file);
  }
});

test('the inventory counts markers by kind and file', () => {
  const summary = summarize([...findMarkers('lib/a.mjs', '// TODO(#1) a\n// TODO b\n'), ...findMarkers('lib/b.mjs', '// FIXME(#2) c\n')]);
  assert.equal(summary.total, 3);
  assert.equal(summary.unlinked, 1);
  assert.deepEqual(summary.byMarker, { TODO: 2, FIXME: 1, HACK: 0, XXX: 0 });
  assert.deepEqual(summary.byFile, { 'lib/a.mjs': { TODO: 2 }, 'lib/b.mjs': { FIXME: 1 } });
});

test('the CLI fails on unlinked markers, ignores fixture data and supports --json and --staged', t => {
  const repo = tempRepo(t);
  repo.stage('tests/fixtures/ship-routes.json', '{ "ask": "Add a TODO comment" }\n');
  repo.stage('lib/linked.mjs', 'export const a = 1; // TODO(#5) linked\n');
  const clean = runTool('check-debt-markers.mjs', ['--json'], repo.root);
  assert.equal(clean.status, 0, clean.stderr);
  assert.deepEqual(JSON.parse(clean.stdout).byFile, { 'lib/linked.mjs': { TODO: 1 } });

  repo.stage('lib/unlinked.mjs', 'export const b = 2; // FIXME later\n');
  repo.write('lib/unlinked.mjs', 'export const b = 2;\n');
  const staged = runTool('check-debt-markers.mjs', ['--staged'], repo.root);
  assert.equal(staged.status, 1);
  assert.match(staged.stderr, /lib\/unlinked\.mjs:1 {2}export const b = 2; \/\/ FIXME later/);
  assert.equal(runTool('check-debt-markers.mjs', ['lib/unlinked.mjs'], repo.root).status, 0, 'working tree content has no marker');
});

test('the repository has no debt markers without a tracking issue', () => {
  const result = runTool('check-debt-markers.mjs', [], repositoryRoot);
  assert.equal(result.status, 0, result.stderr);
});
