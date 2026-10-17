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
    const testCommand = `${JSON.stringify(process.execPath)} --test ${JSON.stringify(testFile)}`;
    const messages = body.messages;
    const toolCalls = messages.flatMap(message => message.tool_calls || []);
    const toolByID = new Map(toolCalls.map(call => [call.id, call.function?.name]));
    const results = messages.filter(message => message.role === 'tool');
    const editDone = results.some(message => toolByID.get(message.tool_call_id) === 'edit' || message.name === 'edit');
    const shellResults = results.filter(message => toolByID.get(message.tool_call_id) === 'shell' || message.name === 'shell').map(message => String(message.content));
    const baselineObservedRed = shellResults.some(content => /exit code 1|fail 1|not ok 1/i.test(content));
    const successfulCheck = shellResults.some(content => /# pass 1|tests 1/i.test(content));
    const name = shellResults.length === 0 || editDone ? 'shell' : 'edit';
    const args = name === 'edit'
      ? { path: fixedFile, oldString: 'export const value = 0;\n', newString: source }
      : { command: testCommand, workdir: root, timeout: 15_000 };
    if (name === 'edit') assert.ok(baselineObservedRed, 'native shell tool must observe the initially failing test before editing');
    const toolCall = { index:0, id:`fixture-call-${host.requests.length}`, type:'function', function:{name,arguments:JSON.stringify(args)} };
    const delta = successfulCheck && editDone
      ? { role:'assistant', content:'Fixed the implementation and confirmed the test passes.' }
      : { role:'assistant', content:null, tool_calls:[toolCall] };
    const finish = successfulCheck && editDone ? 'stop' : 'tool_calls';
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
  const baseline = spawnSync(process.execPath, ['--test', 'src/value.test.mjs'], { cwd: directory, encoding: 'utf8' });
  assert.notEqual(baseline.status, 0, 'fixture acceptance starts red');

  const result = runResult = await runNativeEvaluation({
    client, directory,
    prompt: `Use the advertised edit tool to fix src/value.mjs so the test passes, then use the advertised shell tool to run ${JSON.stringify(process.execPath)} --test src/value.test.mjs. Do not claim success unless the test output confirms it.\nFIXTURE_ROOT=${directory}`,
    provider: model.providerID, model: model.id, timeoutSeconds: 60, maxTurns: 8, maxCost: 1,
  });
  assert.equal(result.runtime, 'opencode-2');
  assert.equal(result.opencodeVersion, '2.0.32');
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.equal(result.outcome, 'succeeded');
  assert.ok(result.productiveTurns >= 3, JSON.stringify(result));
  assert.ok(result.tools.edit >= 1, JSON.stringify(result));
  assert.ok(result.tools.shell >= 1, JSON.stringify(result));
  assert.ok(Number.isFinite(result.cost) && result.cost >= 0, JSON.stringify(result));
  const final = spawnSync(process.execPath, ['--test', 'src/value.test.mjs'], { cwd: directory, encoding: 'utf8' });
  assert.equal(final.status, 0, final.stdout + final.stderr);
  assert.match(final.stdout, /ℹ pass 1/);
  assert.equal(await readFile(join(directory, 'src/value.mjs'), 'utf8'), 'export const value = 42;\n');
  const aggregate = await client.session.get({ sessionID: result.sessionID }, request());
  assert.equal(result.cost, aggregate.cost);
  assert.ok(result.tokens > 0);
  const calls = host.requests.flatMap(request => request.messages.flatMap(message => message.tool_calls || []));
  assert.ok(calls.some(call => call.function?.name === 'edit'));
  assert.ok(calls.some(call => call.function?.name === 'shell'));
  console.log(JSON.stringify({
    host: '2.0.32', outcome: result.outcome, productiveTurns: result.productiveTurns,
    tools: result.tools, cost: result.cost, baseline: 'failed', finalTest: 'passed',
    realOpenCodeHost: true, loopbackProvider: true,
  }));
} finally {
  if (runResult?.exitCode) {
    console.error(JSON.stringify({ requests:host.requests.length, providerErrors:host.providerErrors.map(error=>error.message) }, null, 2));
  }
  await host.close();
}
