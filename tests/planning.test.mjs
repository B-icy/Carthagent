import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validatePlan, revisePlan, fingerprint, evidenceIdentity, pendingChecks,
  updateStepStatus, completionIssues, coverageReport, planD2, looksInformational, pendingRequirements,
} from '../lib/delivery.mjs';

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'planning monorepo café '));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  for (const name of ['api', 'client', 'shared']) {
    mkdirSync(join(cwd, 'packages', name), { recursive: true });
    writeFileSync(join(cwd, 'packages', name, 'index.js'), 'export const version = 1;');
  }
  const checks = ['unit', 'integration'].map(id => ({ id, kind: 'test', argv: ['node', '--test', `${id}.test.mjs`], timeoutSeconds: 60 }));
  const plan = validatePlan({
    goal: 'Migrate a public API while preserving existing clients', assumptions: ['Old clients must remain supported'],
    artifacts: ['packages'],
    steps: [
      { id: 'contract', title: 'Capture the public contract', checks: ['unit'] },
      { id: 'api', title: 'Implement compatible API', dependsOn: ['contract'] },
      { id: 'client', title: 'Migrate client', dependsOn: ['contract'] },
      { id: 'integration', title: 'Exercise both clients', dependsOn: ['api', 'client'], checks: ['integration'] },
    ],
    checks, acceptance: [{ requirement: 'Old and new clients both work', checks: ['unit', 'integration'] }],
  }, cwd);
  const state = { runId: 'task-a', revision: 1, plan, evidence: {}, stepStatus: {}, status: 'implementing' };
  const hash = fingerprint(cwd, ['.']);
  for (const check of checks) state.evidence[check.id] = { ...evidenceIdentity(state, check), passed: true, fingerprint: hash, logPath: `${check.id}.log` };
  const revise = (patch, reason = 'Discovered an additional compatibility constraint') => revisePlan(state, patch, { cwd, hash: fingerprint(cwd, ['.']), reason });
  return { cwd, state, hash, revise };
}

test('cross-package API migration: dependencies gate work and tests gate completion', t => {
  const { state, cwd, hash } = fixture(t);
  assert.throws(() => updateStepStatus(state, 'api', 'active'), /dependencies: contract/);
  assert.throws(() => updateStepStatus(state, 'contract', 'done', 'stale'), /fresh passing checks/);
  updateStepStatus(state, 'contract', 'done', hash);
  updateStepStatus(state, 'api', 'active');
  updateStepStatus(state, 'client', 'active'); // independent branches are allowed
  updateStepStatus(state, 'api', 'done');
  assert.throws(() => updateStepStatus(state, 'integration', 'done', hash), /dependencies: client/);
  assert.deepEqual(completionIssues(state, cwd, hash).incompleteSteps, ['client', 'integration']);
  updateStepStatus(state, 'client', 'done');
  updateStepStatus(state, 'integration', 'done', hash);
  assert.equal(completionIssues(state, cwd, hash).review.length, 1);
  state.reviewEvidence = { runId: state.runId, revision: state.revision, fingerprint: hash };
  assert.ok(Object.values(completionIssues(state, cwd, hash)).every(items => items.length === 0));
  state.status = 'verified'; state.handoff = { review: 'old review' };
  updateStepStatus(state, 'contract', 'pending');
  assert.deepEqual(state.stepStatus, { step0: 'pending', step1: 'pending', step2: 'pending', step3: 'pending' });
  assert.equal(state.status, 'implementing');
  assert.equal(state.handoff, undefined);
});

test('rolling-wave refinement retains fresh evidence and stable progress through reorder', t => {
  const { state, cwd, revise, hash } = fixture(t);
  updateStepStatus(state, 'contract', 'done', hash);
  updateStepStatus(state, 'api', 'done');
  const old = structuredClone(state);
  const steps = [state.plan.steps[2], state.plan.steps[0], state.plan.steps[1], state.plan.steps[3]];
  const next = revise({ steps, assumptions: [...state.plan.assumptions, 'Client requires a compatibility adapter'] });
  assert.equal(next.runId, state.runId);
  assert.equal(next.revision, 2);
  assert.deepEqual(pendingChecks(next, hash), []);
  assert.equal(next.evidence.unit.originRevision, 1);
  const legacy = revisePlan(next, { steps: ['Continue legacy labels'] }, { cwd, hash, reason: 'Change display shape' });
  assert.equal(legacy.reviewRequired, true, 'switching labels cannot discard a structured task review obligation');
  assert.equal(next.evidence.unit.logPath, state.evidence.unit.logPath);
  assert.equal(next.stepStatus.step1, 'done');
  assert.equal(next.stepStatus.step2, 'done');
  assert.deepEqual(state, old, 'revision is pure, preserving the old report snapshot');
  assert.deepEqual(next.revisions[0].plan, old.plan);
  next.revisions[0].plan.goal = 'changed copy';
  assert.equal(state.plan.goal, old.plan.goal);
});

