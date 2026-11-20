import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Git exports GIT_DIR and GIT_INDEX_FILE to hooks. Dropping every GIT_*
// variable keeps a suite started from a hook away from the real repository.
for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key];

export const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');

export function tempRepo(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'ctg-repo-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q');
  const write = (file, content) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };
  const stage = (file, content) => {
    write(file, content);
    git('add', '--', file);
  };
  return { root, git, write, stage };
}

export function runTool(tool, args, cwd) {
  const result = spawnSync(process.execPath, [path.join(repositoryRoot, 'tools', tool), ...args], { cwd, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function captureOutput() {
  const out = [];
  const err = [];
  return { out, err, io: { log: line => out.push(line), error: line => err.push(line) } };
}
