import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergePlanPatch, revisePlan, completionIssues, updateStepStatus } from '../lib/delivery.mjs';
import { planningStatus, startImplementation } from '../lib/planning.mjs';
import { buildEngineArgs } from '../lib/engine.mjs';
test('standard contract allows work but never bypasses failed checks/final review', t => {
 const cwd=mkdtempSync(join(tmpdir(),'standard-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));writeFileSync(join(cwd,'source'),'a');
 const plan={goal:'Patch',artifacts:['.'],assumptions:[],steps:[{id:'build',title:'Build',checks:['unit']}],acceptance:[{requirement:'Works',checks:['unit']}],checks:[{id:'unit',kind:'test',argv:['node','test.mjs'],timeoutSeconds:10}]};
 const state={workflowMode:'standard',reviewRequired:true,runId:'r',revision:1,plan,status:'implementing',evidence:{},stepStatus:{}};
 assert.equal(planningStatus(state,'hash').locked,false);startImplementation(state,'hash');updateStepStatus(state,'build','done','hash');
 const issues=completionIssues(state,cwd,'hash');assert.deepEqual(issues.pendingChecks,['unit']);assert.equal(issues.review.length,1);
 const next=revisePlan(state,{checks:[{...plan.checks[0],timeoutSeconds:20}]},{cwd,hash:'hash',reason:'Correct deadline'});
 assert.equal(planningStatus(next,'hash').locked,false);assert.equal(next.stepStatus.step0,'done');assert.deepEqual(next.evidence,{});
 assert.equal(planningStatus({...state,plan:{...plan,verification:'none'}},'hash').locked,true);
});
test('nested partial patches preserve omitted design/workflow fields',()=>{
 const plan={design:{components:[{id:'a'}],ports:[],scenarios:[{id:'s'}],risks:[]},workflow:{nodes:[{id:'a'}],recovery:[]}};
 const next=mergePlanPatch(plan,{design:{risks:[{id:'risk'}]},workflow:{recovery:[{from:'a'}]}});
 assert.deepEqual(next.design.components,plan.design.components);assert.deepEqual(next.design.scenarios,plan.design.scenarios);assert.deepEqual(next.workflow.nodes,plan.workflow.nodes);
 assert.equal(plan.design.risks.length,0);
});
test('CLI defaults standard while strict is explicit',()=>{
 for(const workflow of [undefined,'strict']){const args=buildEngineArgs({workflow});assert.equal(args[args.indexOf('--delivery-workflow')+1],workflow||'standard');}
 assert.throws(()=>buildEngineArgs({workflow:'bad'}),/standard or strict/);
});
