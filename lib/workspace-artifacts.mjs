import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { withoutRuntimeGithubToken } from './environment.mjs';

// Keep durable delivery evidence in the workspace, but out of untracked-file
// noise. Git resolves the per-worktree exclude path (including linked worktrees).
// Failure to update local Git metadata must never prevent delivery operations.
export function excludeWorkspaceArtifacts(cwd) {
  try {
    const exclude = resolve(cwd, execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: withoutRuntimeGithubToken(),
    }).trim());
    const pattern = `/${execFileSync('git', ['rev-parse', '--show-prefix'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: withoutRuntimeGithubToken(),
    }).trim()}.harness/`;
    let existing = '';
    try { existing = readFileSync(exclude, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') return; }
    if (existing.split(/\r?\n/).includes(pattern)) return;
    mkdirSync(dirname(exclude), { recursive: true });
    appendFileSync(exclude, `${existing && !existing.endsWith('\n') ? '\n' : ''}${pattern}\n`);
  } catch { /* Non-Git workspaces and read-only metadata remain supported. */ }
}
