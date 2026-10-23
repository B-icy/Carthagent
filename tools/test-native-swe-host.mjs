#!/usr/bin/env node
/** Real OpenCode 2.0.32 offline SWE acceptance through the composed production delivery workflow. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeFixture } from './native-fixture.mjs';
import { runNativeEvaluation } from '../lib/opencode/evaluation.mjs';

let runResult;
let reviewRequests = 0;
let reviewerSource = '';
let prePlanTools = [];
const host = await nativeFixture({
  plugin: process.argv[2] ?? join(import.meta.dirname, '../plugins/carthagent'),
  pluginOptions: { reviewModel: { providerID: 'ctg-fixture', id: 'fixture' } },
  plugins: [join(import.meta.dirname, '../lib/opencode/evaluation-budget-plugin')],
  env: {
    CTG_EVALUATION_MAX_TURNS: '30', CTG_EVALUATION_MAX_COST: '1',
    CTG_SESSION_OPTIONS: JSON.stringify({ maxTools:60, maxSeconds:180, maxRepairs:20 }),
  },
  respond(body, res) {
    const reviewText = JSON.stringify(body.messages ?? []);
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
    if (messages.some(message => message.role === 'user' && String(message.content).includes('CTG_SWE_DELIVERY_FIXTURE')) && !executed('delivery_plan') && !prePlanTools.length) {
      prePlanTools = tools;
    }
    if (reviewText.includes('Snapshot SHA-256:') && reviewText.includes('REVIEW_JSON:')) {
      const snapshot = reviewText.match(/Snapshot SHA-256: ([a-f0-9]+)/)?.[1];
      const head = reviewText.match(/HEAD: ([a-f0-9]+)/)?.[1];
      reviewRequests++;
      reviewerSource = reviewText;
      if (!snapshot || !head) throw Error('Reviewer prompt omitted exact source identity');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const content = `Deterministic review receipt plumbing fixture.\nREVIEW_JSON: ${JSON.stringify({version:1,snapshot,head,findings:[]})}\nVERDICT: APPROVE`;
      const chunk = (delta, finish_reason = null, usage) => `data: ${JSON.stringify({id:`native-review-${host.requests.length}`,object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason}],...(usage?{usage}:{})})}\n\n`;
      res.end(`${chunk({role:'assistant',content})}${chunk({},'stop',{prompt_tokens:20,completion_tokens:8,total_tokens:28})}data: [DONE]\n\n`);
      return;
    }
    if (JSON.stringify([...messages].reverse().find(message => message.role === 'user')).includes('STALE_FINISH_ATTEMPT')) {
      return execution('const result = await tools.carthagent["delivery_finish"]({status:"verified",review:"independent receipt is stale after source mutation",launch:"not applicable",limitations:[]}); return result');
    }
    const shell = () => dispatch('shell', {
      command: 'node --test --test-reporter=tap src/value.test.mjs',
      workdir: root,
    });

    if (!completed.length) {
      assert.ok(tools.includes('execute'), 'production host must expose the Code Mode tool for discovery');
      return execution('const result = await search({ query: "delivery plan acceptance checks review design tools", namespace: "carthagent", limit: 20 }); return result');
    }
    if (!executeCalls.some(call => codeOf(call).includes('delivery_finish'))) {
      return execution('const result = await tools.carthagent["delivery_finish"]({status:"verified",review:"premature no-plan attempt",launch:"not applicable",limitations:[]}); return result');
    }
    if (!executed('delivery_finish')) throw Error('The no-plan verified finish call did not produce a tool response');
    if (!executed('delivery_plan')) {
      return execution(`const result = await tools.carthagent["delivery_plan"]({goal:"Repair fixture value so its test passes",assumptions:["The isolated Node test is the acceptance oracle."],artifacts:["src/value.mjs"],outputs:["src/value.mjs"],steps:[{id:"repair-value",title:"Repair the fixture value",checks:["fixture-test"]}],acceptance:[{requirement:"The exported value equals 42.",checks:["fixture-test"]}],checks:[{id:"fixture-test",kind:"test",argv:[${JSON.stringify(process.execPath)},"--test","src/value.test.mjs"],timeoutSeconds:20}]}); return {marker:"CTG_SWE_PLAN_ACCEPTED",result}`);
    }
    if (done('shell').length < 2) {
      assert.ok(tools.includes('shell'), 'the valid standard delivery plan must unlock native shell');
      return shell();
    }
    const baseline = done('shell')[1];
    assert.match(baseline.output, /not ok 1|fail\s+1/i, 'native shell must observe red before any edit');
    if (!done('edit').length) {
      assert.ok(tools.includes('edit'), `production policy did not unlock the native edit tool after planning: ${tools.join(', ')}`);
      return dispatch('edit', { path:fixedFile, oldString:'export const value = 0;\n', newString:'export const value = 42;\n' });
    }
    if (done('shell').length < 3) {
      assert.ok(tools.includes('shell'), 'native shell must remain available for distinct post-edit verification');
      return shell();
    }
    assert.match(done('shell')[2].output, /pass\s+1/i, 'post-edit native shell test must pass');
    if (!executed('delivery_check')) {
      return execution('return await tools.carthagent["delivery_check"]({id:"all"})');
    }
    if (!executeCalls.some(call => codeOf(call).includes('delivery_finish') && /premature attempt before progress/.test(codeOf(call)))) {
      return execution('const result = await tools.carthagent["delivery_finish"]({status:"verified",review:"premature attempt before progress",launch:"not applicable",limitations:[]}); return result');
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
    if (done('execute').filter(call => codeOf(call).includes('delivery_finish') && /Fresh declared test/.test(codeOf(call))).length < 1) {
      return execution('const result = await tools.carthagent["delivery_finish"]({status:"verified",review:"Fresh declared test passed and model-authored coverage/probes were recorded; independent review was not configured.",launch:"Not applicable to this isolated module fixture.",limitations:["No independent reviewer service was configured; this is not independent review assurance.","This fixture acceptance does not claim delivery-policy enforcement."]}); return {marker:"CTG_SWE_FINISHED",result}');
    }
    return respondText('The fixture fix passed the declared check and the composed delivery workflow accepted its honest, limited handoff.');

    function dispatch(name, args) {
      if (!tools.includes(name)) throw Error(`Production delivery policy is withholding required native tool ${name}; advertised: ${tools.join(', ')}`);
      const call = { index:0, id:`fixture-call-${host.requests.length}`, type:'function', function:{name,arguments:JSON.stringify(args)} };
      res.writeHead(200, { 'content-type':'text/event-stream', 'cache-control':'no-cache', connection:'keep-alive' });
      const chunk = (delta, finish_reason = null, usage) => `data: ${JSON.stringify({id:`native-swe-${host.requests.length}`,object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason}],...(usage?{usage}:{})})}\n\n`;
      res.end(`${chunk({role:'assistant',tool_calls:[call]})}${chunk({},'tool_calls',{prompt_tokens:20,completion_tokens:8,total_tokens:28})}data: [DONE]\n\n`);
      return call.id;
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
  await mkdir(join(directory, 'src'), { recursive: true });
  await writeFile(join(directory, 'src/value.mjs'), 'export const value = 0;\n');
  await writeFile(join(directory, 'src/value.test.mjs'), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { value } from './value.mjs';",
    "test('fixture value is repaired', () => assert.equal(value, 42));",
    '',
  ].join('\n'));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
    return result.stdout.trim();
  };
  git('init', '--initial-branch=main');
  git('add', 'src/value.mjs', 'src/value.test.mjs');
  git('-c', 'user.name=CTG fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'SWE fixture baseline');
  await host.active('ctg.evaluation-budget', location);
  await host.active('carthagent', location);
  await assert.rejects(readFile(join(directory, 'unplanned.txt')), 'no unplanned shell execution was issued or created its requested file');
  const baseline = spawnSync(process.execPath, ['--test', '--test-reporter=tap', join(directory, 'src/value.test.mjs')], { cwd: directory, encoding: 'utf8' });
  assert.notEqual(baseline.status, 0, `fixture acceptance starts red: ${baseline.stdout}${baseline.stderr}`);

  const result = runResult = await runNativeEvaluation({
    client, directory,
    agent: 'ship',
    metadata: { 'carthagent.options': { maxTools:60, maxSeconds:180, maxRepairs:20 } },
    prompt: `CTG_SWE_DELIVERY_FIXTURE. Discover the registered CTG tools with search; author and follow a valid required-verification delivery plan with a declared test check. Respect standard production tool policy: observe the failing baseline, make the native edit only after the plan unlocks it, run a distinct passing native shell check, record progress, run the declared check, inspect and record honest review coverage/probes, and finish with limitations. Do not claim independent review or delivery-policy enforcement.\nFIXTURE_ROOT=${directory}`,
    provider: model.providerID, model: model.id, timeoutSeconds: 180, maxTurns: 30, maxCost: 1,
  });
  assert.equal(result.runtime, 'opencode-2');
  const hostInfo = await client.server.info(request());
  assert.equal(result.compatibilityVersion, '2.0.32');
  assert.equal(result.runtimeVersion, hostInfo.version, 'evaluator reports the actual connected server version');
  assert.equal(result.opencodeVersion, hostInfo.version, 'legacy version field retains actual-server semantics');
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.equal(result.outcome, 'succeeded');
  assert.equal(prePlanTools.includes('shell'), false, 'native host withholds shell before a valid standard plan');
  assert.ok(result.productiveTurns >= 8, JSON.stringify(result));
  assert.ok(result.tools.edit >= 1, JSON.stringify(result));
  assert.ok(result.tools.shell >= 2, JSON.stringify(result));
  assert.ok(Number.isFinite(result.cost) && result.cost >= 0, JSON.stringify(result));
  const final = spawnSync(process.execPath, ['--test', '--test-reporter=tap', join(directory, 'src/value.test.mjs')], { cwd: directory, encoding: 'utf8' });
  assert.equal(final.status, 0, final.stdout + final.stderr);
  assert.match(final.stdout, /(?:# pass 1|ℹ pass 1)/);
  assert.equal(await readFile(join(directory, 'src/value.mjs'), 'utf8'), 'export const value = 42;\n');
  const aggregate = await client.session.get({ sessionID: result.sessionID }, request());
  assert.equal(aggregate.agent, 'ship', 'delivery evaluation must explicitly select Ship');
  assert.deepEqual(aggregate.metadata['carthagent.options'], { maxTools:60, maxSeconds:180, maxRepairs:20 }, 'caller delivery options must survive evaluation admission');
  assert.deepEqual(aggregate.metadata['ctg.evaluation.budget'], { maxTurns:30, maxCost:1 }, 'evaluation admission retains its authoritative budget');
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
  const planAt = timeline.findIndex(item => item.kind === 'result' && item.name === 'execute' && /CTG_SWE_PLAN_ACCEPTED|Contract accepted|plan\.d2/.test(item.output));
  const baselineAt = timeline.findIndex((item, index) => index > planAt && item.kind === 'result' && item.name === 'shell'
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
  const finishCalls = timeline.filter(item => item.kind === 'call' && item.name === 'execute' && String(item.arguments.code ?? '').includes('delivery_finish'));
  assert.ok(finishCalls.length >= 3, 'fixture must issue no-plan, pre-progress, and final finish attempts');
  const noPlanFinish = timeline.find(item => item.kind === 'result' && item.id === finishCalls[0].id);
  assert.match(noPlanFinish?.output ?? '', /Call delivery_plan first/);
  const beforeProgress = finishCalls.find(call => /premature attempt before progress/.test(String(call.arguments.code ?? '')));
  assert.ok(beforeProgress);
  const beforeProgressResult = timeline.find(item => item.kind === 'result' && item.id === beforeProgress.id)?.output ?? '';
  assert.match(beforeProgressResult, /incompleteSteps/);
  assert.match(beforeProgressResult, /repair-value/);
  const finishCall = finishCalls.at(-1);
  assert.ok(finishCall, 'native workflow must issue delivery_finish');
  const finishResult = timeline.find(item => item.kind === 'result' && item.id === finishCall.id);
  assert.match(finishResult?.output ?? '', /\\"status\\"\s*:\s*\\"verified\\"/, 'production delivery gate must accept the completed declared check and review receipt');
  assert.ok(timeline.some(item => item.kind === 'call' && item.name === 'execute' && /not independent review|independent review was not configured/i.test(String(item.arguments.code ?? ''))), 'fixture must accurately disclose model-authored review limitation');
  const workspaceRpc = (method, input) => client.rpc.call({ rpcID: 'carthagent.workspace', method, input, location }, request());
  let independentResponse;
  const reviewTarget = await client.session.get({ sessionID: result.sessionID }, request());
  try { independentResponse = await workspaceRpc('startReview', { sessionID: reviewTarget.id }); }
  catch (error) { console.error(JSON.stringify({ error, providerErrors:host.providerErrors.map(item=>item.message), host:host.output }, null, 2)); throw error; }
  const independent = independentResponse.output;
  assert.equal(independent.status, 'approved', JSON.stringify(independent));
  assert.ok(independent.sessionID && independent.sessionID !== result.sessionID, 'reviewer must be a distinct session');
  const reviewer = await client.session.get({ sessionID: independent.sessionID }, request());
  assert.equal(reviewer.parentID, undefined, 'reviewer must be a fresh root session');
  assert.equal(reviewer.location.directory, directory, 'reviewer must inspect this exact delivery worktree');
  assert.equal(reviewRequests, 1, 'independent reviewer must actually be invoked');
  assert.match(reviewerSource, /export const value = 42/, 'reviewer source snapshot must contain the actual delivered edit');
  assert.ok(Array.isArray(reviewer.permissions), 'reviewer session must persist its explicit read-only permission policy');
  assert.ok(reviewer.permissions.some(rule => rule.action === '*' && rule.effect === 'deny'));
  assert.ok(reviewer.permissions.some(rule => rule.action === 'read' && rule.effect === 'allow'));
  for (const action of ['shell', 'edit', 'write', 'execute', 'subagent']) {
    assert.ok(reviewer.permissions.some(rule => rule.action === action && rule.effect === 'deny'), `reviewer permission policy must deny ${action}`);
  }
  const reviewMessages = await client.session.context({sessionID:independent.sessionID},request());
  assert.ok(reviewMessages.some(message => message.type === 'assistant' && message.content?.some(part => part.type === 'text' && /REVIEW_JSON:/.test(part.text))), 'fresh reviewer session must complete a structured review response');
  assert.equal((await workspaceRpc('review', { sessionID: reviewTarget.id })).output.status, 'approved');
  await writeFile(join(directory, 'src/value.mjs'), 'export const value = 43;\n');
  assert.equal((await workspaceRpc('review', { sessionID: reviewTarget.id })).output.status, 'stale', 'source edits must invalidate the exact-worktree review receipt');
  const altered = spawnSync(process.execPath, ['--test', '--test-reporter=tap', join(directory, 'src/value.test.mjs')], { cwd: directory, encoding: 'utf8' });
  assert.notEqual(altered.status, 0, 'post-review source mutation must break the declared acceptance test');
  assert.equal((await workspaceRpc('startReview', { sessionID: reviewTarget.id })).output.status, 'approved');
  await writeFile(join(directory, 'src/value.mjs'), 'export const value = 44;\n');
  assert.equal((await workspaceRpc('startReview', { sessionID: reviewTarget.id })).output.status, 'approved');
  await writeFile(join(directory, 'src/value.mjs'), 'export const value = 45;\n');
  const beforeAlteredFinish = reviewRequests;
  await assert.rejects(workspaceRpc('startReview', { sessionID: reviewTarget.id }));
  assert.equal(reviewRequests, beforeAlteredFinish, 'review admission must stop after its configured round cap');
  await client.session.prompt({sessionID:result.sessionID,text:'STALE_FINISH_ATTEMPT: try to finish verified using now stale evidence.'},request());
  await client.session.wait({sessionID:result.sessionID},{signal:AbortSignal.timeout(45_000)});
  const staleFinishPrompt = [...host.requests].reverse().find(request => request.messages?.some(message => message.role === 'user' && String(message.content).includes('STALE_FINISH_ATTEMPT')))
    ?? host.requests.at(-1);
  assert.ok(staleFinishPrompt, 'stale-finish probe must have its own model request');
  const staleFinishCall = [...staleFinishPrompt.messages.flatMap(message => message.tool_calls ?? [])].reverse().find(call => {
    if (call.function?.name !== 'execute') return false;
    try { return JSON.parse(call.function.arguments ?? '{}').code?.includes('independent receipt is stale after source mutation'); }
    catch { return false; }
  });
  assert.ok(staleFinishCall, 'stale-finish turn must issue its own verified-finish call');
  const staleFinishResult = staleFinishPrompt.messages.find(message => message.role === 'tool' && message.tool_call_id === staleFinishCall.id);
  assert.ok(staleFinishResult, `stale-finish tool call ${staleFinishCall.id} must have a correlated result`);
  assert.match(String(staleFinishResult.content), /Cannot verify:/, 'the source-mutated finish call itself must be rejected');
  assert.match(String(staleFinishResult.content), /pendingChecks/, 'source mutation must invalidate declared check evidence');
  assert.doesNotMatch(String(staleFinishResult.content), /"status"\s*:\s*"verified"/);
  console.log(JSON.stringify({
    host: { compatibilityVersion: result.compatibilityVersion, runtimeVersion: result.runtimeVersion }, outcome: result.outcome, productiveTurns: result.productiveTurns,
    tools: result.tools, cost: result.cost, baseline: 'native shell failed', nativePostEditCheck: 'native shell passed', finalTest: 'passed',
    realOpenCodeHost: true, loopbackProvider: true, composedProductionDelivery: true,
    policyEvidence: {
      unplannedShell: 'withheld before plan; no policy-hook rejection claim',
      plannedNativeShellPositiveControl: 'passed',
      verifiedFinishWithoutPlan: 'rejected',
      verifiedFinishBeforeProgress: 'rejected',
      verifiedFinishAfterSourceMutation: 'rejected because declared evidence is stale',
    },
    review: 'same-worktree root reviewer configured with persisted read-only permissions; source-bound receipt invalidated by later edit; deterministic verdict proves receipt plumbing only, not review quality',
    finalTestPassedBeforeMutation: true, alteredSourceTestFailedIntentionally: true,
  }));
} finally {
  if (runResult?.exitCode) {
    console.error(JSON.stringify({ requests:host.requests.length, providerErrors:host.providerErrors.map(error=>error.message) }, null, 2));
  }
  await host.close();
}
