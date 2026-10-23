import test from 'node:test';
import assert from 'node:assert/strict';
import { runNativeEvaluation, EVALUATION_BUDGET_METADATA } from '../lib/opencode/evaluation.mjs';

test('evaluation forwards explicit agent and caller metadata without allowing budget replacement', async () => {
  let admitted;
  const client = {
    server: { info: async () => ({ version: '2.0.32' }) },
    plugin: { list: async () => ({ data: [{ id: 'ctg.evaluation-budget', state: { status: 'active' } }] }) },
    session: { create: async input => { admitted = input; throw new Error('stop after admission capture'); } },
  };
  const result = await runNativeEvaluation({
    client, directory: '/fixture', prompt: 'delivery task', provider: 'fixture', model: 'fixture',
    agent: 'ship', maxTurns: 4, maxCost: 1,
    metadata: { 'carthagent.options': { maxTools: 42 }, custom: 'preserved',
      [EVALUATION_BUDGET_METADATA]: { maxTurns: 1000, maxCost: 999 } },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(admitted.agent, 'ship');
  assert.deepEqual(admitted.metadata, {
    'carthagent.options': { maxTools: 42 }, custom: 'preserved',
    [EVALUATION_BUDGET_METADATA]: { maxTurns: 4, maxCost: 1 },
  });
});