test('source and shared config changes never become fresh via a revision', t => {
  const { state, cwd, revise, hash } = fixture(t);
  writeFileSync(join(cwd, 'package-lock.json'), '{"newDependency":true}');
  const next = revise({ assumptions: ['Dependency resolution changed'] });
  assert.deepEqual(pendingChecks(next, fingerprint(cwd, ['.'])), ['unit', 'integration']);
  assert.equal(next.evidence.unit.revision, 1, 'stale evidence is retained without rebinding');
  assert.deepEqual(pendingChecks(next, hash), ['unit', 'integration'], 'even reverting source needs an explicit fresh rebind or rerun');
  assert.equal(state.evidence.unit.passed, true);
});

test('discovered migration risk resets changed step and downstream progress, not unrelated checks', t => {
  const { state, revise, hash } = fixture(t);
  for (const id of ['contract', 'api', 'client', 'integration']) updateStepStatus(state, id, 'done', hash);
  const steps = structuredClone(state.plan.steps);
  steps[0].title = 'Capture contract including rollback and retry behavior';
  const next = revise({ steps });
  assert.deepEqual(next.stepStatus, {});
  assert.deepEqual(pendingChecks(next, hash), []);
  const changedChecks = structuredClone(state.plan.checks);
  changedChecks[0].argv.push('--test-name-pattern=rollback');
  const changed = revise({ checks: changedChecks });
  assert.deepEqual(pendingChecks(changed, hash), ['unit']);
  assert.deepEqual(changed.stepStatus, {}, 'dependent completed steps must be reconsidered');
});

test('failed evidence cannot be washed away through multiple revisions or blocked resumption', t => {
  const { state, cwd, hash, revise } = fixture(t);
  state.evidence.unit.passed = false;
  const next = revise({ checks: state.plan.checks.map(c => ({ ...c, timeoutSeconds: 90 })) });
  assert.deepEqual(next.evidence, {});
  assert.equal(next.verificationStarted, true);
  next.status = 'blocked';
  assert.throws(() => revisePlan(next, { verification: 'none', checks: [], acceptance: [], steps: ['Answer'] }, { cwd, hash, reason: 'Try downgrade' }), /Cannot downgrade/);
  assert.throws(() => revisePlan(next, { acceptance: [{ requirement: 'Only compilation matters now', checks: ['unit'] }] }, { cwd, hash, reason: 'Try weaker scope' }), /remove acceptance/);
  assert.equal(next.revisions[0].evidence.unit.passed, false, 'original failure remains auditable');
});

test('failed, stale and forged evidence is never rebound to a new revision', t => {
  const { state, revise, hash } = fixture(t);
  for (const mutation of [{ passed: false }, { runId: 'other' }, { revision: 99 }, { checkDigest: 'forged' }, { fingerprint: 'old' }]) {
    const original = state.evidence.unit;
    state.evidence.unit = { ...original, ...mutation };
    const next = revise({ goal: state.plan.goal });
    assert.deepEqual(pendingChecks(next, hash), ['unit']);
    state.evidence.unit = original;
  }
});

test('legacy step progress follows unique labels and resets ambiguous duplicates', t => {
  const { state, revise } = fixture(t);
  state.plan.steps = ['Inspect', 'Build', 'Review']; state.stepStatus = { step0: 'done', step1: 'active' };
  const next = revise({ steps: ['New investigation', 'Inspect', 'Build', 'Review'] });
  assert.deepEqual(next.stepStatus, { step1: 'done', step2: 'active' });
  const ambiguous = revise({ steps: ['Inspect', 'Inspect', 'Review'] });
  assert.deepEqual(ambiguous.stepStatus, {});
});

test('plan validation rejects malformed steps, missing references and dependency cycles', t => {
  const { state, cwd } = fixture(t);
  const base = state.plan;
  for (const steps of [
    [], [null], [{}], [' '], [{ id: 'bad id', title: 'X' }],
    [{ id: 'x', title: 'X' }, { id: 'x', title: 'Y' }],
    [{ id: 'x', title: 'X', dependsOn: ['missing'] }],
    [{ id: 'x', title: 'X', dependsOn: ['x'] }],
    [{ id: 'x', title: 'X', dependsOn: ['y'] }, { id: 'y', title: 'Y', dependsOn: ['x'] }],
    [{ id: 'x', title: 'X', dependsOn: 'y' }],
    [{ id: 'x', title: 'X', checks: ['missing'] }],
  ]) assert.throws(() => validatePlan({ ...base, steps }, cwd));
  for (const patch of [{ checks: [null] }, { checks: [{ ...base.checks[0], argv: 'node' }] }, { acceptance: [null] }, { artifacts: '.' }]) {
    assert.throws(() => validatePlan({ ...base, ...patch }, cwd));
  }
  assert.throws(() => validatePlan({ ...base, acceptance: [...base.acceptance, ...base.acceptance] }, cwd), /must be unique/);
  assert.throws(() => revisePlan(state, {}, { cwd, reason: 'x' }), /nonempty/);
  assert.throws(() => revisePlan(state, { evidence: {} }, { cwd, reason: 'x' }), /Unknown/);
  assert.throws(() => revisePlan(state, { goal: 'x' }, { cwd, reason: ' ' }), /reason/);
});

