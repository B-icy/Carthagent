#!/usr/bin/env node
/** Real OpenCode 2.0.32 offline SWE acceptance through the composed production delivery workflow. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeFixture } from './native-fixture.mjs';
import { runNativeEvaluation } from '../lib/opencode/evaluation.mjs';

let runResult;
const host = await nativeFixture({
  plugin: join(import.meta.dirname, '../lib/opencode/evaluation-budget-plugin'),
  plugins: process.argv[2] ? [process.argv[2]] : [{ package: join(import.meta.dirname, '../plugins/carthagent'), options: { reviewModel: { providerID: 'ctg-fixture', id: 'fixture' } } }],
  env: {
    CTG_EVALUATION_MAX_TURNS: '30', CTG_EVALUATION_MAX_COST: '1',
    CTG_SESSION_OPTIONS: JSON.stringify({ maxTools:60, maxSeconds:180, maxRepairs:20 }),
  },
  respond(body, res) {
    const root = host.cwd;
    const fixedFile = join(root, 'src/value.mjs');
    const messages = body.messages ?? [];
    const tools = (body.tools ?? []).map(tool => tool.function?.name);
    const calls = [];
    const results = new Map();
    for (const message of messages) {
      for (const call of message.tool_calls ?? []) calls.push({ id:call.id, name:call.function?.name, arguments:call.function?.arguments });
      if (message.role === 'tool' && message.tool_call_id) results.set(message.tool_call_id, String(message.content));
    }
    const completed = calls.filter(call => results.has(call.id)).map(call => ({ ...call, output:results.get(call.id) }));
    const done = name => completed.filter(call => call.name === name);
    const executeCalls = done('execute');
    const codeOf = call => {
      try { return JSON.parse(call.arguments ?? '{}').code ?? ''; }
      catch { return String(call.arguments ?? ''); }
    };
    const executed = source => executeCalls.some(call => codeOf(call).includes(source));
    const execution = (code) => dispatch('execute', { code });
    const shell = () => dispatch('shell', {
      command: 'node --test --test-reporter=tap src/value.test.mjs',
      workdir: root,
    });

    if (!completed.length) {
      assert.ok(tools.includes('execute'), 'production host must expose the Code Mode tool for discovery');
      return execution('const result = await search({ query: "delivery plan acceptance checks review design tools", namespace: "carthagent", limit: 20 }); return result');
    }
    if (!executed('delivery_plan')) {
      return execution(`const result = await tools.carthagent["delivery_plan"]({goal:"Repair fixture value so its test passes",assumptions:["The isolated Node test is the acceptance oracle."],artifacts:["src/value.mjs"],outputs:["src/value.mjs"],steps:[{id:"repair-value",title:"Repair the fixture value",checks:["fixture-test"]}],acceptance:[{requirement:"The exported value equals 42.",checks:["fixture-test"]}],checks:[{id:"fixture-test",kind:"test",argv:[${JSON.stringify(process.execPath)},"--test","src/value.test.mjs"],timeoutSeconds:20}]}); return {marker:"CTG_SWE_PLAN_ACCEPTED",result}`);
    }
    if (!done('shell').length) {
      assert.ok(tools.includes('shell'), 'the valid standard delivery plan must unlock native shell');
      return shell();
    }
    const baseline = done('shell')[0];
    assert.match(baseline.output, /not ok 1|fail\s+1/i, 'native shell must observe red before any edit');
    if (!done('edit').length) {
      assert.ok(tools.includes('edit'), `production policy did not unlock the native edit tool after planning: ${tools.join(', ')}`);
      return dispatch('edit', { path:fixedFile, oldString:'export const value = 0;\n', newString:'export const value = 42;\n' });
    }
    if (done('shell').length < 2) {
      assert.ok(tools.includes('shell'), 'native shell must remain available for distinct post-edit verification');
      return shell();
    }
    assert.match(done('shell')[1].output, /pass\s+1/i, 'post-edit native shell test must pass');
    if (!executed('delivery_check')) {
      return execution('return await tools.carthagent["delivery_check"]({id:"all"})');
    }
    if (!executed('delivery_progress')) {
      return execution('const result = await tools.carthagent["delivery_progress"]({step:"repair-value",status:"done",note:"Native red/edit/green chronology completed."}); return {marker:"CTG_SWE_PROGRESS_DONE",result}');
    }
    const reviewCall = [...completed].reverse().find(call => call.name === 'execute'
      && /delivery_review/.test(codeOf(call)) && /inspect/.test(codeOf(call)));
    if (!reviewCall) return execution('return await tools.carthagent["delivery_review"]({action:"inspect"})');
    const captureId = reviewCall.output.match(/"captureId"\s*:\s*"([^"]+)"/)?.[1]
      ?? reviewCall.output.match(/"id"\s*:\s*"([0-9a-f-]{20,})"/)?.[1];
    if (!captureId) throw Error(`Review inspect result did not expose capture ID: ${reviewCall.output}`);
    if (!executeCalls.some(call => /delivery_review/.test(codeOf(call)) && /record/.test(codeOf(call)))) {
      const coverage = [{ requirement:'The exported value equals 42.', assertions:'The fresh fixture-test runs node --test against src/value.test.mjs and asserts value === 42.', status:'demonstrated' }];
      const probes = ['The original value 0 fails the assertion before editing.', 'After editing, the separate native shell invocation passes the same assertion.'];
      return execution(`const result = await tools.carthagent["delivery_review"]({action:"record",captureId:${JSON.stringify(captureId)},coverage:${JSON.stringify(coverage)},probes:${JSON.stringify(probes)},findings:[],limitations:["Offline host proof uses model-authored workflow review; no independent reviewer service is configured.","This fixture verifies native workflow integration, not delivery-policy enforcement."]}); return {marker:"CTG_SWE_REVIEW_RECORDED",result}`);
    }
    if (!executed('delivery_finish')) {
      return execution('const result = await tools.carthagent["delivery_finish"]({status:"verified",review:"Fresh declared test passed and model-authored coverage/probes were recorded; independent review was not configured.",launch:"Not applicable to this isolated module fixture.",limitations:["No independent reviewer service was configured; this is not independent review assurance.","This fixture acceptance does not claim delivery-policy enforcement."]}); return {marker:"CTG_SWE_FINISHED",result}');
    }
    return respondText('The fixture fix passed the declared check and the composed delivery workflow accepted its honest, limited handoff.');

    function dispatch(name, args) {
      if (!tools.includes(name)) throw Error(`Production delivery policy is withholding required native tool ${name}; advertised: ${tools.join(', ')}`);
      const call = { index:0, id:`fixture-call-${host.requests.length}`, type:'function', function:{name,arguments:JSON.stringify(args)} };
      res.writeHead(200, { 'content-type':'text/event-stream', 'cache-control':'no-cache', connection:'keep-alive' });
      const chunk = (delta, finish_reason = null, usage) => `data: ${JSON.stringify({id:`native-swe-${host.requests.length}`,object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason}],...(usage?{usage}:{})})}\n\n`;
      res.end(`${chunk({role:'assistant',tool_calls:[call]})}${chunk({},'tool_calls',{prompt_tokens:20,completion_tokens:8,total_tokens:28})}data: [DONE]\n\n`);
    }
    function respondText(text) {
      res.writeHead(200, { 'content-type':'text/event-stream' });
      const chunk = (delta, finish_reason = null, usage) => `data: ${JSON.stringify({id:`native-swe-${host.requests.length}`,object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason}],...(usage?{usage}:{})})}\n\n`;
      res.end(`${chunk({role:'assistant',content:text})}${chunk({},'stop',{prompt_tokens:20,completion_tokens:8,total_tokens:28})}data: [DONE]\n\n`);
    }
  },
});

try {
  const { client, cwd: directory, location, model, request } = host;
  await host.active('ctg.evaluation-budget', location);
  await host.active('carthagent', location);
  await mkdir(join(directory, 'src'), { recursive: true });
  await writeFile(join(directory, 'src/value.mjs'), 'export const value = 0;\n');
  await writeFile(join(directory, 'src/value.test.mjs'), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { value } from './value.mjs';",
    "test('fixture value is repaired', () => assert.equal(value, 42));",
    '',
  ].join('\n'));
  const baseline = spawnSync(process.execPath, ['--test', '--test-reporter=tap', join(directory, 'src/value.test.mjs')], { cwd: directory, encoding: 'utf8' });
  assert.notEqual(baseline.status, 0, `fixture acceptance starts red: ${baseline.stdout}${baseline.stderr}`);

  const result = runResult = await runNativeEvaluation({
    client, directory,
    metadata: { 'carthagent.options': { maxTools:60, maxSeconds:180, maxRepairs:20 } },
    prompt: `CTG_SWE_DELIVERY_FIXTURE. Discover the registered CTG tools with search; author and follow a valid required-verification delivery plan with a declared test check. Respect standard production tool policy: observe the failing baseline, make the native edit only after the plan unlocks it, run a distinct passing native shell check, record progress, run the declared check, inspect and record honest review coverage/probes, and finish with limitations. Do not claim independent review or delivery-policy enforcement.\nFIXTURE_ROOT=${directory}`,
    provider: model.providerID, model: model.id, timeoutSeconds: 180, maxTurns: 30, maxCost: 1,
  });
  assert.equal(result.runtime, 'opencode-2');
  assert.equal(result.opencodeVersion, '2.0.32');
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.equal(result.outcome, 'succeeded');
  assert.ok(result.productiveTurns >= 8, JSON.stringify(result));
  assert.ok(result.tools.edit >= 1, JSON.stringify(result));
  assert.ok(result.tools.shell >= 2, JSON.stringify(result));
  assert.ok(Number.isFinite(result.cost) && result.cost >= 0, JSON.stringify(result));
  const final = spawnSync(process.execPath, ['--test', '--test-reporter=tap', join(directory, 'src/value.test.mjs')], { cwd: directory, encoding: 'utf8' });
  assert.equal(final.status, 0, final.stdout + final.stderr);
  assert.match(final.stdout, /(?:# pass 1|ℹ pass 1)/);
  assert.equal(await readFile(join(directory, 'src/value.mjs'), 'utf8'), 'export const value = 42;\n');
  const aggregate = await client.session.get({ sessionID: result.sessionID }, request());
  assert.equal(result.cost, aggregate.cost);
  assert.ok(result.tokens > 0);
  const timeline = [];
  const knownCalls = new Map();
  const workflowTools = new Set();
  for (const request of host.requests) for (const message of request.messages) {
    for (const call of message.tool_calls || []) {
      knownCalls.set(call.id, call.function?.name);
      let args = {};
      try { args = JSON.parse(call.function?.arguments ?? '{}'); } catch {}
      if (call.function?.name === 'execute') {
        const code = String(args.code ?? '');
        for (const name of ['delivery_plan','delivery_check','delivery_progress','delivery_review','delivery_finish']) if (code.includes(name)) workflowTools.add(name);
      }
      timeline.push({ kind:'call', id:call.id, name:call.function?.name, arguments:args });
    }
    if (message.role === 'tool' && knownCalls.has(message.tool_call_id)) {
      timeline.push({ kind:'result', id:message.tool_call_id, name:knownCalls.get(message.tool_call_id), output:String(message.content) });
    }
  }
  const baselineAt = timeline.findIndex(item => item.kind === 'result' && item.name === 'shell'
    && /(?:exit(?:ed)? with code\s*[:=]?\s*1|exit code\s*[:=]?\s*1)/i.test(item.output) && /(?:not ok 1|ℹ\s*fail\s+1|#\s*fail\s+1)/i.test(item.output));
  const editAt = timeline.findIndex((item,index) => index > baselineAt && item.kind === 'result' && item.name === 'edit' && !/\b(?:error|failed)\b/i.test(item.output));
  const greenAt = timeline.findIndex((item,index) => index > editAt && item.kind === 'result' && item.name === 'shell'
    && !/(?:exit(?:ed)? with code\s*[:=]?\s*1|exit code\s*[:=]?\s*1)/i.test(item.output)
    && /(?:#\s*pass\s+1|ℹ\s*pass\s+1)/i.test(item.output)
    && /(?:ℹ\s*fail\s+0|#\s*fail\s+0)/i.test(item.output));
  assert.ok(baselineAt >= 0, 'recorded native shell result must prove baseline red');
  assert.ok(editAt > baselineAt, 'completed native edit must follow the baseline failure');
  assert.ok(greenAt > editAt, 'a distinct completed native shell call must prove the post-edit passing test');
  for (const tool of ['delivery_plan', 'delivery_check', 'delivery_progress', 'delivery_review', 'delivery_finish']) {
    assert.ok(workflowTools.has(tool), `composed production workflow must execute ${tool}`);
  }
  const finishCall = timeline.find(item => item.kind === 'call' && item.name === 'execute' && String(item.arguments.code ?? '').includes('delivery_finish'));
  assert.ok(finishCall, 'native workflow must issue delivery_finish');
  const finishResult = timeline.find(item => item.kind === 'result' && item.id === finishCall.id);
  assert.match(finishResult?.output ?? '', /\\"status\\"\s*:\s*\\"verified\\"/, 'production delivery gate must accept the completed declared check and review receipt');
  assert.ok(timeline.some(item => item.kind === 'call' && item.name === 'execute' && /not independent review|independent review was not configured/i.test(String(item.arguments.code ?? ''))), 'fixture must accurately disclose model-authored review limitation');
  const review = spawnSync(process.execPath, [join(import.meta.dirname, 'test-native-review.mjs'), join(import.meta.dirname, '../plugins/carthagent')], {
    cwd: join(import.meta.dirname, '..'), encoding: 'utf8', timeout: 180_000,
    env: { ...process.env, CTG_OPENCODE_BIN: process.env.CTG_OPENCODE_BIN ?? join(import.meta.dirname, '../node_modules/@opencode/cli/bin/opencode.exe') },
  });
  assert.equal(review.status, 0, `${review.stdout}\n${review.stderr}`);
  assert.match(review.stdout, /"independentReview":"passed"/);
  console.log(JSON.stringify({
    host: '2.0.32', outcome: result.outcome, productiveTurns: result.productiveTurns,
    tools: result.tools, cost: result.cost, baseline: 'native shell failed', nativePostEditCheck: 'native shell passed', finalTest: 'passed',
    realOpenCodeHost: true, loopbackProvider: true, composedProductionDelivery: true,
    review: 'separate real-host read-only root-session proof passed (distinct fixture/source); reviewer fixture verdict proves receipt plumbing only, not review quality', deliveryPolicyEnforcement: false,
  }));
} finally {
  if (runResult?.exitCode) {
    console.error(JSON.stringify({ requests:host.requests.length, providerErrors:host.providerErrors.map(error=>error.message) }, null, 2));
  }
  await host.close();
}
