import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReport, latestReport, saveReport } from '../lib/reports.mjs';
import { lockWorkspace, selectReport, activeReportPath } from '../lib/workspace.mjs';

test('explicit workspace selection survives newer unrelated writes and rejects corrupt pointers', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'workspace café '));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const a = createReport(cwd, { status: 'implementing', evidence: {} });
  const b = createReport(cwd, { status: 'implementing', evidence: {} });
  const release = lockWorkspace(cwd);
  assert.throws(() => lockWorkspace(cwd), /Workspace busy/);
  selectReport(cwd, a.path);
  release();
  saveReport(b.path, b.state);
  assert.equal(latestReport(cwd).path, a.path);
  const next = lockWorkspace(cwd); next();
  writeFileSync(join(cwd, '.harness', 'active.json'), JSON.stringify({ version: 1, path: '../report.json' }));
  assert.throws(() => activeReportPath(cwd), /Invalid/);
  assert.throws(() => latestReport(cwd), /Invalid/);
});
