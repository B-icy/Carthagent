import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFileSizes, countLines, globToRegExp, MAX_BYTES, MAX_SOURCE_LINES, staleExceptions } from '../tools/check-file-sizes.mjs';
import { repositoryRoot, runTool, tempRepo } from './helpers/temp-git-repo.mjs';

const lines = count => Array.from({ length: count }, (_, index) => `export const value${index} = ${index};`).join('\n') + '\n';

function memoryReader(files) {
  return {
    size: file => (file in files ? Buffer.byteLength(files[file]) : null),
    read: file => Buffer.from(files[file]),
  };
}

test('glob patterns match path segments the way the exception list expects', () => {
  assert.ok(globToRegExp('vendor/agent/**').test('vendor/agent/chunks/a.js'));
  assert.ok(!globToRegExp('vendor/agent/**').test('vendor/agentx/a.js'));
  assert.ok(globToRegExp('docs/patches/*.patch').test('docs/patches/v1.patch'));
  assert.ok(!globToRegExp('docs/patches/*.patch').test('docs/patches/old/v1.patch'));
  assert.ok(globToRegExp('**/fixtures/**').test('fixtures/a.json'));
  assert.ok(globToRegExp('**/fixtures/**').test('tests/fixtures/a/b.json'));
  assert.ok(!globToRegExp('lib/a.mjs').test('lib/a-mjs'));
});

test('line counting treats a missing final newline as a line', () => {
  assert.equal(countLines(Buffer.from('')), 0);
  assert.equal(countLines(Buffer.from('a')), 1);
  assert.equal(countLines(Buffer.from('a\n')), 1);
  assert.equal(countLines(Buffer.from('a\nb')), 2);
});

test('limits apply to first-party source lines and to every file size, with explicit exceptions', () => {
  const files = {
    'lib/long.mjs': lines(MAX_SOURCE_LINES + 1),
    'lib/ok.mjs': lines(MAX_SOURCE_LINES),
    'docs/long.mjs': lines(MAX_SOURCE_LINES + 1),
    'tests/fixtures/long.ts': lines(MAX_SOURCE_LINES + 1),
    'notes.md': lines(MAX_SOURCE_LINES + 1),
    'allowed/long.mjs': lines(MAX_SOURCE_LINES + 1),
    'assets/big.bin': 'x'.repeat(MAX_BYTES + 1),
  };
  const exceptions = [{ pattern: 'allowed/*.mjs', maxLines: MAX_SOURCE_LINES + 10, reason: 'test' }];
  const problems = checkFileSizes(Object.keys(files), memoryReader(files), { exceptions });
  assert.deepEqual(
    problems.map(problem => [problem.file, problem.kind]),
    [
      ['lib/long.mjs', 'lines'],
      ['assets/big.bin', 'bytes'],
    ],
  );
  const capped = checkFileSizes(['allowed/long.mjs'], memoryReader({ 'allowed/long.mjs': lines(MAX_SOURCE_LINES + 11) }), { exceptions });
  assert.deepEqual(
    capped.map(problem => [problem.limit, problem.exception]),
    [[MAX_SOURCE_LINES + 10, 'allowed/*.mjs']],
  );
});

test('exceptions that no longer match or are no longer needed are reported as stale', () => {
  const files = { 'lib/short.mjs': lines(10) };
  const exceptions = [
    { pattern: 'lib/short.mjs', maxLines: 5000, reason: 'test' },
    { pattern: 'gone/**', maxBytes: 5 * MAX_BYTES, reason: 'test' },
  ];
  const stale = staleExceptions(Object.keys(files), memoryReader(files), { exceptions });
  assert.equal(stale.length, 2);
  assert.match(stale[0], /lib\/short\.mjs: now within the default limits/);
  assert.match(stale[1], /gone\/\*\*: exception matches no tracked file/);
});

test('the CLI checks tracked files, explicit paths and staged blobs', t => {
  const repo = tempRepo(t);
  repo.stage('lib/small.mjs', lines(3));
  assert.equal(runTool('check-file-sizes.mjs', [], repo.root).status, 0);

  repo.stage('assets/big.bin', Buffer.alloc(MAX_BYTES + 1));
  const big = runTool('check-file-sizes.mjs', [], repo.root);
  assert.equal(big.status, 1);
  assert.match(big.stderr, /assets\/big\.bin: 1\.00 MiB exceeds the 1\.00 MiB size limit/);
  assert.equal(runTool('check-file-sizes.mjs', ['lib/small.mjs'], repo.root).status, 0);
  repo.git('rm', '-q', '--cached', 'assets/big.bin');

  repo.stage('lib/long.mjs', lines(MAX_SOURCE_LINES + 1));
  repo.write('lib/long.mjs', lines(10));
  const staged = runTool('check-file-sizes.mjs', ['--staged'], repo.root);
  assert.equal(staged.status, 1);
  assert.match(staged.stderr, new RegExp(`lib/long\\.mjs: ${MAX_SOURCE_LINES + 1} lines exceeds the ${MAX_SOURCE_LINES}-line source file limit`));
  assert.equal(runTool('check-file-sizes.mjs', ['lib/long.mjs'], repo.root).status, 0, 'working tree content is within the limit');
});

test('the repository itself is within the file size limits', () => {
  const result = runTool('check-file-sizes.mjs', [], repositoryRoot);
  assert.equal(result.status, 0, result.stderr);
});
