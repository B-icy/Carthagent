import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { captureDeliveryReview, recordDeliveryReview } from '../lib/delivery-review.mjs';
import { evidenceIdentity, fingerprint, completionIssues, revisePlan } from '../lib/delivery.mjs';

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'delivery review café '));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = args => execFileSync('git', args, { cwd, stdio: 'pipe' });
  writeFileSync(join(cwd, '.gitignore'), '.harness/\n');
  writeFileSync(join(cwd, 'app.mjs'), 'export const amount = 1;\n');
  git(['init', '-q']); git(['add', '.']);
  git(['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-qm', 'Baseline']);
  writeFileSync(join(cwd, 'app.mjs'), 'export const amount = 2;\n');
  writeFileSync(join(cwd, 'new.mjs'), 'export const result = 2;\n');
  const check = { id: 'unit', kind: 'test', argv: ['node', '--test'], timeoutSeconds: 10 };
  const state = { runId: 'a', revision: 1, plan: { goal: 'Repair money', artifacts: ['.'], steps: [{ id: 'fix', title: 'Fix' }], acceptance: [{ requirement: 'Correct amount', checks: ['unit'] }], checks: [check] }, evidence: {}, stepStatus: { step0: 'done' } };
  state.evidence.unit = { ...evidenceIdentity(state, check), passed: true, fingerprint: fingerprint(cwd, ['.']) };
  const params = captureId => ({ captureId, coverage: [{ requirement: 'Correct amount', assertions: 'app amount equals 2' }], probes: ['node assert amount: 2, passed'], findings: [], limitations: ['Fixture assertion review'] });
  return { cwd, state, params, dir: join(cwd, '.harness', 'review') };
}

test('review captures real diff/new files and binds complete assertions to final snapshot', async t => {
  const { cwd, state, params, dir } = fixture(t);
  const capture = await captureDeliveryReview(state, cwd, dir);
  assert.match(capture.diff, /-export const amount = 1/);
  assert.match(capture.diff, /\+export const amount = 2/);
  assert.match(capture.diff, /new.mjs/);
  assert.equal(readFileSync(capture.path, 'utf8'), capture.diff);
  assert.throws(() => recordDeliveryReview(state, cwd, { ...params(capture.id), coverage: [] }), /every exact/);
  assert.throws(() => recordDeliveryReview(state, cwd, { ...params(capture.id), probes: [] }), /boundary/);
  assert.throws(() => recordDeliveryReview(state, cwd, { ...params(capture.id), findings: ['Overflow still broken'] }), /Unresolved/);
  recordDeliveryReview(state, cwd, params(capture.id));
  assert.deepEqual(state.reviewEvidence.evidence, state.evidence);
  assert.ok(Object.values(completionIssues(state, cwd, fingerprint(cwd, ['.']))).every(a => !a.length));
  const revised = revisePlan(state, { assumptions: ['Additional investigation'] }, { cwd, hash: fingerprint(cwd, ['.']), reason: 'Refine' });
  assert.equal(revised.reviewEvidence, undefined);
  assert.ok(revised.revisions[0].reviewEvidence);
  writeFileSync(join(cwd, 'new.mjs'), 'changed');
  assert.throws(() => recordDeliveryReview(state, cwd, params(capture.id)), /stale/);
  assert.equal(completionIssues(state, cwd, fingerprint(cwd, ['.'])).review.length, 1);
});

test('review rejects modified receipts, stale coverage, and cancellation', async t => {
  const { cwd, state, params, dir } = fixture(t);
  const capture = await captureDeliveryReview(state, cwd, dir);
  state.requirementRevisions = { 'Correct amount': 2 };
  assert.throws(() => recordDeliveryReview(state, cwd, params(capture.id)), /fresh checks/);
  delete state.requirementRevisions;
  writeFileSync(capture.path, 'forged diff');
  assert.throws(() => recordDeliveryReview(state, cwd, params(capture.id)), /modified/);
  await assert.rejects(captureDeliveryReview(state, cwd, dir, AbortSignal.abort()), /cancelled/);
});

test('large diffs retain full receipt instead of silently using output tail', async t => {
  const { cwd, state, dir } = fixture(t);
  writeFileSync(join(cwd, 'app.mjs'), 'export const amount = 2;\n' + '// meaningful review line\n'.repeat(900));
  const capture = await captureDeliveryReview(state, cwd, dir);
  assert.equal(capture.truncated, true);
  assert.ok(readFileSync(capture.path, 'utf8').length > 12000);
  assert.match(capture.diff, /diff --git/);
});
