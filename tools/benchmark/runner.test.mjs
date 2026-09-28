import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,mkdirSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
import {initializeCampaign,campaignAccount}from'./campaign.mjs';
import {runCandidate,terminalStatus}from'./runner.mjs';
import {MODEL}from'./gateway.mjs';
import {fixtureDesign}from'../../tests/helpers/tested-design.mjs';
import {createFreeze,verifyFreeze,frozenFiles}from'./freeze.mjs';
import {sha}from'./runtime.mjs';
import {writeFileSync}from'node:fs';
const mk=()=>mkdtempSync(join(tmpdir(),'benchmark-runner-'));
function response(content='',tool){return new Response('data: '+JSON.stringify({id:'fixture',model:MODEL,choices:[{index:0,delta:{role:'assistant',content,...(tool?{tool_calls:[{index:0,id:'call'+Math.random(),type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.args)}}]}:{})},finish_reason:tool?'tool_calls':'stop'}],usage:{cost:0,prompt_tokens:1,completion_tokens:1}})+'\n\ndata: [DONE]\n\n');}
test('campaign survives reopen, preserves crash holds, rejects reset and overspend',()=>{const p=join(mk(),'campaign.json');initializeCampaign(p,{historicalCandidate:0,historicalSmoke:0,candidateLimit:.3});const a=campaignAccount(p,'candidate','a'),b=campaignAccount(p,'candidate','b');const id=a.reserve(.15);b.reserve(.15);assert.throws(()=>a.reserve(.01));a.reconcile(id,.01);assert.equal(JSON.parse(readFileSync(p)).spent.candidate,.01);assert.throws(()=>initializeCampaign(p));mkdirSync(p+'.lock');assert.throws(()=>b.reserve(.01),/busy/);});
test('exit zero is not model success and freeze checks hashes',()=>{assert.equal(terminalStatus([{type:'message_end',message:{role:'assistant',stopReason:'error'}}],{code:0},null,{}).status,'model-error');const root=mk(),receipt=join(root,'ready.json');const live=join(root,'live.json');writeFileSync(live,'{"passed":true}');writeFileSync(receipt,JSON.stringify({passed:true,files:Object.fromEntries(frozenFiles().map(f=>[f,sha(readFileSync(f))])),live:{path:live,sha256:sha(readFileSync(live))}}));createFreeze(root,receipt);verifyFreeze(root);writeFileSync(receipt,'{"passed":false}');assert.throws(()=>verifyFreeze(root),/receipt changed/);});
test('real delivery inspect reaches advisor through installed engine and cannot authorize preapproval mutation',async()=>{
 const root=mk(),campaignPath=join(root,'campaign.json');initializeCampaign(campaignPath,{historicalCandidate:0,historicalSmoke:0});
 const plan={goal:'Fixture only',assumptions:[],artifacts:['.'],steps:['Verify'],acceptance:[{requirement:'Fixture runs',checks:['test']}],checks:[{id:'test',kind:'test',argv:[process.execPath,'-e','process.exit(0)'],timeoutSeconds:5}]};plan.design=fixtureDesign(plan);
 const sequence=[{name:'write',args:{path:'forbidden.txt',content:'bad'}},{name:'delivery_plan',args:plan},{name:'delivery_design',args:{action:'validate'}},{name:'delivery_design',args:{action:'inspect'}}];let i=0,jev=0;
 const r=await runCandidate('smoke','jev',{smoke:true,key:'fixture',root,campaignPath,fetchImpl:async(url)=>{if(url.includes('decisions')){jev++;return Response.json({model:'typesafe/jev-1.13',usage:{cost:0},answers:{srp:{type:'noul',noul:.1},di:{type:'noul',noul:.1},tests:{type:'noul',noul:.1}}});}return i<sequence.length?response('',sequence[i++]):response('SMOKE_OK');}});
 assert.equal(r.smokePassed,true);assert.equal(jev,1);assert.throws(()=>readFileSync(join(root,'smoke-jev/workspace/forbidden.txt')));assert.match(readFileSync(join(root,'smoke-jev/advisor.jsonl'),'utf8'),/"mode":"advisory"/);
});
test('installed pi actually executes offline read/ls/find/grep and blocks over-budget mutation',async()=>{
 for(const arm of ['plain','harness','jev']){
  const root=mk(),campaignPath=join(root,'campaign.json');initializeCampaign(campaignPath,{historicalCandidate:0,historicalSmoke:0});
  let i=0;const tools=[{name:'read',args:{path:'TASK.md'}},{name:'ls',args:{path:'.'}},{name:'find',args:{pattern:'TASK.md',path:'.'}},{name:'grep',args:{pattern:'Infrastructure',path:'TASK.md'}}];
  const r=await runCandidate('smoke',arm,{smoke:true,key:'fixture',root,campaignPath,fetchImpl:async()=>i<tools.length?response('',tools[i++]):response('SMOKE_OK')});
  assert.equal(r.smokePassed,true);assert.equal(r.toolStarts,4);const events=readFileSync(join(root,`smoke-${arm}`,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.filter(e=>e.type==='tool_execution_end'&&e.isError).length,0,JSON.stringify(events.filter(e=>e.type==='tool_execution_end')));
 }
 const root=mk(),campaignPath=join(root,'campaign.json');initializeCampaign(campaignPath,{historicalCandidate:0,historicalSmoke:0});let i=0;
 const r=await runCandidate('smoke','plain',{smoke:true,key:'fixture',root,campaignPath,toolLimit:1,fetchImpl:async()=>response('',i++===0?{name:'ls',args:{path:'.'}}:{name:'write',args:{path:'forbidden.txt',content:'bad'}})});
 assert.equal(r.toolBlockedByBudget,1);assert.equal(r.toolAdmittedByBudget,1);assert.throws(()=>readFileSync(join(root,'smoke-plain/workspace/forbidden.txt')));
});
