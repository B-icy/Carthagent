import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { excludeWorkspaceArtifacts } from '../lib/workspace-artifacts.mjs';

for (const nested of [false, true]) test(`workspace artifacts use local Git exclusion (nested=${nested})`, t => {
  const root = mkdtempSync(join(tmpdir(), 'ctg-exclude-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  const cwd = nested ? join(root, 'app') : root;
  mkdirSync(join(cwd, '.harness'), { recursive: true });
  writeFileSync(join(cwd, '.harness', 'report.json'), '{}');
  writeFileSync(join(cwd, 'source.txt'), 'keep visible');
  const exclude = join(root, '.git', 'info', 'exclude');
  writeFileSync(exclude, '# existing entry without newline');
  excludeWorkspaceArtifacts(cwd);
  const first = readFileSync(exclude, 'utf8');
  excludeWorkspaceArtifacts(cwd);
  assert.equal(readFileSync(exclude, 'utf8'), first);
  assert.ok(first.startsWith('# existing entry without newline\n'));
  assert.ok(first.endsWith(nested ? '/app/.harness/\n' : '/.harness/\n'));
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
  assert.ok(!status.includes('.harness'));
  assert.ok(status.includes('source.txt'));
  assert.equal(readFileSync(join(cwd, '.harness', 'report.json'), 'utf8'), '{}');
});

test('non-Git workspaces remain supported', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'ctg-exclude-nongit-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  assert.doesNotThrow(() => excludeWorkspaceArtifacts(cwd));
});
