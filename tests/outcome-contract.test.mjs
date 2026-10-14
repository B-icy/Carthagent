import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeContractErrors } from '../lib/outcome-contract.mjs';

const plan = () => ({ design: { components: [{id:'input'}, {id:'storage'}] }, acceptance: [{requirement:'Persist submitted value'}], checks: [{id:'roundtrip',kind:'test'}] });
const outcome = () => ({id:'submit',requirement:'Persist submitted value',entrypoint:'POST /items then GET /items/id',observable:'Read returns submitted value',substitutions:['Disposable database'],missedFailure:'UI-only state changes without persistence',checks:['roundtrip']});
test('outcome policy is opt-in, including for multi-component plans', () => {
  assert.deepEqual(outcomeContractErrors(plan()), []);
  assert.match(outcomeContractErrors({...plan(),outcomes:[]})[0], /Opt-in/);
  assert.deepEqual(outcomeContractErrors({...plan(),design:{components:[{id:'helper'}]}}),[]);
  assert.deepEqual(outcomeContractErrors({...plan(),outcomes:[outcome()]}),[]);
});
test('outcome contracts reject absent observations, unlinked checks and static substitutes', () => {
  for (const key of ['entrypoint','observable','missedFailure']) assert.ok(outcomeContractErrors({...plan(),outcomes:[{...outcome(),[key]:''}]}).length);
  assert.ok(outcomeContractErrors({...plan(),outcomes:[{...outcome(),checks:['missing']}]}).length);
  assert.ok(outcomeContractErrors({...plan(),checks:[{id:'roundtrip',kind:'static'}],outcomes:[outcome()]}).length);
});
