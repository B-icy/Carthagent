import { mkdirSync, openSync, closeSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { atomicJson } from './delivery.mjs';

export function lockWorkspace(cwd) {
  const dir = join(cwd, '.harness');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'workspace.lock');
  let fd;
  try { fd = openSync(path, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw Error('Workspace busy: another delivery operation is active. Retry after it finishes; never remove this lock without confirming the writer has stopped.');
    throw error;
  }
  try { writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); }
  catch (error) { closeSync(fd); unlinkSync(path); throw error; }
  return () => { closeSync(fd); unlinkSync(path); };
}

export function activeReportPath(cwd) {
  let pointer;
  try { pointer = JSON.parse(readFileSync(join(cwd, '.harness', 'active.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (pointer?.version !== 1 || typeof pointer.path !== 'string' || isAbsolute(pointer.path)) throw Error('Invalid active workspace report');
  const path = resolve(cwd, pointer.path);
  const rel = relative(join(cwd, '.harness'), path);
  if (rel.startsWith('..') || isAbsolute(rel) || !rel.endsWith('report.json')) throw Error('Invalid active workspace report path');
  return path;
}

// Called only while holding the workspace operation lock.
export function selectReport(cwd, path) {
  atomicJson(join(cwd, '.harness', 'active.json'), { version: 1, path: relative(cwd, path) });
}

export function assertActiveReport(cwd, path) {
  const active = activeReportPath(cwd);
  if (active && resolve(active) !== resolve(path)) throw Error('Delivery run was superseded in this workspace. Inspect delivery_status and create a new plan explicitly; stale operations were not replayed.');
}
