#!/usr/bin/env node
/** Real OpenCode 2.0.32 offline SWE acceptance: advertised tools edit and verify a broken fixture. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeFixture } from './native-fixture.mjs';
import { runNativeEvaluation } from '../lib/opencode/evaluation.mjs';

let runResult;
const host = await nativeFixture({
  plugin: join(import.meta.dirname, '../lib/opencode/evaluation-budget-plugin'),
  plugins: process.argv[2] ? [process.argv[2]] : [join(import.meta.dirname, '../plugins/carthagent')],
  env: { CTG_EVALUATION_MAX_TURNS: '8', CTG_EVALUATION_MAX_COST: '1' },
  respond(body, res) {
    const tools = body.tools || [];
    const edit = tools.find(tool => tool.function?.name === 'edit');
    const shell = tools.find(tool => tool.function?.name === 'shell');
    assert.ok(edit, 'OpenCode must advertise its actual edit tool schema to the local provider');
    assert.ok(shell, 'OpenCode must advertise its actual shell tool schema to the local provider');
    const root = host.cwd;
    const fixedFile = join(root, 'src/value.mjs');
    const testFile = join(root, 'src/value.test.mjs');
    const source = 'export const value = 42;\n';
    const testCommand = `cd ${JSON.stringify(root)} && ${JSON.stringify(process.execPath)} --test --test-reporter=tap ${JSON.stringify(testFile)}; code=$?; printf '\\nCTG_EXIT_CODE=%s\\n' "$code"; exit "$code"`;
    const messages = body.messages;
    const calls = [];
    const results = new Map();
    for (const message of messages) {
      for (const call of message.tool_calls || []) calls.push({ id:call.id, name:call.function?.name });
      if (message.role === 'tool' && message.tool_call_id) results.set(message.tool_call_id, String(message.content));
    }
    const completed = calls.filter(call => results.has(call.id)).map(call => ({ ...call, output:results.get(call.id) }));
    const editIndex = completed.findIndex(call => call.name === 'edit');
    const shellCalls = completed.filter(call => call.name === 'shell');
    const baseline = shellCalls.find(call => editIndex < 0 || completed.indexOf(call) < editIndex);
    const repair = editIndex >= 0 ? completed[editIndex] : undefined;
    const postEditChecks = repair ? shellCalls.filter(call => completed.indexOf(call) > editIndex) : [];
    const baselineObservedRed = Boolean(baseline && /(?:exit(?:ed)? with code\s*[:=]?\s*1|exit code\s*[:=]?\s*1|CTG_EXIT_CODE=1)/i.test(baseline.output)
      && /(?:not ok 1|ℹ\s*fail\s+1|#\s*fail\s+1)/i.test(baseline.output));
    const successfulCheck = postEditChecks.some(call => /(?:exit(?:ed)? with code\s*[:=]?\s*0|exit code\s*[:=]?\s*0|CTG_EXIT_CODE=0)/i.test(call.output)
      && /(?:ℹ\s*pass\s+1|#\s*pass\s+1)/i.test(call.output)
      && /(?:ℹ\s*fail\s+0|#\s*fail\s+0)/i.test(call.output));
    // A successful native edit tool result is completion evidence; unlike shell,
    // the edit tool does not emit an operating-system exit code.
    const editDone = Boolean(repair && !/\b(?:error|failed)\b/i.test(repair.output));
    const name = !baseline ? 'shell' : !repair ? 'edit' : !successfulCheck ? 'shell' : null;
    if (!name && !(baselineObservedRed && editDone && successfulCheck)) throw Error(`Native tool chronology did not establish red shell -> completed edit -> distinct green shell check: ${JSON.stringify(completed.map(({name,output})=>({name,output:output.slice(-1200)})))}`);
    const args = name === 'edit'
      ? { path: fixedFile, oldString: 'export const value = 0;\n', newString: source }
      : { command: testCommand, workdir: root, timeout: 15_000 };
    if (name === 'edit') assert.ok(baselineObservedRed, 'native shell tool must observe the initially failing test before editing');
    const toolCall = { index:0, id:`fixture-call-${host.requests.length}`, type:'function', function:{name,arguments:JSON.stringify(args)} };
    const delta = successfulCheck && editDone && baselineObservedRed
      ? { role:'assistant', content:'Fixed the implementation and confirmed the test passes.' }
      : { role:'assistant', content:null, tool_calls:[toolCall] };
    const finish = successfulCheck && editDone && baselineObservedRed ? 'stop' : 'tool_calls';
    res.writeHead(200, { 'content-type':'text/event-stream', 'cache-control':'no-cache', connection:'keep-alive' });
    const chunk = (choice, usage) => `data: ${JSON.stringify({id:`native-swe-${host.requests.length}`,object:'chat.completion.chunk',created:1,model:'fixture',choices:[choice],...(usage?{usage}:{})})}\n\n`;
    res.write(chunk({index:0,delta,finish_reason:null}));
    res.end(`${chunk({index:0,delta:{},finish_reason:finish},{prompt_tokens:20,completion_tokens:8,total_tokens:28})}data: [DONE]\n\n`);
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
    prompt: `Use the advertised edit tool to fix src/value.mjs so the test passes, then use the advertised shell tool to run ${JSON.stringify(process.execPath)} --test src/value.test.mjs. Do not claim success unless the test output confirms it.\nFIXTURE_ROOT=${directory}`,
    provider: model.providerID, model: model.id, timeoutSeconds: 60, maxTurns: 8, maxCost: 1,
  });
  assert.equal(result.runtime, 'opencode-2');
  assert.equal(result.opencodeVersion, '2.0.32');
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.equal(result.outcome, 'succeeded');
  assert.ok(result.productiveTurns >= 4, JSON.stringify(result));
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
  for (const request of host.requests) for (const message of request.messages) {
    for (const call of message.tool_calls || []) {
      knownCalls.set(call.id, call.function?.name);
      timeline.push({ kind:'call', id:call.id, name:call.function?.name });
    }
    if (message.role === 'tool' && knownCalls.has(message.tool_call_id)) {
      timeline.push({ kind:'result', id:message.tool_call_id, name:knownCalls.get(message.tool_call_id), output:String(message.content) });
    }
  }
  const baselineAt = timeline.findIndex(item => item.kind === 'result' && item.name === 'shell'
    && /(?:exit(?:ed)? with code\s*[:=]?\s*1|exit code\s*[:=]?\s*1|CTG_EXIT_CODE=1)/i.test(item.output) && /(?:not ok 1|ℹ\s*fail\s+1|#\s*fail\s+1)/i.test(item.output));
  const editAt = timeline.findIndex((item,index) => index > baselineAt && item.kind === 'result' && item.name === 'edit' && !/\b(?:error|failed)\b/i.test(item.output));
  const greenAt = timeline.findIndex((item,index) => index > editAt && item.kind === 'result' && item.name === 'shell'
    && /(?:exit(?:ed)? with code\s*[:=]?\s*0|exit code\s*[:=]?\s*0|CTG_EXIT_CODE=0)/i.test(item.output)
    && /(?:ℹ\s*pass\s+1|#\s*pass\s+1)/i.test(item.output)
    && /(?:ℹ\s*fail\s+0|#\s*fail\s+0)/i.test(item.output));
  assert.ok(baselineAt >= 0, 'recorded native shell result must prove baseline red');
  assert.ok(editAt > baselineAt, 'completed native edit must follow the baseline failure');
  assert.ok(greenAt > editAt, 'a distinct completed native shell call must prove the post-edit passing test');
  console.log(JSON.stringify({
    host: '2.0.32', outcome: result.outcome, productiveTurns: result.productiveTurns,
    tools: result.tools, cost: result.cost, baseline: 'native shell failed', nativePostEditCheck: 'native shell passed', finalTest: 'passed',
    realOpenCodeHost: true, loopbackProvider: true,
  }));
} finally {
  if (runResult?.exitCode) {
    console.error(JSON.stringify({ requests:host.requests.length, providerErrors:host.providerErrors.map(error=>error.message) }, null, 2));
  }
  await host.close();
}
