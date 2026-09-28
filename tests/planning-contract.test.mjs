import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDesign, validatePlanning, inspectPlanning, recordPlanReview, approvePlanning, planningStatus, startImplementation } from '../lib/planning.mjs';

export function designedState() {
  return { runId: 'run', revision: 1, plan: {
    goal: 'Tested design', verification: 'required', artifacts: ['.'], steps: ['Implement'],
    acceptance: [{ requirement: 'Correct result', checks: ['unit'] }],
    checks: [{ id: 'unit', kind: 'test', argv: ['node', '--version'], timeoutSeconds: 10 }],
    design: { components: [{ id: 'policy', responsibility: 'Compute result', excludes: ['Persistence'], layer: 'core', dependencies: [], externalDependencies: [], requirements: ['Correct result'] }], ports: [], risks: [], scenarios: [
      { id: 'valid', requirement: 'Correct result', kind: 'positive', path: ['policy'], input: 'valid input', expected: 'correct value', assertion: 'value equals expected', checks: ['unit'] },
      { id: 'invalid', requirement: 'Correct result', kind: 'failure', path: ['policy'], input: 'invalid input', expected: 'typed error', assertion: 'throws specified error', checks: ['unit'] },
    ] },
  } };
}
export function reviewed(state, hash = 'source') {
  validatePlanning(state, hash);
  const capture = inspectPlanning(state, hash);
  recordPlanReview(state, hash, { captureId: capture.id, challenges: ['Who owns failure behavior? Policy owns typed errors, not persistence.'], walkthroughs: state.plan.design.scenarios.map(s => ({ scenario: s.id, trace: `${s.input} -> policy -> ${s.expected}`, assertion: s.assertion })), findings: [], limitations: ['Model-authored review does not establish implementation correctness.'] });
  approvePlanning(state, hash);
  return state;
}

test('design validation requires ownership, negative scenarios and explicit DI contracts', () => {
  const state = designedState();
  assert.deepEqual(validateDesign(state.plan), []);
  state.plan.design.scenarios.pop();
  assert.ok(validateDesign(state.plan).some(f => f.code === 'coverage'));
  state.plan.design.components[0].externalDependencies = ['http'];
  assert.ok(validateDesign(state.plan).some(f => f.code === 'injection'));
  state.plan.design.risks.push({ id: 'unknown', description: 'Unknown API', status: 'open', blocking: true });
  assert.ok(validateDesign(state.plan).some(f => f.code === 'risk-open'));
});
test('approval cannot bypass validation, scenarios, blocking findings or fresh identity', () => {
  const state = designedState();
  assert.throws(() => approvePlanning(state, 'source'), /validation/);
  validatePlanning(state, 'source');
  const capture = inspectPlanning(state, 'source');
  assert.throws(() => recordPlanReview(state, 'source', { captureId: capture.id, challenges: ['challenge'], findings: [], walkthroughs: [], limitations: [] }), /every scenario/);
  reviewed(state);
  assert.equal(planningStatus(state, 'source').locked, false);
  assert.equal(planningStatus(state, 'changed').locked, true);
  state.revision++;
  assert.equal(planningStatus(state, 'source').locked, true);
});
test('planned implementation edits do not deadlock approval; design changes relock', () => {
  const state = reviewed(designedState());
  startImplementation(state, 'source');
  assert.equal(planningStatus(state, 'edited-source').locked, false);
  state.plan.goal = 'Changed scope';
  assert.equal(planningStatus(state, 'edited-source').locked, true);
  assert.throws(() => startImplementation(state, 'edited-source'), /locked/);
});
test('informational plans and forged receipt fields cannot grant mutation', () => {
  const state = reviewed(designedState());
  state.plan.verification = 'none';
  assert.throws(() => approvePlanning(state, 'source'), /Informational/);
  assert.equal(planningStatus(state, 'source').locked, true);
});
test('malformed designs fail diagnostically and component cycles are blocked', () => {
  for (const design of [null, [], {}, { components: [null], ports: [], scenarios: [], risks: [] }]) assert.ok(validateDesign({ ...designedState().plan, design }).length);
  const state = designedState();
  state.plan.design.components[0].dependencies = ['policy'];
  assert.ok(validateDesign(state.plan).some(f => f.code === 'cycle'));
});
