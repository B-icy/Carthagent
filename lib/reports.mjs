import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson, planD2WithProgress } from './delivery.mjs';

export function latestReport(cwd) {
  const harness = join(cwd, '.harness');
  if (!existsSync(harness)) return null;
  let latest = null;
  for (const session of safeDirectories(harness)) {
    for (const run of safeDirectories(join(harness, session))) {
      const path = join(harness, session, run, 'report.json');
      try {
        const mtimeMs = statSync(path).mtimeMs;
        if (!latest || mtimeMs >= latest.mtimeMs) latest = { path, dir: dirname(path), mtimeMs };
      } catch { }
    }
  }
  if (!latest) return null;
  try { return { ...latest, state: JSON.parse(readFileSync(latest.path, 'utf8')) }; }
  catch { return null; }
}

export function createReport(cwd, state, owner = 'web') {
  const runId = state.runId || randomUUID();
  const dir = join(cwd, '.harness', owner, runId);
  mkdirSync(dir, { recursive: true });
  const report = { ...state, runId };
  const path = join(dir, 'report.json');
  saveReport(path, report);
  return { path, dir, state: report, mtimeMs: statSync(path).mtimeMs };
}

// Reconcile only a restored snapshot of this exact run. Never select by mtime.
export function reconcileReport(path, state) {
  let current;
  try { current = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return state; throw error; }
  if (!state?.runId || current.runId !== state.runId) throw Error(`Report identity mismatch: ${path}`);
  const saved = current.storageVersion ?? 0;
  const restored = state.storageVersion ?? 0;
  if (!Number.isSafeInteger(saved) || saved < 0 || !Number.isSafeInteger(restored) || restored < 0) throw Error(`Invalid report storage version: ${path}`);
  if (saved < restored) throw Error(`Report storage regressed: ${path}`);
  return saved > restored ? current : state;
}

export function saveReport(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  const lock = `${path}.lock`;
  let fd;
  try { fd = openSync(lock, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw Error(`Report is locked: ${path}. Retry after the writer finishes; remove the lock only after confirming no writer is running.`);
    throw error;
  }
  try {
    const current = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
    const expected = state.storageVersion ?? 0;
    if ((current?.storageVersion ?? 0) !== expected) {
      throw Error(`Report write conflict: ${path}. Reload the current report before retrying.`);
    }
    const next = { ...state, storageVersion: expected + 1 };
    const d2 = state.plan ? planD2WithProgress(state.plan, state.stepStatus || {}) : null;
    atomicJson(path, next);
    state.storageVersion = next.storageVersion;
    if (d2 !== null) writeFileSync(join(dirname(path), 'plan.d2'), d2);
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}

function safeDirectories(path) {
  try { return readdirSync(path, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name); }
  catch { return []; }
}
