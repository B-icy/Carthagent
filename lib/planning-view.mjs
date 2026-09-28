import { planningStatus } from './planning.mjs';
import { workflowGraph, architectureGraph } from './workflow.mjs';
import { evidenceFresh, pendingRequirements, reviewFresh, requiresReview } from './delivery.mjs';

// Shared presentation projection: no I/O and no guessed successful transitions.
export function planningView(state, hash, { runningCheck } = {}) {
  const gate = planningStatus(state, hash);
  if (!state?.plan) return { gate, workflow: null, architecture: null, evidence: [], current: [], blockers: gate.reasons };
  const plan = state.plan;
  const evidence = (plan.checks || []).map(check => {
    const receipt = state.evidence?.[check.id];
    const status = runningCheck === check.id ? 'active' : !receipt ? 'pending' : !receipt.passed ? 'fail' : evidenceFresh(check, receipt, hash, state) ? 'done' : 'stale';
    return { id: check.id, status, logPath: receipt?.logPath, code: receipt?.code, executedRevision: receipt?.executedRevision, fingerprint: receipt?.fingerprint };
  });
  let workflow;
  try { workflow = workflowGraph(plan); }
  catch (error) { workflow = { nodes: [], edges: [], error: error.message }; }
  const pending = pendingRequirements(state, hash);
  const allFresh = evidence.length > 0 && evidence.every(e => e.status === 'done') && pending.length === 0;
  const review = !requiresReview(state) || reviewFresh(state, hash);
  const statuses = {
    gate_design: gate.locked ? 'blocked' : 'done',
    gate_verify: runningCheck ? 'active' : evidence.some(e => e.status === 'fail') ? 'fail' : evidence.some(e => e.status === 'stale') ? 'stale' : allFresh ? 'done' : 'pending',
    gate_review: review ? 'done' : state.reviewEvidence ? 'stale' : 'pending',
    gate_deliver: state.status === 'blocked' ? 'blocked' : state.status === 'verified' && allFresh && review && !gate.locked ? 'done' : 'pending',
  };
  workflow.nodes = workflow.nodes.map(node => {
    let status = statuses[node.id] || 'proposed';
    if (node.type === 'work') {
      const index = plan.steps.findIndex((s, i) => (typeof s === 'string' ? `legacy_${i + 1}` : s.id) === node.step);
      status = state.stepStatus?.[`step${index}`] || 'pending';
      if (status === 'failed') status = 'fail';
      if (gate.locked && status !== 'done' && status !== 'fail') status = 'blocked';
    } else if (node.type === 'check') {
      const receipts = evidence.filter(e => node.checks.includes(e.id));
      status = receipts.some(e => e.status === 'active') ? 'active' : receipts.some(e => e.status === 'fail') ? 'fail' : receipts.some(e => e.status === 'stale') ? 'stale' : receipts.length && receipts.every(e => e.status === 'done') ? 'done' : 'pending';
    }
    return { ...node, status };
  });
  const blockers = [...gate.reasons, ...(gate.findings || []).map(f => f.message), ...(gate.reviewFindings || []).filter(f => f.severity === 'blocking').map(f => f.description), ...pending.map(r => `Fresh requirement execution needed: ${r}`)];
  return { gate, workflow, architecture: architectureGraph(plan), evidence, current: workflow.nodes.filter(n => n.status === 'active').map(n => ({ id: n.id, title: n.title })), blockers, revision: state.revision, provenance: 'Observed receipts and explicit progress; proposed decisions/artifacts are not inferred complete.' };
}

export function planningViewLines(view, tab = 'workflow') {
  const lines = [`${tab.toUpperCase()} · ${view.gate.phase} · rev ${view.revision ?? '-'}`];
  if (tab === 'architecture') {
    for (const c of view.architecture?.nodes || []) lines.push(`${c.id} [${c.layer}] ${c.title}`, `  excludes: ${(c.excludes || []).join('; ')}`);
    for (const p of view.architecture?.ports || []) lines.push(`${p.owner} -> port ${p.id} -> ${p.adapter} (injected at ${p.compositionRoot})`);
  } else if (tab === 'evidence') {
    for (const e of view.evidence) lines.push(`${e.id}: ${e.status} · executed rev ${e.executedRevision ?? '-'}`, `  ${e.logPath || 'No execution receipt'}`);
  } else {
    for (const n of view.workflow?.nodes || []) lines.push(`${n.id} [${n.status}] ${n.title}`);
    for (const e of view.workflow?.edges || []) lines.push(`${e.from} -> ${e.to}${e.label ? `: ${e.label}` : ''}`);
  }
  if (view.blockers.length) lines.push('BLOCKERS', ...view.blockers);
  return lines;
}
