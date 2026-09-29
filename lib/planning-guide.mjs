// Presentation only: approval and validation remain in planning.mjs.
export const PLANNING_START = `Planning startup: inspect the relevant entry point, its callers/types and nearby tests, then submit the first concrete delivery_plan. Discovery is not an exhaustive audit. Record remaining uncertainties as assumptions/risks and investigate them through the approved plan. Preserve EVERY requested requirement and output: a small implementation slice is not a smaller contract. Call delivery_design action="guide" for exact fields and an illustrative example rather than repeatedly reading the roadmap. After about 8 discovery tools, prefer a plan or identify ONE missing fact requiring a targeted read. Shell/test execution stays locked until validate -> inspect -> review -> approve. Never invent baseline results.`;
export function planningGuide() {
  const requirement = 'Invalid header values throw before changing existing headers';
  return {
    authority: 'none',
    instructions: 'Illustrative shape, NOT your task plan. Substitute all exact requirements, actual boundaries/check commands and concrete assertions. No automatic scaffolding or execution evidence.',
    sequence: ['delivery_plan', 'delivery_design validate (fix findings via delivery_revise)', 'delivery_design inspect (read capture; optional Jev advice runs here)', 'delivery_design review', 'delivery_design approve', 'implement -> checks -> final delivery_review -> delivery_finish'],
    fields: {
      component: 'id, responsibility, excludes:string[], layer:core|adapter|composition|presentation, dependencies:component IDs[], externalDependencies:owned port IDs[], requirements:EXACT acceptance text[]',
      port: 'id, owner:component ID, adapter:adapter-layer ID, compositionRoot:composition-layer ID, input, output, errors, injection, testDouble, integrationAssertion (last six nonempty strings)',
      scenario: 'id, kind:positive|boundary|failure, requirement:EXACT acceptance text, path:component IDs[], checks:check IDs[], input, expected, assertion',
      risk: 'id, description, status:open|resolved, blocking:boolean, evidence:string if resolved. Open blocking risk prevents approval.',
      review: 'captureId, challenges:string[], walkthroughs:[{scenario:scenario ID,trace,assertion}], findings:[{severity:blocking|advisory,description,disposition (required for advisory)}], limitations:string[], resolutions:[{id,change,evidence}] for earlier blockers (requires later revision).',
    },
    rules: ['Every acceptance requirement needs an owning component, a positive AND failure/boundary scenario, linked to real checks.', 'dependencies reference components, externalDependencies owned ports. Core must not depend directly on concrete adapters.', 'ports:[] is valid when there are no external dependencies; do not invent DI abstractions for a pure helper.', 'Share a few real check suites across requirements. Required delivery cannot use only static checks.', 'Revision arrays replace arrays: preserve exact acceptance/outputs. Changed obligations need fresh checks.', 'Shape/references are deterministic. Jev assesses semantic SRP/DI/test adequacy after valid inspection, never schema repair or approval.'],
    example: {
      goal: 'Add atomic header validation', assumptions: ['Illustrative test command: replace with real repository path'], artifacts: ['.'], steps: ['Implement validation and regressions'],
      acceptance: [{ requirement, checks: ['headers'] }], checks: [{ id: 'headers', kind: 'test', argv: ['node', '--test', 'test/headers.test.js'], timeoutSeconds: 60 }],
      design: { components: [{ id: 'headers', responsibility: 'Validate values before committing header state', excludes: ['Network transport'], layer: 'core', dependencies: [], externalDependencies: [], requirements: [requirement] }], ports: [], risks: [], scenarios: [
        { id: 'valid', kind: 'positive', requirement, path: ['headers'], checks: ['headers'], input: 'Existing X=a; append b', expected: 'a then b', assertion: 'Deep-equal stored values to [a,b]' },
        { id: 'invalid', kind: 'failure', requirement, path: ['headers'], checks: ['headers'], input: 'Existing X=a; append [b,CRLF]', expected: 'TypeError; X unchanged', assertion: 'Assert TypeError and deep-equal before/after snapshots' },
      ] },
    },
  };
}
export function planningNext(state, result) {
  const ids = value => Array.isArray(value) ? value.map(item => item?.id) : [];
  return result.findings?.length ? {
    next: 'Repair blocking findings with delivery_revise, then validate again. No Jev call is needed for schema repair.',
    references: { components: ids(state.plan.design?.components), ports: ids(state.plan.design?.ports), checks: state.plan.checks.map(c => c.id), requirements: state.plan.acceptance.map(a => a.requirement) },
  } : { next: 'Call delivery_design inspect; read the capture and optional Jev advice, then review and approve. Passing shape is not semantic proof.' };
}
