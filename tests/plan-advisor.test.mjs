import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advisePlan, evaluateAdvisor } from '../lib/plan-advisor.mjs';
import { createJevAdvisor } from '../lib/jev-advisor.mjs';

const payload = (p = 0.8) => ({ model: 'jev-fixture', answers: Object.fromEntries(['srp', 'di', 'tests'].map(k => [k, { type: 'noul', noul: p }])), usage: { input_tokens: 100, output_tokens: 0 } });
test('no-key baseline makes no provider calls and injected advisory cannot mutate plan', async () => {
  const plan = { goal: 'Original', design: {} };
  assert.equal((await advisePlan(plan)).mode, 'disabled');
  const result = await advisePlan(plan, { advisor: { classify: async p => { p.goal = 'Injected'; return { probabilities: { srp: 0.9, di: 0.1, tests: 0.8 }, costUsd: null }; } } });
  assert.equal(plan.goal, 'Original');
  assert.equal(result.authority, 'none');
  assert.equal(result.findings.length, 2);
  assert.equal(result.costUsd, null);
});
test('Jev adapter uses documented typed request, bounded response and explicit pricing', async () => {
  const advisor = createJevAdvisor({ apiKey: 'fixture-key', inputPricePerMillion: 0.042, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.equal(body.questions.srp.type, 'noul');
    assert.equal(body.state.credentials, undefined);
    return new Response(JSON.stringify(payload()));
  } });
  const result = await advisePlan({ goal: 'Plan', credentials: 'must not be sent' }, { advisor });
  assert.equal(result.mode, 'shadow');
  assert.equal(result.costUsd, 100 * 0.042 / 1e6);
});
test('timeout, malformed/oversized data, missing key and HTTP failures do not grant authority or leak errors', async () => {
  assert.throws(() => createJevAdvisor(), /key/);
  for (const fetchImpl of [
    async () => new Response('{}'),
    async () => new Response(JSON.stringify(payload(2))),
    async () => new Response('x'.repeat(70000)),
    async () => new Response('secret token', { status: 503 }),
    async () => { throw Error('sensitive-provider-error'); },
    async () => new Promise(() => {}),
  ]) {
    const result = await advisePlan({}, { advisor: createJevAdvisor({ apiKey: 'key', timeoutMs: 20, fetchImpl }) });
    assert.equal(result.mode, 'unavailable');
    assert.equal(result.authority, 'none');
    assert.doesNotMatch(JSON.stringify(result), /secret token|sensitive-provider-error/);
  }
});
test('shadow evaluation reports false negatives, false positives, Brier and unknown costs honestly', async () => {
  const cases = [{ id: 'fixture', plan: {}, labels: { srp: true, di: false, tests: true } }];
  const baseline = await evaluateAdvisor(cases);
  assert.equal(baseline.falseNegatives, 2);
  assert.equal(baseline.brierScore, null);
  const shadow = await evaluateAdvisor(cases, { advisor: { classify: async () => ({ probabilities: { srp: 0.8, di: 0.7, tests: 0.1 } }) } });
  assert.equal(shadow.truePositives, 1);
  assert.equal(shadow.falsePositives, 1);
  assert.equal(shadow.falseNegatives, 1);
  assert.equal(shadow.costUsd, null);
  assert.ok(Math.abs(shadow.brierScore - (0.04 + 0.49 + 0.81) / 3) < 1e-10);
});
