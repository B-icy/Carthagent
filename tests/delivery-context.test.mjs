import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deliveryRecovery, archivalGroups, replaceArchivedGroups, contextMetrics, jsonBytes, designReceipt } from '../lib/delivery-context.mjs';
import { archiveContext } from '../lib/context-archive.mjs';
import { approveFixture } from './helpers/tested-design.mjs';
import { planningStatus } from '../lib/planning.mjs';
import { fingerprint, revisePlan } from '../lib/delivery.mjs';
import { recoveryMessages } from '../lib/delivery-context.mjs';
import { DELIVERY_INVARIANTS, deliveryPhaseGuidance } from '../lib/delivery-guidance.mjs';
const plan = { goal:'Exact obligations',assumptions:[],artifacts:['.'],outputs:['release.txt'],steps:['Implement'],acceptance:[{requirement:'Keep every cent exactly',checks:['required_money']}],checks:[{id:'required_money',kind:'test',argv:['node','verify.mjs'],timeoutSeconds:5}] };
function turn(id,name='delivery_status',isError=false){return [{role:'assistant',stopReason:'toolUse',timestamp:1,content:[{type:'thinking',thinking:'x'.repeat(3000),thinkingSignature:'unchanged'},{type:'toolCall',id,name,arguments:{plan:'x'.repeat(5000)}}]},{role:'toolResult',toolCallId:id,toolName:name,isError,content:[{type:'text',text:'x'.repeat(5000)}]}];}
test('outbound archives preserve users/failures/pairing and leave stored history untouched',t=>{
 const root=mkdtempSync(join(tmpdir(),'context-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const messages=[{role:'user',content:'Keep this exact request'},...turn('1'),...turn('2','delivery_check',true),...turn('3','write'),...turn('4'),...turn('5'),...turn('6')];const before=structuredClone(messages);
 const groups=archivalGroups(messages,{allow:true});assert.deepEqual(groups.map(g=>g.start),[1,7]);
 for(const group of groups)group.archive=archiveContext(root,join(root,'.harness'),group.messages);
 const projected=replaceArchivedGroups(messages,groups);assert.deepEqual(messages,before);assert.equal(projected[0].content,messages[0].content);assert.ok(projected.some(m=>m.isError));assert.ok(projected.some(m=>m.role==='assistant'&&m.content.some(c=>c.name==='write')));assert.ok(jsonBytes(projected)<jsonBytes(messages)*.75);
 for(const group of groups)assert.deepEqual(JSON.parse(readFileSync(group.archive.path)),group.messages);
 writeFileSync(groups[0].archive.path,'corrupted');assert.throws(()=>archiveContext(root,join(root,'.harness'),groups[0].messages),/mismatch/);
 const linked=join(root,'linked');symlinkSync(join(root,'.harness'),linked,'dir');assert.throws(()=>archiveContext(root,linked,{test:true}),/symlink/i);
 assert.deepEqual(archivalGroups(messages,{allow:false}),[]);
 const orphan=turn('7');orphan[1].toolCallId='wrong';assert.deepEqual(archivalGroups(orphan,{allow:true,keepRecent:0}),[]);
 const blocked=turn('8');blocked[1].content=[{type:'text',text:JSON.stringify({findings:[{severity:'blocking',description:'must remain'}]})}];assert.deepEqual(archivalGroups(blocked,{allow:true,keepRecent:0}),[]);
});
test('recovery preserves exact obligations, failed evidence/blockers; cannot revive stale approval',t=>{
 const cwd=mkdtempSync(join(tmpdir(),'context-state-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));writeFileSync(join(cwd,'source'),'a');
 const state={runId:'r',revision:1,plan:structuredClone(plan),evidence:{required_money:{passed:false,code:9,executedRevision:1,outputTail:'lost cent'}},status:'implementing',stepStatus:{}};approveFixture(state,cwd);state.planning.openFindings=[{id:'blocker',revision:1,severity:'blocking',description:'Do not forget'}];
 const before=structuredClone(state),summary=deliveryRecovery(state);assert.deepEqual(summary.acceptance,plan.acceptance);assert.deepEqual(summary.checks,plan.checks);assert.deepEqual(summary.outputs,plan.outputs);assert.equal(summary.planning.openFindings[0].id,'blocker');assert.equal(summary.evidence.required_money.passed,false);assert.deepEqual(state,before);
 writeFileSync(join(cwd,'source'),'b');assert.equal(planningStatus(state,fingerprint(cwd,['.'])).locked,true);
 const revised=revisePlan(state,{assumptions:['new fact']},{cwd,reason:'Changed assumption',hash:fingerprint(cwd,['.'])});deliveryRecovery(revised);assert.equal(planningStatus(revised,fingerprint(cwd,['.'])).locked,true);assert.equal(revised.planning.openFindings[0].id,'blocker');
});
test('compact review receipt retains findings/limitations and metrics never copy secret payloads',()=>{
 const receipt={runId:'r',walkthroughs:[{trace:'x'.repeat(10000)}],challenges:['long'],findings:[{description:'failure'}],limitations:['model authored']};const compact=designReceipt('review',receipt);assert.deepEqual(compact.findings,receipt.findings);assert.equal(compact.walkthroughCount,1);assert.ok(jsonBytes(compact)<jsonBytes(receipt)/10);
 const payload={tools:[{function:{name:'read'}}],messages:[{role:'system',content:'SECRET'},{role:'assistant',reasoning_details:[{text:'秘密'}],content:'hi'},{role:'tool',content:'SECRET'}]};const m=contextMetrics(payload);assert.equal(Object.values(m.categories).reduce((a,b)=>a+b,0),m.totalBytes);assert.ok(m.categories.reasoning>0);assert.ok(m.categories.envelope>=0);assert.ok(!JSON.stringify(m).includes('SECRET'));
});
test('checkpoint is not repeated; compaction/revision restore exact obligations and current failures', () => {
 const state={runId:'r',revision:1,plan:structuredClone(plan),status:'implementing',evidence:{required_money:{passed:false,code:9}},stepStatus:{}};
 const summary=deliveryRecovery(state);
 const first=recoveryMessages([],summary);
 assert.equal(first.filter(m=>m.customType==='delivery-checkpoint').length,1);
 assert.deepEqual(JSON.parse(first[0].content).acceptance,plan.acceptance);
 const second=recoveryMessages(first,summary);
 assert.equal(second.length,2); assert.equal(second[0],first[0]);
 assert.equal(JSON.parse(second[1].content).evidence.required_money.passed,false);
 const compacted=recoveryMessages([{role:'user',content:'summary without checkpoint'}],summary);
 assert.deepEqual(JSON.parse(compacted[1].content).checks,plan.checks);
 const changed=recoveryMessages(second,{...summary,revision:2,acceptance:[...summary.acceptance,{requirement:'New',checks:['required_money']}]});
 assert.equal(changed.filter(m=>m.customType==='delivery-checkpoint').length,1);
 assert.equal(JSON.parse(changed[0].content).acceptance.length,2);
 assert.ok(DELIVERY_INVARIANTS.length<2000); assert.match(deliveryPhaseGuidance(null),/code_nav/);
 assert.match(deliveryPhaseGuidance(state),/Design:/);
 assert.match(deliveryPhaseGuidance({...state,planning:{approval:{}}}),/snapshot|delivery_review/);
});
test('outbound-only checkpoints retain their position until their history anchor disappears', () => {
 const summary=deliveryRecovery({runId:'r',revision:1,plan,status:'implementing',evidence:{}});
 const cache={}; const anchor={role:'toolResult',toolCallId:'plan',content:'created'};
 const first=recoveryMessages([anchor],summary,cache);
 const checkpoint=first[1];
 const second=recoveryMessages([anchor,{role:'assistant',content:'next'}],summary,cache);
 assert.equal(second[1],checkpoint);
 const third=recoveryMessages([{role:'user',content:'compacted'}],summary,cache);
 assert.notEqual(third[1],checkpoint); assert.deepEqual(JSON.parse(third[1].content).acceptance,plan.acceptance);
});
