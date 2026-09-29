import test from 'node:test';
import assert from 'node:assert/strict';
import { planningGuide, planningNext } from '../lib/planning-guide.mjs';
import { validateDesign } from '../lib/planning.mjs';
import { validatePlan } from '../lib/delivery.mjs';
import { newDiscovery, restoreDiscovery, discoveryEvent, discoveryCheckpoint } from '../lib/planning-discovery.mjs';
import { createJevAdvisor } from '../lib/jev-advisor.mjs';
import { createOpenRouterJev } from '../lib/openrouter-jev.mjs';

test('on-demand guide passes structural validators; reference errors remain blocking', () => {
 const guide=planningGuide();assert.equal(guide.authority,'none');assert.ok(JSON.stringify(guide).length<6500);
 const plan=validatePlan(guide.example,process.cwd());assert.deepEqual(validateDesign(plan),[]);
 const bad=structuredClone(plan);bad.design.scenarios[0].path=['unknown'];bad.design.scenarios[0].checks=['missing'];bad.design.scenarios[0].requirement='rewritten';
 const findings=validateDesign(bad);assert.ok(findings.some(f=>f.message.includes('unknown')&&f.message.includes('headers')));assert.ok(findings.some(f=>f.message.includes('missing')&&f.message.includes('headers')));assert.ok(findings.some(f=>f.message.includes('rewritten')));assert.ok(findings.every(f=>f.severity==='blocking'));
 assert.deepEqual(planningNext({plan}, {findings}).references.requirements,plan.acceptance.map(a=>a.requirement));
 const malformed={...plan,design:{components:'wrong',ports:{},scenarios:[],risks:[]}};
 assert.deepEqual(planningNext({plan:malformed},{findings:validateDesign(malformed)}).references.components,[]);
});
test('checkpoint thresholds/restoration are bounded advice, never permission',()=>{
 let state=newDiscovery(true);for(let i=0;i<7;i++)state=discoveryEvent(state,'read');assert.equal(discoveryCheckpoint(state),undefined);
 state=discoveryEvent(state,'read');assert.match(discoveryCheckpoint(state),/first concrete plan/);
 for(let i=0;i<8;i++)state=discoveryEvent(state,'read');assert.match(discoveryCheckpoint(state),/exact unresolved question/);
 let blocked=newDiscovery(true);blocked=discoveryEvent(discoveryEvent(blocked,'blocked'),'blocked');assert.match(discoveryCheckpoint(blocked),/2 blocked/);
 assert.equal(discoveryCheckpoint(newDiscovery()),undefined);assert.deepEqual(discoveryEvent(newDiscovery(),'read'),newDiscovery());
 assert.deepEqual(restoreDiscovery({version:1,active:true,reads:Infinity,blocked:-1,approval:'bogus'}),newDiscovery(true));
 assert.equal(restoreDiscovery({version:1,active:true,reads:1000000}).reads,100000);
});
test('both Jev adapters disclose check definitions, outputs and assumptions without mutation',async()=>{
 const plan={...planningGuide().example,outputs:['README.md']};const before=structuredClone(plan);
 for(const [factory,model] of [[createJevAdvisor,'jev-1.13.0'],[createOpenRouterJev,'typesafe/jev-1.13']]){
  let body;
  const advisor=factory({apiKey:'dummy',fetchImpl:async(_url,options)=>{body=JSON.parse(options.body);return Response.json({model,answers:Object.fromEntries(['srp','di','tests'].map(k=>[k,{type:'noul',noul:.1}]))});}});
  await advisor.classify(plan);
  for(const key of ['checks','outputs','assumptions','acceptance'])assert.deepEqual(body.state[key],plan[key]);
  assert.match(body.questions.tests.instructions,/commands are declarations/);assert.deepEqual(plan,before);
  await assert.rejects(advisor.classify({...plan,checks:[{argv:['x'.repeat(65000)]}]}),/64KB/);
 }
});
