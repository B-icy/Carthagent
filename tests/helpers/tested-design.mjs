import { validatePlanning, inspectPlanning, recordPlanReview, approvePlanning } from '../../lib/planning.mjs';
import { fingerprint } from '../../lib/delivery.mjs';

// Explicit test scaffolding only: these scenarios describe fixture commands, not
// comprehensive product coverage. Public gate tests do not use auto-approval.
export function fixtureDesign(plan) {
  return {
    components: [{ id: 'fixture', responsibility: 'Run fixture command', excludes: ['Production behavior'], layer: 'core', dependencies: [], externalDependencies: [], requirements: plan.acceptance.map(a => a.requirement) }],
    ports: [], risks: [],
    scenarios: plan.acceptance.flatMap((a, i) => ['positive', 'failure'].map(kind => ({ id: `case${i}_${kind}`, kind, requirement: a.requirement, path: ['fixture'], checks: a.checks, input: `${kind} fixture command`, expected: `${kind} exit status`, assertion: `Assert observed ${kind} exit status` }))),
  };
}
export function fixtureReview(plan) {
  return { challenges: ['Does the public entry point preserve observed exit status?'], walkthroughs: plan.design.scenarios.map(s => ({ scenario: s.id, trace: `${s.input} -> fixture -> ${s.expected}`, assertion: s.assertion })), findings: [], limitations: ['Fixture-only design; does not establish product assertion adequacy.'] };
}
export function approveFixture(state, cwd) {
  state.plan.design = fixtureDesign(state.plan);
  const hash = fingerprint(cwd, ['.']);
  validatePlanning(state, hash);
  const capture = inspectPlanning(state, hash);
  recordPlanReview(state, hash, { ...fixtureReview(state.plan), captureId: capture.id });
  approvePlanning(state, hash);
  return state;
}
