import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetLimits, budgetReason, newBudget } from '../lib/budget.mjs';
test('budget boundaries and configuration fail closed', () => {
  for (const value of ['NaN', '-1', '1.5', '1000001']) assert.throws(() => budgetLimits(() => value));
  const b = newBudget({ tools: 2, seconds: 1, repairs: 1 }, 100);
  assert.equal(budgetReason(b, 'tool', 1099), null);
  assert.equal(budgetReason(b, 'tool', 1100), 'elapsed-time');
  b.tools = 2;
  assert.equal(budgetReason(b, 'tool', 101), 'tool-calls');
  b.repairs = 1;
  assert.equal(budgetReason(b, 'repair', 101), 'repair-rounds');
  b.stopped = 'tool-calls';
  assert.equal(budgetReason(b, undefined, 101), 'tool-calls');
});

test('shared launch arguments validate and forward budgets for both clients', async () => {
  const { buildPiArgs } = await import('../lib/pi.mjs');
  const args = buildPiArgs({ maxTools: '3', maxSeconds: '0', maxRepairs: '1' });
  for (const [flag, value] of [['tools', '3'], ['seconds', '0'], ['repairs', '1']]) assert.equal(args[args.indexOf(`--delivery-max-${flag}`) + 1], value);
  assert.throws(() => buildPiArgs({ maxTools: '-1' }));
  assert.throws(() => buildPiArgs({ maxTools: '0', delivery: false }), /require/);
});
