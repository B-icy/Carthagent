// Offline scripted provider: exercises the installed native OpenCode engine, not model efficacy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCandidate } from './runner.mjs';
import { initializeCampaign } from './campaign.mjs';
import { MODEL } from './gateway.mjs';

test('installed engine traverses discovery guide and full delivery with offline scripted responses', async t => {
  const root=mkdtempSync(join(tmpdir(),'ctg-startup-engine-'));t.after(()=>{if(process.env.CTG_KEEP_BENCHMARK_FAILURES!=='1')rmSync(root,{recursive:true,force:true});});
 const campaignPath=join(root,'campaign.json');initializeCampaign(campaignPath,{historicalCandidate:0,historicalSmoke:0,smokeLimit:1});
  const requirement='Writes the exact expected file';
 const plan={goal:'Implement fixture output',assumptions:[],artifacts:['.'],outputs:['output.txt'],steps:[{id:'build',title:'Write and verify',checks:['output']}],acceptance:[{requirement,checks:['output']}],checks:[{id:'output',kind:'test',argv:[process.execPath,'-e',"require('node:assert/strict').equal(require('node:fs').readFileSync('output.txt','utf8'),'ok')"],timeoutSeconds:5}]};
  const sequence=[...Array.from({length:8},()=>()=>({name:'read',args:{path:'TASK.md'}})),
    ()=>({name:'delivery_design',args:{action:'guide'}}),
    ()=>({name:'delivery_plan',args:plan}),
    ()=>({name:'shell',args:{command:"printf 'ok' > output.txt"}}),
   ()=>({name:'delivery_check',args:{id:'all'}}),
   ()=>({name:'delivery_progress',args:{step:'build',status:'done'}}),
   ()=>({name:'delivery_review',args:{action:'inspect'}}),
    p=>{const reviewed=JSON.parse(p.messages.filter(message=>message.role==='tool').at(-1).content);return {name:'delivery_review',args:{action:'record',captureId:reviewed.id,coverage:[{requirement,assertions:'Declared Node strict-equality check verified exact output content'}],probes:['Declared output check completed successfully'],findings:[],limitations:['Offline scripted fixture; not model efficacy']}};},
  ()=>({name:'delivery_finish',args:{status:'verified',review:'Reviewed fixture evidence',launch:'n/a',limitations:['Offline scripted provider']}}),
 ];
  let i=0,sawCheckpoint=false,advertised=[],requestTrace=[];
  const r=await runCandidate('smoke','harness',{smoke:true,key:'dummy',root,campaignPath,promptOverride:'Implement a fixture output.txt containing exactly ok. Use the delivery contract and finish verified.',fetchImpl:async(_url,options)=>{
    const payload=JSON.parse(options.body);advertised=payload.tools.map(tool=>tool.function?.name).filter(Boolean);requestTrace.push({turn:i,tools:advertised,messages:payload.messages.map(message=>({role:message.role,tool_calls:message.tool_calls?.map(call=>call.function?.name),tool_call_id:message.tool_call_id,content:typeof message.content==='string'?message.content.slice(-120):undefined}))});sawCheckpoint ||= JSON.stringify(payload.messages).includes('Pre-plan checkpoint: 8 discovery');
    const call=i<sequence.length?sequence[i++](payload):null;
    if(call&&call.name!=='read'&&call.name!=='shell'&&call.name!=='execute'){call.args={code:`return await tools.carthagent[${JSON.stringify(call.name)}](${JSON.stringify(call.args)})`};call.name='execute';}
    if(call){const name=advertised.find(candidate=>candidate===call.name||candidate.endsWith(`_${call.name}`)||candidate.endsWith(`.${call.name}`));if(!name)throw Error(`Scripted tool ${call.name} is not advertised: ${advertised.join(', ')}`);call.name=name;}
    return new Response('data: '+JSON.stringify({id:'offline',model:MODEL,choices:[{index:0,delta:{role:'assistant',content:call?'':'SMOKE_OK',...(call?{tool_calls:[{index:0,id:'call'+i,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}]}:{})},finish_reason:call?'tool_calls':'stop'}],usage:{cost:i<=8?0:.001,prompt_tokens:1,completion_tokens:1}})+'\n\ndata: [DONE]\n\n');
  }});
 const events=readFileSync(join(root,'smoke-harness/events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(r.smokePassed,true,JSON.stringify({result:r,providerCalls:i,sawCheckpoint,requestTrace,events}));assert.equal(i,sequence.length);assert.ok(sawCheckpoint);
    const failures=events.filter(e=>e.type==='session.tool.success'&&e.data?.metadata?.error);
    assert.deepEqual(failures,[],JSON.stringify(failures));
    const completedTools=events.flatMap(e=>e.type==='session.tool.success'?(e.data?.metadata?.toolCalls||[]).filter(call=>call.status==='completed'):[ ]);
   assert.ok(completedTools.some(call=>call.tool==='carthagent.delivery_finish'), 'native delivery_finish did not complete');
   assert.equal(readFileSync(join(root,'smoke-harness/workspace/output.txt'),'utf8'),'ok');
   const finish=events.findLast(e=>e.type==='session.tool.success'&&e.data?.metadata?.toolCalls?.some(call=>call.tool==='carthagent.delivery_finish'&&call.status==='completed'));
   assert.match(JSON.stringify(finish.data.content),/verified/);
});
