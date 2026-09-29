// Offline scripted provider: exercises actual installed pi plumbing, not model efficacy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCandidate } from './runner.mjs';
import { initializeCampaign } from './campaign.mjs';
import { MODEL } from './gateway.mjs';
import { fixtureDesign, fixtureReview } from '../../tests/helpers/tested-design.mjs';

test('installed engine traverses discovery guide and full delivery with offline scripted responses', async t => {
 const root=mkdtempSync(join(tmpdir(),'ctg-startup-engine-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const campaignPath=join(root,'campaign.json');initializeCampaign(campaignPath,{historicalCandidate:0,historicalSmoke:0});
 const requirement='Writes the exact expected file';
 const plan={goal:'Implement fixture output',assumptions:[],artifacts:['.'],outputs:['output.txt'],steps:[{id:'build',title:'Write and verify',checks:['output']}],acceptance:[{requirement,checks:['output']}],checks:[{id:'output',kind:'test',argv:[process.execPath,'-e',"require('node:assert/strict').equal(require('node:fs').readFileSync('output.txt','utf8'),'ok')"],timeoutSeconds:5}]};plan.design=fixtureDesign(plan);
 const lastTool=payload=>{
  const raw=payload.messages.filter(m=>m.role==='tool').at(-1)?.content;
  return JSON.parse(typeof raw==='string'?raw:raw.map(b=>b.text||'').join('\n'));
 };
 const sequence=[...Array.from({length:8},()=>()=>({name:'read',args:{path:'TASK.md'}})),
 ()=>({name:'delivery_design',args:{action:'guide'}}),
 ()=>({name:'delivery_plan',args:plan}),
 ()=>({name:'delivery_design',args:{action:'validate'}}),
 ()=>({name:'delivery_design',args:{action:'inspect'}}),
 p=>({name:'delivery_design',args:{action:'review',review:{...fixtureReview(plan),captureId:lastTool(p).result.id}}}),
 ()=>({name:'delivery_design',args:{action:'approve'}}),
 ()=>({name:'write',args:{path:'output.txt',content:'ok'}}),
 ()=>({name:'delivery_check',args:{id:'all'}}),
 ()=>({name:'delivery_progress',args:{step:'build',status:'done'}}),
 ()=>({name:'delivery_review',args:{action:'inspect'}}),
 p=>({name:'delivery_review',args:{action:'record',captureId:lastTool(p).id,coverage:[{requirement,assertions:'Exact file content asserted by Node strict equality'}],probes:['Declared output check exited zero'],findings:[],limitations:['Scripted fixture; no semantic review claim']}}),
 ()=>({name:'delivery_finish',args:{status:'verified',review:'Reviewed fixture evidence',launch:'n/a',limitations:['Offline scripted provider']}}),
 ];
 let i=0,sawCheckpoint=false;
 const r=await runCandidate('smoke','harness',{smoke:true,key:'dummy',root,campaignPath,promptOverride:'Implement a fixture output.txt containing exactly ok. Use the delivery contract and finish verified.',fetchImpl:async(_url,options)=>{
  const payload=JSON.parse(options.body);sawCheckpoint ||= JSON.stringify(payload.messages).includes('Pre-plan checkpoint: 8 discovery');
  const call=i<sequence.length?sequence[i++](payload):null;
  return new Response('data: '+JSON.stringify({id:'offline',model:MODEL,choices:[{index:0,delta:{role:'assistant',content:call?'':'SMOKE_OK',...(call?{tool_calls:[{index:0,id:'call'+i,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}]}:{})},finish_reason:call?'tool_calls':'stop'}],usage:{cost:0,prompt_tokens:1,completion_tokens:1}})+'\n\ndata: [DONE]\n\n');
 }});
 assert.equal(r.smokePassed,true);assert.equal(i,sequence.length);assert.ok(sawCheckpoint);
 const events=readFileSync(join(root,'smoke-harness/events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.deepEqual(events.filter(e=>e.type==='tool_execution_end'&&e.isError),[]);
 assert.equal(readFileSync(join(root,'smoke-harness/workspace/output.txt'),'utf8'),'ok');
 const finish=events.findLast(e=>e.type==='tool_execution_end'&&e.toolName==='delivery_finish');
 assert.match(JSON.stringify(finish.result),/verified/);
});
