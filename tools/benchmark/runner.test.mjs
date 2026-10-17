import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeCampaign } from './campaign.mjs';
import { runCandidate, terminalStatus } from './runner.mjs';
import { createFreeze, verifyFreeze, frozenFiles } from './freeze.mjs';
import { sha } from './runtime.mjs';
import { nativeFixture, streamText } from '../native-fixture.mjs';
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

test('benchmark refuses arbitrary service endpoints before creating a run', async () => {
  const root=mk(), campaignPath=join(root,'campaign.json');
  initializeCampaign(campaignPath,{historicalCandidate:0,historicalSmoke:0});
  const before=process.env.CTG_OPENCODE_URL;
  process.env.CTG_OPENCODE_URL='http://127.0.0.1:1';
  try {
    await assert.rejects(runCandidate('smoke','plain',{smoke:true,root,campaignPath,nativeRunner:Object.assign(async()=>{throw Error('must not execute');},{fixture:true})}),/ownership and authentication/);
    assert.equal(existsSync(join(root,'smoke-plain')),false,'rejected endpoint must be rejected before allocating a run');
  } finally {
    if(before===undefined) delete process.env.CTG_OPENCODE_URL;
    else process.env.CTG_OPENCODE_URL=before;
  }
});

test('native benchmark plugin loads in OpenCode 2 with both session and tool hooks', async () => {
  const root=mk();
  let probeSent=false;
  let markerFile;
  const host=await nativeFixture({
    plugin:join(process.cwd(),'lib/opencode/evaluation-budget-plugin'),
    // Keep this admission probe independent of the delivery plugin's plan gate.
    plugins:[join(process.cwd(),'tools/benchmark/native-plugin')],
    env:{BENCH_TOOL_LIMIT:'1',BENCH_RETRY_LIMIT:'0',BENCH_GUARD_LOG:join(root,'guard.jsonl'),BENCH_ADVISOR_LOG:join(root,'advisor.jsonl'),BENCH_GATEWAY:'http://127.0.0.1:1',CTG_EVALUATION_MAX_TURNS:'4',CTG_EVALUATION_MAX_COST:'1'},
    respond(body,res) {
      if(!probeSent && JSON.stringify(body.messages).includes('CTG_PARALLEL_GUARD_PROBE')) {
        probeSent=true;
        const read=body.tools.find(tool=>tool.function?.name==='read');
        assert.ok(read,'native host must advertise read for the concurrent tool admission probe');
        const calls=Array.from({length:8},(_,index)=>({index,id:`parallel-${index}`,type:'function',function:{name:'read',arguments:JSON.stringify({path:markerFile})}}));
        const chunk=(delta,finish_reason=null)=>`data: ${JSON.stringify({id:'parallel-guard-probe',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason}]})}\n\n`;
        res.writeHead(200,{'content-type':'text/event-stream'});
        res.end(`${chunk({role:'assistant',tool_calls:calls})}${chunk({},'tool_calls')}data: [DONE]\n\n`);
        return;
      }
      streamText(res);
    },
  });
  try {
    await host.active('ctg.benchmark');
    const inventory=await host.client.plugin.list({location:host.location},host.request());
    assert.ok(inventory.data.some(plugin=>plugin.id==='ctg.evaluation-budget'&&plugin.state.status==='active'),JSON.stringify(inventory.data));
    const response=await host.client.session.create({location:host.location,model:host.model,title:'hook initialization probe'},host.request());
    assert.ok(response.id);
    const session=await host.client.session.create({location:host.location,model:host.model,title:'parallel admission probe',metadata:{'ctg.evaluation.budget':{maxTurns:4,maxCost:1}}},host.request());
    const marker='CTG_BENCHMARK_ADMITTED_READ_RESULT';
    markerFile=join(host.cwd,'read-admission-proof.txt');
    writeFileSync(markerFile,marker);
    await host.client.session.prompt({sessionID:session.id,text:'CTG_PARALLEL_GUARD_PROBE'},host.request());
    await host.client.session.wait({sessionID:session.id},host.request());
    assert.ok(existsSync(join(root,'guard.jsonl')),`${JSON.stringify(host.providerErrors.map(error=>error.stack??String(error)))}\n${JSON.stringify(await host.client.message.list({sessionID:session.id},host.request()))}`);
    assert.deepEqual(host.providerErrors,[],'offline provider requests must complete without fixture errors');
    const rows=readFileSync(join(root,'guard.jsonl'),'utf8').trim().split('\n').map(JSON.parse).filter(row=>row.sessionID===session.id);
    assert.equal(rows.length,8,JSON.stringify(rows));
    assert.equal(rows.filter(row=>!row.blocked).length,1,JSON.stringify(rows));
    assert.equal(rows.filter(row=>row.blocked).length,7,JSON.stringify(rows));
    const admittedCallID=rows.find(row=>!row.blocked).callID;
    const toolResults=host.requests.flatMap(request=>request.messages).filter(message=>message.role==='tool');
    const admittedResult=toolResults.find(message=>message.tool_call_id===admittedCallID);
    assert.ok(admittedResult?.content?.includes(marker), 'the admitted call must return the unique marker file content');
    for(const row of rows.filter(row=>row.blocked)) {
      const rejectedResult=toolResults.find(message=>message.tool_call_id===row.callID);
      assert.ok(rejectedResult?.content?.toLowerCase().includes('budget'), `blocked call ${row.callID} must return its budget rejection`);
    }
    const ledger=await host.client.session.context({sessionID:session.id},host.request());
    assert.ok(ledger.at(-1)?.outcome,JSON.stringify(ledger.at(-1)));
  } finally { await host.close(); }
});
