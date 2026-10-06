import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlanning, inspectPlanning, recordPlanReview, approvePlanning, planningStatus } from '../lib/planning.mjs';
import { fixtureDesign, fixtureReview } from './helpers/tested-design.mjs';

function state() {
  const plan = { goal: 'Loop', steps: ['Implement'], acceptance: [{ requirement: 'Works', checks: ['unit'] }], checks: [{ id: 'unit' }] };
  plan.design = fixtureDesign(plan);
  return { runId: 'run', revision: 1, plan };
}
function review(s, extra = {}) {
  const capture = inspectPlanning(s, 'hash');
  return recordPlanReview(s, 'hash', { ...fixtureReview(s.plan), captureId: capture.id, ...extra });
}
test('blocking findings cannot be laundered by an empty second review or same-revision resolution', () => {
  const s = state(); validatePlanning(s, 'hash');
  const receipt = review(s, { findings: [{ severity: 'blocking', description: 'Failure contract contradicts caller' }] });
  const id = receipt.findings[0].id;
  assert.throws(() => approvePlanning(s, 'hash'), /blocking/);
  review(s);
  assert.throws(() => approvePlanning(s, 'hash'), /blocking/);
  assert.throws(() => review(s, { resolutions: [{ id, change: 'Claim fixed', evidence: 'Nothing changed' }] }), /later design revision/);
  s.revision++;
  s.plan.design.scenarios[1].expected = 'Caller receives typed contract error';
  validatePlanning(s, 'hash');
  review(s, { resolutions: [{ id, change: 'Specified caller error contract', evidence: 'Failure scenario now traces typed contract error to caller' }] });
  approvePlanning(s, 'hash');
  assert.equal(planningStatus(s, 'hash').locked, false);
  assert.ok(s.planning.history.some(e => e.receipt?.findings?.some(f => f.id === id)));
});
test('review errors distinguish a missing capture from a stale captureId and name the current id', () => {
  const s = state(); validatePlanning(s, 'hash');
  assert.throws(() => recordPlanReview(s, 'hash', fixtureReview(s.plan)), /No current plan capture/);
  const capture = inspectPlanning(s, 'hash');
  assert.throws(() => recordPlanReview(s, 'hash', fixtureReview(s.plan)), new RegExp(`must be the id from the latest inspect result \\(${capture.id}\\)`));
  assert.throws(() => recordPlanReview(s, 'hash', { ...fixtureReview(s.plan), captureId: 'stale-id' }), new RegExp(`received "stale-id"`));
  // Observational re-validation preserves the current capture.
  validatePlanning(s, 'hash');
  recordPlanReview(s, 'hash', { ...fixtureReview(s.plan), captureId: capture.id });
  approvePlanning(s, 'hash');
  validatePlanning(s, 'hash');
  assert.ok(s.planning.approval);
});
test('inspection receipts bind revision/snapshot and cannot pretend to be independent', () => {
  const s = state(); validatePlanning(s, 'hash');
  const capture = inspectPlanning(s, 'hash');
  const content = { ...fixtureReview(s.plan), captureId: capture.id, provenance: 'independent human review' };
  assert.throws(() => recordPlanReview(s, 'changed', content), /Validate/);
  const receipt = recordPlanReview(s, 'hash', content);
  assert.match(receipt.provenance, /model-authored/);
  s.revision++;
  assert.throws(() => approvePlanning(s, 'hash'), /validation/);
});
