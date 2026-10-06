import test from 'node:test';
import assert from 'node:assert/strict';
import { probeDiagnostics } from '../lib/probe-diagnostics.mjs';
test('repeated module failures get bounded actionable advice without hiding results', () => {
  const event = { toolName: 'bash', isError: false, content: [{ type: 'text', text: 'ERR_MODULE_NOT_FOUND: tsx\nexit code: 1' }] };
  const before = structuredClone(event);
  let result = probeDiagnostics(undefined, event); assert.equal(result.message, undefined);
  result = probeDiagnostics(result.state, event); assert.match(result.message, /ONE changed hypothesis/);
  assert.match(result.message, /original exit code/); assert.match(result.message, /no execution or approval authority/);
  result = probeDiagnostics(result.state, event); assert.equal(result.message, undefined);
  result = probeDiagnostics(result.state, event); assert.ok(result.message);
  result = probeDiagnostics(result.state, event); assert.equal(result.message, undefined);
  assert.deepEqual(event, before);
  assert.deepEqual(probeDiagnostics(result.state, { toolName: 'bash', content: [{ type: 'text', text: 'tests passed' }] }).state, { failures: 0, family: null });
});
test('ordinary reads preserve diagnostic state, check failures count, unrelated failures restart', () => {
  const prior = { failures: 1, family: 'module-loader' };
  assert.equal(probeDiagnostics(prior, { toolName: 'read' }).state, prior);
  const check = probeDiagnostics(prior, { toolName: 'delivery_check', isError: true, content: [{ type: 'text', text: '{"passed":false,"outputTail":"assertion failed"}' }] });
  assert.equal(check.state.family, 'execution'); assert.equal(check.state.failures, 1);
});
