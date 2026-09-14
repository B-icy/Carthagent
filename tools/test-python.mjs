#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const candidates = [
  process.env.PYTHON,
  join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
  process.platform === 'win32' ? 'python.exe' : 'python3',
  'python'
].filter(Boolean);

function resolveExecutable(candidate) {
  if (existsSync(candidate)) return candidate;
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    const path = join(dir, candidate);
    if (existsSync(path)) return path;
  }
  return null;
}

const python = candidates.map(resolveExecutable).find(Boolean);
if (!python) {
  console.error('Python was not found. Set PYTHON to an interpreter path.');
  process.exit(1);
}
const result = spawnSync(python, ['-m', 'unittest', 'discover', '-s', 'tests'], { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);
