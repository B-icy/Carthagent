#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { repositoryRoot } from './git-files.mjs';

export const HOOKS_PATH = '.githooks';

const USAGE = `Usage: node tools/install-git-hooks.mjs [--uninstall] [--force]

Points this repository's core.hooksPath at the checked-in ${HOOKS_PATH}/ hooks.
Runs only when invoked explicitly; npm install never calls it.
  --uninstall  remove core.hooksPath when it points at ${HOOKS_PATH}
  --force      replace a different existing core.hooksPath`;

function gitConfig(root, args) {
  return execFileSync('git', ['config', '--local', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function currentHooksPath(root) {
  try {
    return gitConfig(root, ['--get', 'core.hooksPath']);
  } catch (error) {
    if (error.status === 1) return null;
    throw error;
  }
}

function makeHooksExecutable(root) {
  if (process.platform === 'win32') return;
  const directory = path.join(root, HOOKS_PATH);
  for (const name of readdirSync(directory)) chmodSync(path.join(directory, name), 0o755);
}

function uninstall(root, current, log) {
  if (current !== HOOKS_PATH) {
    log(current ? `core.hooksPath is '${current}', not '${HOOKS_PATH}'; leaving it unchanged.` : 'Git hooks are not installed; nothing to do.');
    return 0;
  }
  gitConfig(root, ['--unset', 'core.hooksPath']);
  log('Removed core.hooksPath; Git uses .git/hooks again.');
  return 0;
}

export function main(argv = process.argv.slice(2), { cwd = process.cwd(), log = console.log, error = console.error } = {}) {
  const { values } = parseArgs({ args: argv, options: { uninstall: { type: 'boolean' }, force: { type: 'boolean' }, help: { type: 'boolean' } } });
  if (values.help) {
    log(USAGE);
    return 0;
  }
  const root = repositoryRoot(cwd);
  const current = currentHooksPath(root);
  if (values.uninstall) return uninstall(root, current, log);
  if (!existsSync(path.join(root, HOOKS_PATH))) {
    error(`${HOOKS_PATH}/ does not exist in ${root}.`);
    return 1;
  }
  if (current && current !== HOOKS_PATH && !values.force) {
    error(`core.hooksPath is already '${current}'. Re-run with --force to replace it with '${HOOKS_PATH}'.`);
    return 1;
  }
  makeHooksExecutable(root);
  if (current === HOOKS_PATH) log(`Git hooks already installed (core.hooksPath=${HOOKS_PATH}).`);
  else {
    gitConfig(root, ['core.hooksPath', HOOKS_PATH]);
    log(`Installed Git hooks: core.hooksPath=${HOOKS_PATH}. Linked worktrees of this repository share the setting.`);
  }
  log('Uninstall with: node tools/install-git-hooks.mjs --uninstall (or git config --unset core.hooksPath).');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main();
