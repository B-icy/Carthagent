import assert from 'node:assert/strict';
import test from 'node:test';
import { selectModelWithVariant } from '../plugins/carthagent/src/ui/model-selection.mjs';

const previousModel = { providerID: 'provider-a', id: 'model-a' };
const candidate = {
  providerID: 'provider-b', id: 'model-b',
  variants: [{ id: 'fast' }, { id: 'deep' }],
};

test('cancelling the nested variant picker does not switch the session model', async () => {
  let current = previousModel;
  let pickerCalls = 0;
  const result = await selectModelWithVariant({
    model: candidate,
    promptForVariant: true,
    chooseVariant: async () => { pickerCalls++; return undefined; },
    switchModel: async (selection) => { current = selection; },
  });
  assert.deepEqual(result, { status: 'cancelled' });
  assert.equal(pickerCalls, 1);
  assert.equal(current, previousModel);
});

test('selecting a declared variant switches with provider/model identity and variant', async () => {
  let switched;
  const result = await selectModelWithVariant({
    model: candidate,
    promptForVariant: true,
    chooseVariant: async () => 'deep',
    switchModel: async (selection) => { switched = selection; },
  });
  assert.deepEqual(result, { status: 'selected', variant: 'deep' });
  assert.deepEqual(switched, { providerID: 'provider-b', id: 'model-b', variant: 'deep' });
});

test('explicit default selection is distinct from cancellation', async () => {
  let switched;
  const result = await selectModelWithVariant({
    model: candidate,
    promptForVariant: true,
    chooseVariant: async () => '',
    switchModel: async (selection) => { switched = selection; },
  });
  assert.deepEqual(result, { status: 'selected', variant: undefined });
  assert.deepEqual(switched, { providerID: 'provider-b', id: 'model-b' });
});

test('invalid explicit variant never mutates the selected model', async () => {
  let switches = 0;
  const result = await selectModelWithVariant({
    model: candidate,
    variant: 'turbo',
    switchModel: async () => { switches++; },
  });
  assert.deepEqual(result, { status: 'invalid', variant: 'turbo' });
  assert.equal(switches, 0);
});

test('variant requested while filtering multiple models remains selected after the model picker', async () => {
  let switched;
  let pickerCalls = 0;
  const result = await selectModelWithVariant({
    model: candidate,
    variant: 'deep',
    promptForVariant: true,
    chooseVariant: async () => { pickerCalls++; return 'fast'; },
    switchModel: async (selection) => { switched = selection; },
  });
  assert.deepEqual(result, { status: 'selected', variant: 'deep' });
  assert.deepEqual(switched, { providerID: 'provider-b', id: 'model-b', variant: 'deep' });
  assert.equal(pickerCalls, 0, 'an explicit requested variant bypasses the nested picker');
});
