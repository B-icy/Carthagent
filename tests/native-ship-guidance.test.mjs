import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';

const { shipGuidance } = await createJiti(import.meta.url).import('../plugins/carthagent/src/server/ship-guidance.ts');

test('both workflows explain gated direct tools independently of code-mode discovery', () => {
  for (const workflow of ['standard', 'strict']) {
    const text = shipGuidance({ workflow, prompt: 'Repair trade validation' });
    assert.match(text, /first create delivery_plan/);
    assert.match(text, /standard mode then unlocks implementation/);
    assert.match(text, /strict mode also requires tested-design approval/);
    assert.match(text, /shell \(not bash\), outside execute/);
    assert.match(text, /never use delivery_check to bootstrap file edits/);
  }
});

test('both workflows steer away from secrets files that stall runs on approval', () => {
  for (const workflow of ['standard', 'strict']) {
    assert.match(shipGuidance({ workflow, prompt: 'Fix the route' }), /Do not open \.env, \.env\.\*/);
  }
});
