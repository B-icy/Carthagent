import { validateWorkflow } from './workflow.mjs';
import { createHash, randomUUID } from 'node:crypto';

// Pure design policy. Callers supply the observed source snapshot; this module
// never reads files, invokes a model, executes checks, or persists reports.
export const designDigest = plan => createHash('sha256').update(JSON.stringify(plan)).digest('hex');
const text = value => typeof value === 'string' && value.trim().length > 0;
const list = value => Array.isArray(value) ? value : [];
const safe = value => text(value) && /^[a-z][a-z0-9_-]{0,63}$/.test(value);

export function validateDesign(plan) {
  const findings = validateWorkflow(plan || {});
  const fail = (code, message, target = 'design') => findings.push({ code, target, message, severity: 'blocking' });
  const design = plan?.design;
  if (!design || typeof design !== 'object' || Array.isArray(design)) {
    fail('missing-design', 'Declare architecture, injection contracts, scenarios and risks before generating code.');
    return findings;
  }
  for (const field of ['components', 'ports', 'scenarios', 'risks']) if (!Array.isArray(design[field])) fail('array', `${field} must be an array.`, field);
  const components = list(design.components), ports = list(design.ports), scenarios = list(design.scenarios);
  const requirements = list(plan.acceptance).map(a => a.requirement);
  const checks = new Set(list(plan.checks).map(c => c.id));
  const ids = (items, name) => {
    const seen = new Set();
    for (const item of items) {
      if (!item || !safe(item.id) || seen.has(item.id)) fail('identity', `${name} IDs must be unique safe identifiers.`, name);
      seen.add(item?.id);
    }
    return seen;
  };
  const componentIds = ids(components, 'components');
  ids(ports, 'ports'); ids(scenarios, 'scenarios'); ids(list(design.risks), 'risks');
  if (!components.length) fail('components', 'At least one cohesive component is required.');
  for (const c of components.filter(Boolean)) {
    if (!text(c.responsibility) || !list(c.excludes).length || list(c.excludes).some(x => !text(x))) fail('srp', 'Declare one responsibility and explicit non-responsibilities.', c.id);
    if (!['core', 'adapter', 'composition', 'presentation'].includes(c.layer)) fail('layer', 'Use core, adapter, composition or presentation.', c.id);
    if (!Array.isArray(c.dependencies) || c.dependencies.some(id => !componentIds.has(id) || id === c.id)) fail('dependencies', `Dependencies must reference other components. Invalid: ${JSON.stringify(list(c.dependencies).filter(id => !componentIds.has(id) || id === c.id))}; allowed: ${JSON.stringify([...componentIds].filter(id => id !== c.id))}.`, c.id);
    if (!list(c.requirements).length || c.requirements.some(r => !requirements.includes(r))) fail('ownership', `Component must reference exact acceptance requirements. Unknown: ${JSON.stringify(list(c.requirements).filter(r => !requirements.includes(r)))}. Copy plan.acceptance text; do not rewrite obligations.`, c.id);
    if (c.layer === 'core' && list(c.dependencies).some(id => components.find(other => other?.id === id)?.layer === 'adapter')) fail('inversion', 'Core policy must depend on ports, not concrete adapters.', c.id);
  }
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) { fail('cycle', 'Component dependencies contain a cycle.', id); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of list(components.find(c => c?.id === id)?.dependencies)) if (componentIds.has(dep)) visit(dep);
    visiting.delete(id); visited.add(id);
  }
  for (const id of componentIds) visit(id);
  for (const p of ports.filter(Boolean)) {
    if (!componentIds.has(p.owner) || !componentIds.has(p.adapter) || components.find(c => c?.id === p.adapter)?.layer !== 'adapter' || components.find(c => c?.id === p.compositionRoot)?.layer !== 'composition') fail('port-binding', 'Ports need an owner, concrete adapter and composition root.', p.id);
    for (const field of ['input', 'output', 'errors', 'injection', 'testDouble', 'integrationAssertion']) if (!text(p[field])) fail('port-contract', `Port needs ${field}.`, p.id);
  }
  for (const c of components.filter(Boolean)) {
    if (!Array.isArray(c.externalDependencies) || c.externalDependencies.some(id => !ports.some(p => p?.id === id && p.owner === c.id))) fail('injection', 'Every external dependency must name an owned injection port (or use an explicit empty list).', c.id);
  }
  for (const s of scenarios.filter(Boolean)) {
    if (!requirements.includes(s.requirement)) fail('scenario-requirement', `Scenario must name an exact acceptance requirement. Unknown: ${JSON.stringify(s.requirement)}. Copy plan.acceptance text; do not rewrite obligations.`, s.id);
    if (!['positive', 'boundary', 'failure'].includes(s.kind)) fail('scenario-kind', 'Use positive, boundary or failure.', s.id);
    if (!list(s.path).length || s.path.some(id => !componentIds.has(id))) fail('scenario-path', `Scenario needs a path through declared components. Invalid: ${JSON.stringify(list(s.path).filter(id => !componentIds.has(id)))}; allowed: ${JSON.stringify([...componentIds])}.`, s.id);
    if (!list(s.checks).length || s.checks.some(id => !checks.has(id))) fail('scenario-checks', `Scenario needs existing executable check IDs. Invalid: ${JSON.stringify(list(s.checks).filter(id => !checks.has(id)))}; allowed: ${JSON.stringify([...checks])}.`, s.id);
    for (const field of ['input', 'expected', 'assertion']) if (!text(s[field])) fail('scenario-contract', `Scenario needs concrete ${field}.`, s.id);
  }
  for (const requirement of requirements) {
    if (!components.some(c => list(c?.requirements).includes(requirement))) fail('unowned', `No component owns: ${requirement}`);
    for (const kind of ['positive', 'negative']) if (!scenarios.some(s => s?.requirement === requirement && (kind === 'positive' ? s.kind === 'positive' : ['boundary', 'failure'].includes(s.kind)))) fail('coverage', `Missing ${kind} scenario: ${requirement}`);
  }
  for (const risk of list(design.risks).filter(Boolean)) {
    if (!text(risk.description) || !['open', 'resolved'].includes(risk.status) || typeof risk.blocking !== 'boolean') fail('risk', 'Risks need description, status and blocking flag.', risk.id);
    if (risk.status === 'open' && risk.blocking) fail('risk-open', risk.description, risk.id);
    if (risk.status === 'resolved' && !text(risk.evidence)) fail('risk-evidence', 'Resolved risks require evidence.', risk.id);
  }
  return findings;
}

