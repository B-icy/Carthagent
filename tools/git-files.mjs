import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

const MAX_GIT_OUTPUT_BYTES = 512 * 1024 * 1024;

function git(cwd, args, encoding = 'utf8') {
  return execFileSync('git', args, { cwd, encoding, maxBuffer: MAX_GIT_OUTPUT_BYTES, stdio: ['ignore', 'pipe', 'pipe'] });
}

const splitNul = output => output.split('\0').filter(Boolean);

function realPath(file) {
  try {
    return realpathSync.native(file);
  } catch {
    return path.resolve(file);
  }
}

export function repositoryRoot(cwd = process.cwd()) {
  return realPath(git(cwd, ['rev-parse', '--show-toplevel']).trim());
}

export function trackedFiles(root) {
  return splitNul(git(root, ['ls-files', '-z']));
}

export function stagedFiles(root) {
  return splitNul(git(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']));
}

export function toRepoPath(root, file) {
  return path.relative(root, realPath(file)).split(path.sep).join('/');
}

export function workingTreeReader(root) {
  return {
    size(file) {
      try {
        const stats = lstatSync(path.join(root, file));
        return stats.isFile() ? stats.size : null;
      } catch {
        return null;
      }
    },
    read: file => readFileSync(path.join(root, file)),
  };
}

// Reads blobs from the index so hooks check exactly what will be committed,
// not unstaged working-tree edits.
export function stagedReader(root) {
  const sizes = new Map();
  const contents = new Map();
  const cached = (cache, file, load) => {
    if (!cache.has(file)) cache.set(file, load());
    return cache.get(file);
  };
  return {
    size: file => cached(sizes, file, () => Number(git(root, ['cat-file', '-s', `:${file}`]).trim())),
    read: file => cached(contents, file, () => git(root, ['cat-file', 'blob', `:${file}`], 'buffer')),
  };
}

export function selectFiles({ cwd = process.cwd(), staged = false, paths = [] } = {}) {
  const root = repositoryRoot(cwd);
  const requested = paths.map(file => toRepoPath(root, path.resolve(cwd, file)));
  if (staged) {
    const files = stagedFiles(root);
    return { root, reader: stagedReader(root), files: requested.length ? files.filter(file => requested.includes(file)) : files };
  }
  return { root, reader: workingTreeReader(root), files: requested.length ? requested : trackedFiles(root) };
}
