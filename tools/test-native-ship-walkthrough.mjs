#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { latestReport } from '../lib/reports.mjs';
import { nativeFixture, streamText } from './native-fixture.mjs';

const requirement = 'fixture content is correct';
const design = {
  components: [{ id: 'fixture', responsibility: 'Write the fixture output', excludes: ['production behavior'], layer: 'core', dependencies: [], externalDependencies: [], requirements: [requirement] }],
  ports: [], risks: [],
  scenarios: [
    { id: 'valid', requirement, kind: 'positive', path: ['fixture'], input: 'correct output', expected: 'check passes', assertion: 'exact UTF-8 file contents match', checks: ['fixture-check'] },
    { id: 'invalid', requirement, kind: 'failure', path: ['fixture'], input: 'broken output', expected: 'check fails', assertion: 'wrong contents trigger an assertion failure', checks: ['fixture-check'] },
  ],
};
const plan = {
  goal: 'Exercise native Ship from approval through a repaired verified handoff',
  assumptions: [], artifacts: ['fixture.txt'], outputs: ['fixture.txt'],
  steps: [{ id: 'fixture', title: 'Create and verify fixture output' }],
  acceptance: [{ requirement, checks: ['fixture-check'] }],
  checks: [{ id: 'fixture-check', kind: 'test', argv: ['node', '-e', 'require("node:assert/strict").equal(require("node:fs").readFileSync("fixture.txt", "utf8"), "fixture output\\n")'], timeoutSeconds: 5 }],
  design,
};
const designReview = {
  challenges: ['Does broken content actually fail the checker?'],
  walkthroughs: design.scenarios.map(item => ({ scenario: item.id, trace: `${item.input} -> fixture -> ${item.expected}`, assertion: item.assertion })),
  findings: [], limitations: ['Model-authored fixture review, not independent assurance.'],
};
const call = (name, input) => `await tools.carthagent[${JSON.stringify(name)}](${JSON.stringify(input)})`;
const finish = { status: 'verified', review: 'Exact content check and repaired failure inspected.', launch: 'Fixture check executed in this disposable workspace.', limitations: ['Fixture-only walkthrough; no production or visual assurance.'] };
const actions = [
  { code: `return ${call('delivery_plan', plan)}` },
  { code: `return ${call('delivery_finish', finish)}` },
  { code: `return ${call('delivery_design', { action: 'validate' })}` },
  { code: `const capture = String(${call('delivery_design', { action: 'inspect' })}); const captureId = JSON.parse(capture).captureId; if (!captureId) throw Error("Missing design capture"); return await tools.carthagent.delivery_design({ action: "review", captureId, review: ${JSON.stringify(designReview)} })` },
  { code: `return ${call('delivery_design', { action: 'approve' })}` },
  { shell: 'printf broken > fixture.txt' },
  { code: `return ${call('delivery_check', { id: 'all' })}` },
  { code: `return ${call('delivery_finish', finish)}` },
  { shell: "printf 'fixture output\\n' > fixture.txt" },
  { code: `return ${call('delivery_progress', { step: 'fixture', status: 'done' })}` },
  { code: `return ${call('delivery_check', { id: 'all' })}` },
  { code: `const capture = JSON.parse(String(${call('delivery_review', { action: 'inspect' })})); return await tools.carthagent.delivery_review({ action: "record", captureId: capture.id, coverage: [{ requirement: ${JSON.stringify(requirement)}, status: "demonstrated", assertions: "The real checker rejected broken content, then accepted the repaired exact UTF-8 contents." }], probes: ["Observed assertion failure before repair and a passing exact-content assertion afterward."], findings: [], limitations: ["Model-authored fixture review; not independent production assurance."] })` },
  { code: `return ${call('delivery_finish', finish)}` },
];
let stage = 0;
const host = await nativeFixture({
  pluginOptions: { delivery: true, deliveryOptions: { workflow: 'strict' } },
  respond(body, response) {
    const lastUser = JSON.stringify([...body.messages].reverse().find(item => item.role === 'user'));
    if (lastUser.includes('WALKTHROUGH_RESUME') || lastUser.includes('WALKTHROUGH_LITE')) return streamText(response, 'WALKTHROUGH_RESUMED');
    const action = actions[stage++];
    if (!action) return streamText(response, 'WALKTHROUGH_VERIFIED');
    const name = action.shell ? 'shell' : 'execute';
    assert.ok(body.tools.some(tool => tool.function?.name === name), `${name} must be admitted at walkthrough stage ${stage}`);
    const delta = { role: 'assistant', tool_calls: [{ index: 0, id: `walkthrough-${stage}`, type: 'function', function: { name, arguments: JSON.stringify(action.shell ? { command: action.shell } : { code: action.code }) } }] };
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(`data: ${JSON.stringify({ id: `walkthrough-${stage}`, object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`);
  },
});
try {
  const session = await host.client.session.create({ location: host.location, model: host.model, agent: 'ship', metadata: { 'carthagent.options': { workflow: 'strict' } }, title: 'Native Ship full lifecycle' }, host.request());
  await host.active();
  await host.client.session.prompt({ sessionID: session.id, text: 'Run the strict Ship fixture walkthrough.' }, host.request());
  await host.client.session.wait({ sessionID: session.id }, host.request(90_000));
  const report = latestReport(host.cwd);
  assert.equal(report?.state.status, 'verified', JSON.stringify(await host.client.session.context({ sessionID: session.id }, host.request())));
  assert.equal(report.state.workflowMode, 'strict');
  assert.ok(report.state.planning.approval);
  assert.ok(report.state.planning.started);
  assert.equal(report.state.evidence['fixture-check'].passed, true);
  assert.ok(report.state.reviewEvidence);
  assert.equal(await readFile(`${host.cwd}/fixture.txt`, 'utf8'), 'fixture output\n');
  const history = JSON.stringify(await host.client.message.list({ sessionID: session.id }, host.request()));
  assert.match(history, /Cannot verify:/);
  assert.match(history, /passed.{0,40}false/);
  assert.equal(stage, actions.length + 1);
  const runID = report.state.runId;
  await host.stop();
  const client = await host.start();
  await host.active();
  await client.session.prompt({ sessionID: session.id, text: 'WALKTHROUGH_RESUME inspect the saved handoff without changing files.' }, host.request());
  await client.session.wait({ sessionID: session.id }, host.request());
  assert.equal(latestReport(host.cwd).state.runId, runID);
  assert.equal(latestReport(host.cwd).state.status, 'verified');
  await client.session.switchAgent({ sessionID: session.id, agent: 'lite' }, host.request());
  const requestsBefore = host.requests.length;
  await client.session.prompt({ sessionID: session.id, text: 'WALKTHROUGH_LITE respond directly.' }, host.request());
  await client.session.wait({ sessionID: session.id }, host.request());
  const liteRequest = host.requests.slice(requestsBefore).at(-1);
  assert.equal(liteRequest.tools.some(tool => tool.function?.name.startsWith('carthagent_delivery_')), false);
  assert.equal((await client.session.get({ sessionID: session.id }, host.request())).agent, 'lite');
  console.log(JSON.stringify({ runtime: host.runtimeIdentity.runtimeVersion, strictApproval: 'passed', failedCheckAndRepair: 'passed', reviewAndVerifiedFinish: 'passed', serviceRestartAndResume: 'passed', liteSwitch: 'passed', providerRequests: host.requests.length }));
} finally {
  await host.close();
}