function identity(state, hash) {
  if (!state?.plan || !text(hash)) throw Error('Plan and observed source fingerprint are required.');
  return { runId: state.runId, revision: state.revision, digest: designDigest(state.plan), fingerprint: hash };
}
function matches(receipt, state, hash) {
  return receipt && Object.entries(identity(state, hash)).every(([key, value]) => receipt[key] === value);
}
export function validatePlanning(state, hash, now = new Date().toISOString()) {
  const findings = validateDesign(state.plan);
  state.planning ||= { history: [] };
  state.planning.validation = { ...identity(state, hash), findings, at: now };
  state.planning.history.push({ event: 'validation', receipt: structuredClone(state.planning.validation) });
  delete state.planning.capture;
  delete state.planning.approval;
  delete state.planning.started;
  return state.planning.validation;
}
export function inspectPlanning(state, hash, now = new Date().toISOString()) {
  if (!matches(state.planning?.validation, state, hash) || state.planning.validation.findings.length) throw Error('Fresh passing validation required before plan inspection.');
  const capture = { ...identity(state, hash), id: randomUUID(), at: now, plan: structuredClone(state.plan), previousFindings: structuredClone(state.planning.review?.findings || []), unresolved: structuredClone(state.planning.openFindings || []), provenance: 'Harness captured plan; reading and semantic review remain model-authored.' };
  state.planning.capture = capture;
  delete state.planning.approval;
  delete state.planning.started;
  return structuredClone(capture);
}
export function recordPlanReview(state, hash, review, now = new Date().toISOString()) {
  if (!matches(state.planning?.validation, state, hash)) throw Error('Validate the current plan and snapshot first.');
  if (state.planning.validation.findings.length) throw Error('Repair blocking design findings before review.');
  if (!matches(state.planning.capture, state, hash)) throw Error('No current plan capture: call delivery_design action=inspect, then pass its result.id as review.captureId. Validation or revision clears the earlier capture.');
  if (review?.captureId !== state.planning.capture.id) throw Error(`review.captureId must be the id from the latest inspect result (${state.planning.capture.id}); received ${JSON.stringify(review?.captureId ?? null)}. Earlier captureIds are stale — reuse this id or re-inspect.`);
  if (!list(review?.challenges).length || review.challenges.some(x => !text(x))) throw Error('Record concrete adversarial challenges.');
  if (!Array.isArray(review.findings) || review.findings.some(f => !f || !text(f.description) || !['blocking', 'advisory'].includes(f.severity) || (f.severity === 'advisory' && !text(f.disposition)))) throw Error('Findings need severity, description and advisory disposition.');
  const resolutions = list(review.resolutions);
  const open = state.planning.openFindings || [];
  for (const finding of open) {
    const resolution = resolutions.find(r => r?.id === finding.id);
    if (resolution && (state.revision <= finding.revision || !text(resolution.change) || !text(resolution.evidence))) throw Error('Blocking findings require a later design revision, explicit change and resolution evidence.');
  }
  if (resolutions.some(r => !r || !open.some(f => f.id === r.id))) throw Error('Resolution references an unknown blocking finding.');
  const walkthroughs = list(review.walkthroughs);
  if (list(state.plan.design?.scenarios).some(s => !walkthroughs.some(w => w?.scenario === s.id && text(w.trace) && text(w.assertion)))) throw Error('Walk through every scenario with a trace and assertion.');
  if (!Array.isArray(review.limitations) || review.limitations.some(x => !text(x))) throw Error('Declare review limitations.');
  if (walkthroughs.length !== list(state.plan.design?.scenarios).length || new Set(walkthroughs.map(w => w.scenario)).size !== walkthroughs.length) throw Error('Walkthrough IDs must be unique and match exactly the declared scenarios.');
  const findings = review.findings.map(f => ({ ...structuredClone(f), id: randomUUID(), revision: state.revision }));
  state.planning.openFindings = [...open.filter(f => !resolutions.some(r => r.id === f.id)), ...findings.filter(f => f.severity === 'blocking')];
  const receipt = { ...identity(state, hash), ...structuredClone(review), findings, provenance: 'model-authored; not independent assurance', at: now };
  // Caller-controlled content cannot override receipt identity.
  Object.assign(receipt, identity(state, hash));
  state.planning.review = receipt;
  state.planning.history.push({ event: 'review', receipt: structuredClone(receipt) });
  delete state.planning.approval;
  return receipt;
}
export function approvePlanning(state, hash, now = new Date().toISOString()) {
  if ((state.plan.verification ?? 'required') !== 'required') throw Error('Informational plans cannot authorize implementation.');
  if (!matches(state.planning?.validation, state, hash) || validateDesign(state.plan).length) throw Error('Fresh passing design validation is required.');
  if (!matches(state.planning?.review, state, hash) || (state.planning.openFindings?.length || state.planning.review.findings.some(f => f.severity === 'blocking'))) throw Error('Fresh review with no blocking findings is required.');
  state.planning.approval = { ...identity(state, hash), at: now };
  state.planning.history.push({ event: 'approved', receipt: { ...state.planning.approval } });
  return state.planning.approval;
}
export function planningStatus(state, hash) {
  if (!state?.plan) return { locked: true, phase: 'discovery', reasons: ['Create and test a design before generating code.'] };
  const approval = state.planning?.approval;
  const samePlan = approval && approval.runId === state.runId && approval.revision === state.revision && approval.digest === designDigest(state.plan);
  const started = samePlan && state.planning?.started?.approvalAt === approval.at;
  const unlocked = (state.plan.verification ?? 'required') === 'required' && samePlan && (started || approval.fingerprint === hash);
  return { locked: !unlocked, phase: unlocked ? (started ? 'implementation' : 'approved') : 'design-validation', reasons: unlocked ? [] : ['Implementation locked: validate, review and approve this plan revision on the current source snapshot.'], findings: state.planning?.validation?.findings || [], reviewFindings: [...(state.planning?.openFindings || []), ...(state.planning?.review?.findings || []).filter(f => f.severity !== 'blocking')], enforcement: 'Fail-closed participating-tool gate; not an OS sandbox. External processes and host access are outside this boundary.' };
}
export function startImplementation(state, hash, now = new Date().toISOString()) {
  if (planningStatus(state, hash).locked) throw Error('Implementation locked: test and approve the plan before code, tests or commands.');
  state.planning.started ||= { approvalAt: state.planning.approval.at, at: now };
}
