// Canonical, non-executable workflow data. Models propose nodes and branches;
// harness policy remains authoritative. No renderer or process dependencies.
const list = v => Array.isArray(v) ? v : [];
const text = v => typeof v === 'string' && v.trim().length > 0;
const safe = v => text(v) && /^[a-z][a-z0-9_-]{0,39}$/.test(v) && !v.startsWith('gate_');
export function validateWorkflow(plan) {
  if (plan.workflow === undefined) return []; // Legacy plans have a projection.
  const errors = [], workflow = plan.workflow;
  const fail = message => errors.push({ code: 'workflow', target: 'workflow', severity: 'blocking', message });
  if (!workflow || typeof workflow !== 'object' || !Array.isArray(workflow.nodes) || !Array.isArray(workflow.recovery)) { fail('Workflow requires nodes and recovery arrays.'); return errors; }
  if (!workflow.nodes.length || workflow.nodes.length > 80) fail('Workflow requires 1–80 nodes.');
  if (workflow.recovery.length > 80) fail('Use at most 80 recovery transitions.');
  const ids = new Set(), steps = new Set(list(plan.steps).map((s, i) => typeof s === 'string' ? `legacy_${i + 1}` : s.id));
  const components = new Set(list(plan.design?.components).map(c => c?.id));
  const checks = new Set(list(plan.checks).map(c => c.id));
  const requirements = new Set(list(plan.acceptance).map(a => a.requirement));
  for (const n of workflow.nodes) {
    if (!n || !safe(n.id) || ids.has(n.id)) { fail('Node IDs must be unique safe IDs outside the gate_ namespace.'); continue; }
    ids.add(n.id);
    if (!text(n.title) || n.title.length > 500 || !['work', 'decision', 'check', 'artifact'].includes(n.type)) fail(`Invalid title/type: ${n.id}`);
    for (const field of ['dependsOn', 'requirements', 'components', 'checks', 'inputs', 'artifacts', 'effects']) if (!Array.isArray(n[field]) || n[field].some(v => !text(v)) || new Set(n[field]).size !== n[field].length) fail(`${n.id}.${field} must be a unique string array.`);
    if (list(n.requirements).some(id => !requirements.has(id)) || list(n.components).some(id => !components.has(id)) || list(n.checks).some(id => !checks.has(id))) fail(`Unknown requirement/component/check: ${n.id}`);
    if (list(n.effects).some(effect => !['read', 'write', 'execute'].includes(effect))) fail(`Unknown permitted effect: ${n.id}`);
    if (n.type === 'work' && !steps.has(n.step)) fail(`Work node needs a declared step: ${n.id}`);
    if (n.type === 'check' && !list(n.checks).length) fail(`Check node needs check IDs: ${n.id}`);
    if (n.type === 'decision' && !text(n.condition)) fail(`Decision needs a condition: ${n.id}`);
  }
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) { fail(`Dependency cycle at ${id}; use bounded recovery transitions instead.`); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of list(workflow.nodes.find(n => n?.id === id)?.dependsOn)) {
      if (!ids.has(dep)) fail(`Unknown dependency ${dep}`); else visit(dep);
    }
    visiting.delete(id); visited.add(id);
  }
  for (const id of ids) visit(id);
  for (const r of workflow.recovery) {
    if (!r || !ids.has(r.from) || !ids.has(r.to) || !text(r.when) || !text(r.stop) || !Number.isInteger(r.maxAttempts) || r.maxAttempts < 1 || r.maxAttempts > 10) fail('Recovery needs known endpoints, condition, stop reason and maxAttempts 1–10.');
  }
  for (const step of steps) if (!workflow.nodes.some(n => n?.type === 'work' && n.step === step)) fail(`Workflow omits step ${step}`);
  return errors;
}

export function workflowGraph(plan) {
  const errors = validateWorkflow(plan);
  if (errors.length) throw Error(errors.map(e => e.message).join('\n'));
  const steps = list(plan.steps);
  const proposed = plan.workflow ? structuredClone(plan.workflow.nodes) : steps.map((s, i) => ({
    id: `step${i}`, step: typeof s === 'string' ? `legacy_${i + 1}` : s.id, title: typeof s === 'string' ? s : s.title, type: 'work',
    dependsOn: typeof s === 'string' ? (i ? [`step${i - 1}`] : []) : list(s.dependsOn).map(id => `step${steps.findIndex(other => other?.id === id)}`),
    requirements: [], components: [], checks: typeof s === 'string' ? [] : list(s.checks), inputs: [], artifacts: [], effects: ['write'],
  }));
  const gates = [
    { id: 'gate_design', title: 'Test + approve plan', type: 'gate' },
    { id: 'gate_verify', title: 'Fresh checks + coverage', type: 'gate' },
    { id: 'gate_review', title: 'Final snapshot review', type: 'gate' },
    { id: 'gate_deliver', title: 'Complete handoff', type: 'gate' },
  ];
  const edges = [];
  for (const n of proposed) for (const dep of n.dependsOn.length ? n.dependsOn : ['gate_design']) edges.push({ from: dep, to: n.id, kind: 'dependency' });
  for (const n of proposed) if (!proposed.some(other => other.dependsOn.includes(n.id))) edges.push({ from: n.id, to: 'gate_verify', kind: 'dependency' });
  if (!proposed.length) edges.push({ from: 'gate_design', to: 'gate_verify', kind: 'dependency' });
  edges.push({ from: 'gate_verify', to: 'gate_review', kind: 'dependency' }, { from: 'gate_review', to: 'gate_deliver', kind: 'dependency' });
  for (const r of list(plan.workflow?.recovery)) edges.push({ ...r, kind: 'recovery', label: `${r.when}; <=${r.maxAttempts}; stop: ${r.stop}` });
  return { authored: Boolean(plan.workflow), nodes: [gates[0], ...proposed, ...gates.slice(1)], edges, semantics: 'Dependency DAG plus proposed bounded recovery; not an executable scheduler. Effects and conditions are declarations, not sandbox permissions.' };
}

export function workflowD2(plan, stepStatus = {}) {
  const graph = workflowGraph(plan), steps = list(plan.steps);
  const lines = ['direction: down'];
  for (const n of graph.nodes) {
    const index = steps.findIndex((s, i) => (typeof s === 'string' ? `legacy_${i + 1}` : s.id) === n.step);
    const status = index < 0 ? '' : stepStatus[`step${index}`] || 'pending';
    lines.push(`${n.id}: ${JSON.stringify(`${n.title}${status ? ` [${status}]` : ''}`)}`);
  }
  for (const e of graph.edges) lines.push(`${e.from} -> ${e.to}${e.label ? `: ${JSON.stringify(e.label)}` : ''}`);
  return lines.join('\n') + '\n';
}

export function architectureGraph(plan) {
  return {
    nodes: list(plan.design?.components).map(c => ({ id: c.id, title: c.responsibility, layer: c.layer, excludes: c.excludes, requirements: c.requirements })),
    edges: list(plan.design?.components).flatMap(c => list(c.dependencies).map(to => ({ from: c.id, to, kind: 'dependency' }))),
    ports: structuredClone(list(plan.design?.ports)),
  };
}
