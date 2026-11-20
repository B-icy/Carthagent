import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import { main as installHooks } from '../tools/install-git-hooks.mjs';
import { runPreCommit } from '../tools/pre-commit.mjs';
import { captureOutput, tempRepo } from './helpers/temp-git-repo.mjs';

const FORMATTED = 'export const value = 1;\n';

async function preCommit(repo) {
  const { out, err, io } = captureOutput();
  const createLinter = () => new ESLint({ cwd: repo.root, overrideConfigFile: true, overrideConfig: [{ files: ['**/*.mjs'], rules: { 'no-var': 'error' } }] });
  const status = await runPreCommit({ cwd: repo.root, createLinter, ...io });
  return { status, out: out.join('\n'), err: err.join('\n') };
}

test('pre-commit passes with nothing staged and with clean staged files', async t => {
  const repo = tempRepo(t);
  assert.deepEqual(await preCommit(repo), { status: 0, out: '', err: '' });
  repo.stage('lib/clean.mjs', FORMATTED);
  repo.stage('notes/linked.mjs', 'export const later = 1; // TODO(#42) linked\n');
  const result = await preCommit(repo);
  assert.equal(result.status, 0, result.err);
  assert.match(result.out, /2 staged file\(s\) passed/);
});

test('pre-commit rejects unformatted, lint-failing and unlinked-debt staged content', async t => {
  const repo = tempRepo(t);
  repo.stage('lib/unformatted.mjs', 'export const value=1\n');
  let result = await preCommit(repo);
  assert.equal(result.status, 1);
  assert.match(result.err, /Prettier check failed[\s\S]*lib\/unformatted\.mjs is not formatted/);

  repo.stage('lib/unformatted.mjs', 'export var value = 1;\n');
  result = await preCommit(repo);
  assert.equal(result.status, 1);
  assert.match(result.err, /ESLint check failed[\s\S]*no-var/);

  repo.stage('lib/unformatted.mjs', 'export const value = 1; // FIXME soon\n');
  result = await preCommit(repo);
  assert.equal(result.status, 1);
  assert.match(result.err, /debt marker check failed[\s\S]*lib\/unformatted\.mjs:1 needs a tracking issue/);
});

test('pre-commit checks the staged blob, not later working-tree edits', async t => {
  const repo = tempRepo(t);
  repo.stage('lib/partial.mjs', 'export const value=1\n');
  repo.write('lib/partial.mjs', FORMATTED);
  assert.equal((await preCommit(repo)).status, 1);
  repo.git('add', 'lib/partial.mjs');
  assert.equal((await preCommit(repo)).status, 0);
});

test('pre-commit honors .prettierignore and fails oversized files first', async t => {
  const repo = tempRepo(t);
  repo.stage('.prettierignore', 'generated/\n');
  repo.stage('generated/output.mjs', 'export const value=1\n');
  assert.equal((await preCommit(repo)).status, 0);
  repo.stage('assets/big.bin', Buffer.alloc(1024 * 1024 + 1));
  const result = await preCommit(repo);
  assert.equal(result.status, 1);
  assert.match(result.err, /file size check failed[\s\S]*assets\/big\.bin/);
});

function hooksPath(repo) {
  try {
    return repo.git('config', '--local', '--get', 'core.hooksPath').trim();
  } catch {
    return null;
  }
}

test('the hook installer is explicit, idempotent and reversible', t => {
  const repo = tempRepo(t);
  const { out, err, io } = captureOutput();
  assert.equal(installHooks([], { cwd: repo.root, ...io }), 1, 'refuses without a .githooks directory');
  assert.match(err.join('\n'), /\.githooks\/ does not exist/);

  repo.write('.githooks/pre-commit', '#!/bin/sh\nexit 0\n');
  assert.equal(installHooks([], { cwd: repo.root, ...io }), 0);
  assert.equal(hooksPath(repo), '.githooks');
  assert.equal(installHooks([], { cwd: repo.root, ...io }), 0);
  assert.match(out.join('\n'), /already installed/);
  assert.match(out.join('\n'), /--uninstall/);

  repo.git('config', 'core.hooksPath', 'custom-hooks');
  assert.equal(installHooks([], { cwd: repo.root, ...io }), 1, 'keeps a different existing hooks path');
  assert.equal(hooksPath(repo), 'custom-hooks');
  assert.equal(installHooks(['--uninstall'], { cwd: repo.root, ...io }), 0);
  assert.equal(hooksPath(repo), 'custom-hooks', 'uninstall leaves foreign hooks paths alone');
  assert.equal(installHooks(['--force'], { cwd: repo.root, ...io }), 0);
  assert.equal(hooksPath(repo), '.githooks');
  assert.equal(installHooks(['--uninstall'], { cwd: repo.root, ...io }), 0);
  assert.equal(hooksPath(repo), null);
});