test('D2 reflects branching dependencies rather than inventing a linear sequence', t => {
  const { state } = fixture(t);
  const graph = planD2(state.plan);
  assert.match(graph, /step0 -> step1/);
  assert.match(graph, /step0 -> step2/);
  assert.match(graph, /step1 -> step3/);
  assert.match(graph, /step2 -> step3/);
  assert.match(graph, /step3 -> verify/);
  assert.doesNotMatch(graph, /step1 -> step2/);
  assert.doesNotMatch(graph, /\[object Object\]/);
});

test('coverage requires every mapped check, not just the easiest passing one', t => {
  const { state, hash } = fixture(t);
  assert.equal(coverageReport(state.plan, state.evidence, hash, state)[0].covered, true);
  state.evidence.integration.passed = false;
  const coverage = coverageReport(state.plan, state.evidence, hash, state)[0];
  assert.equal(coverage.fresh, 1);
  assert.equal(coverage.failing, 1);
  assert.equal(coverage.covered, false);
});

test('declared reports must be files and unfinished work prevents completion', t => {
  const { state, cwd, hash } = fixture(t);
  state.plan.outputs = ['artifacts/migration-report.json'];
  mkdirSync(join(cwd, 'artifacts', 'migration-report.json'), { recursive: true });
  assert.deepEqual(completionIssues(state, cwd, hash).missingOutputs, state.plan.outputs);
  rmSync(join(cwd, 'artifacts', 'migration-report.json'), { recursive: true });
  writeFileSync(join(cwd, 'artifacts', 'migration-report.json'), '{}');
  assert.deepEqual(completionIssues(state, cwd, hash).missingOutputs, []);
  assert.equal(completionIssues(state, cwd, hash).incompleteSteps.length, 4);
});

test('polite implementation requests are not informational receipts', () => {
  for (const prompt of ['Could you fix this?', 'Can you refactor the billing package?', 'Please migrate the schema?', 'Could you identify and fix flaws in the planning system?']) {
    assert.equal(looksInformational(prompt), false, prompt);
  }
  assert.equal(looksInformational('Why is the billing package failing?'), true);
});

test('new and remapped requirements need executions after their introduction, not rebound history', t => {
  const { state, cwd, hash, revise } = fixture(t);
  const acceptance = [...state.plan.acceptance, { requirement: 'Safe cancellation', checks: ['unit'] }];
  const next = revise({ acceptance });
  assert.deepEqual(pendingChecks(next, hash), []);
  assert.deepEqual(pendingRequirements(next, hash), ['Safe cancellation']);
  assert.equal(coverageReport(next.plan, next.evidence, hash, next)[1].covered, false);
  const again = revisePlan(next, { assumptions: ['New discovery'] }, { cwd, hash, reason: 'Refine' });
  assert.deepEqual(pendingRequirements(again, hash), ['Safe cancellation']);
  again.evidence.unit = { ...evidenceIdentity(again, again.plan.checks[0]), passed: true, fingerprint: hash, executedRevision: again.revision };
  assert.deepEqual(pendingRequirements(again, hash), []);
  const remapped = revisePlan(again, { acceptance: [acceptance[0], { ...acceptance[1], checks: ['integration'] }] }, { cwd, hash, reason: 'Use integration assertions' });
  assert.deepEqual(pendingRequirements(remapped, hash), ['Safe cancellation']);
});

test('regression capture is an intentionally red milestone, never a passing final gate', t => {
  const { state, cwd, hash } = fixture(t);
  state.plan.steps = [{ id: 'red', title: 'Capture failing behavior', kind: 'regression', checks: [] }];
  validatePlan(state.plan, cwd);
  state.evidence.unit.passed = false;
  updateStepStatus(state, 'red', 'done', hash);
  assert.deepEqual(completionIssues(state, cwd, hash).pendingChecks, ['unit']);
  assert.throws(() => validatePlan({ ...state.plan, steps: [{ ...state.plan.steps[0], checks: ['unit'] }] }, cwd), /must not require green/);
  assert.throws(() => validatePlan({ ...state.plan, steps: [{ ...state.plan.steps[0], kind: 'anything' }] }, cwd), /Step kind/);
});
