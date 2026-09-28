import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkflow, workflowGraph, workflowD2, architectureGraph } from '../lib/workflow.mjs';
import { planD2WithProgress } from '../lib/delivery.mjs';
import { parseD2 } from '../lib/tui/d2.mjs';

function plan() {
  const node = (id, step, dependsOn = []) => ({ id, step, dependsOn, title: `Task ${id}`, type: 'work', requirements: ['Works'], components: ['policy'], checks: ['unit'], inputs: [], artifacts: [], effects: ['write'] });
  return { goal: 'Workflow', steps: [{ id: 'api', title: 'API' }, { id: 'ui', title: 'UI' }], acceptance: [{ requirement: 'Works', checks: ['unit'] }], checks: [{ id: 'unit' }], design: { components: [{ id: 'policy', responsibility: 'Policy', layer: 'core', dependencies: [] }], ports: [] }, workflow: { nodes: [node('server', 'api'), node('client', 'ui', ['server'])], recovery: [{ from: 'client', to: 'server', when: 'Contract mismatch', maxAttempts: 2, stop: 'Report blocked' }] } };
}
test('agent workflow preserves branches/recovery and mandatory gate overlay', () => {
  const p = plan();
  assert.deepEqual(validateWorkflow(p), []);
  const graph = workflowGraph(p);
  assert.ok(graph.authored);
  assert.equal(graph.nodes.filter(n => n.type === 'gate').length, 4);
  assert.ok(graph.edges.some(e => e.kind === 'recovery' && e.maxAttempts === 2));
  const source = planD2WithProgress(p, { step0: 'done' });
  assert.match(source, /Task server \[done\]/);
  assert.equal(parseD2(source).nodes.length, 6);
  assert.equal(architectureGraph(p).nodes[0].layer, 'core');
});
test('invalid workflow references, cycles, effects, steps and unbounded recovery fail', () => {
  for (const mutate of [
    p => p.workflow.nodes[0].dependsOn.push('client'),
    p => p.workflow.nodes[0].dependsOn.push('missing'),
    p => p.workflow.nodes[0].id = 'gate_design',
    p => p.workflow.nodes[0].effects.push('deploy'),
    p => p.workflow.nodes.pop(),
    p => p.workflow.recovery[0].maxAttempts = 0,
    p => p.workflow.nodes[0].components.push('missing'),
  ]) {
    const p = plan(); mutate(p);
    assert.ok(validateWorkflow(p).length);
    assert.throws(() => workflowGraph(p));
  }
});
test('labels are data, not injectable D2 commands; legacy projection is available', () => {
  const p = plan();
  p.workflow.nodes[0].title = 'quoted "title"\ngate_design -> hacked';
  const graph = parseD2(workflowD2(p));
  assert.equal(graph.nodes.length, 6);
  assert.equal(graph.nodes.find(n => n.id === 'server').label, p.workflow.nodes[0].title + ' [pending]');
  delete p.workflow;
  assert.equal(workflowGraph(p).authored, false);
  assert.match(planD2WithProgress(p), /Verify checks/);
});
