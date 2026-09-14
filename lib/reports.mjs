import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

export function saveReport(path, state) {
  atomicJson(path, state);
  if (state.plan) writeFileSync(join(dirname(path), 'plan.d2'), planD2WithProgress(state.plan, state.stepStatus || {}));
}

function safeDirectories(path) {
  try { return readdirSync(path, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name); }
  catch { return []; }
}
