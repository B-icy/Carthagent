import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeCampaign } from './campaign.mjs';
import { runCandidate, terminalStatus } from './runner.mjs';
import { createFreeze, verifyFreeze, frozenFiles } from './freeze.mjs';
import { sha } from './runtime.mjs';
import { nativeFixture } from '../native-fixture.mjs';
const mk = () => mkdtempSync(join(tmpdir(), 'benchmark-runner-'));

test('native terminal classification does not mistake process success for model success', () => {
  assert.equal(terminalStatus([{ type:'session.step.ended', data:{ finish:'error' } }], {code:0}, null, {},'failed').status, 'non-successful-session-outcome');
  assert.equal(terminalStatus([], {code:0}, null, {},'succeeded').status, 'missing-terminal-message');
});
test('native runtime freeze includes source and package lock but no Pi install or user auth', () => {
  assert.ok(frozenFiles().some(path => path.endsWith('/lib/opencode/evaluation.mjs')));
  assert.ok(frozenFiles().some(path => path.endsWith('/package-lock.json')));
  assert.ok(frozenFiles().every(path => !path.includes('/.pi/') && !path.includes('/node_modules/')));
  const root = mk(), receipt = join(root,'ready.json'), live = join(root,'live.json');
  writeFileSync(live,'{"passed":true}');
  writeFileSync(receipt,JSON.stringify({passed:true,files:Object.fromEntries(frozenFiles().map(path=>[path,sha(readFileSync(path))])),live:{path:live,sha256:sha(readFileSync(live))}}));
  createFreeze(root,receipt); assert.equal(verifyFreeze(root).runtime,'opencode-2');
});
test('offline fixture runner logs runtime and uses no provider credentials', async () => {
  const root=mk(), campaignPath=join(root,'campaign.json');
  initializeCampaign(campaignPath,{historicalCandidate:0,historicalSmoke:0});
  const fake = async options => {
    assert.equal(options.directory,join(root,'smoke-plain','workspace'));
    options.onEvent({type:'session.step.ended',data:{sessionID:'fixture',assistantMessageID:'m1',finish:'stop'}});
    return {exitCode:0,turns:1,productiveTurns:1,tools:{read:1},cost:0,outcome:'succeeded',lastStop:'stop',opencodeVersion:'2.0.32'};
  };
  fake.fixture = true;
  const result=await runCandidate('smoke','plain',{smoke:true,root,campaignPath,nativeRunner:fake});
  assert.equal(result.runtime,'opencode-2');
  assert.equal(result.status,'completed');
  assert.equal(result.outcome,'succeeded');
  assert.equal(JSON.parse(readFileSync(join(root,'smoke-plain','invocation.json'))).runtime,'opencode-2');
  assert.equal(existsSync(join(root,'smoke-plain','config','runtime.json')),true);
});

test('native benchmark plugin loads in OpenCode 2 with both session and tool hooks', async () => {
  const root=mk();
  const host=await nativeFixture({
    plugin:join(process.cwd(),'tools/benchmark/native-plugin'),
    env:{BENCH_TOOL_LIMIT:'4',BENCH_TURN_LIMIT:'4',BENCH_TURN_LOG:join(root,'turns.jsonl'),BENCH_GUARD_LOG:join(root,'guard.jsonl'),BENCH_ADVISOR_LOG:join(root,'advisor.jsonl'),BENCH_GATEWAY:'http://127.0.0.1:1',CTG_EVALUATION_MAX_TURNS:'4',CTG_EVALUATION_MAX_COST:'1'},
  });
  try {
    await host.active('ctg.benchmark');
    const response=await host.client.session.create({location:host.location,model:host.model,title:'hook initialization probe'},host.request());
    assert.ok(response.id);
  } finally { await host.close(); }
});
