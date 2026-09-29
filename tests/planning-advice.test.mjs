import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectAdvice, configuredAdvisor } from '../lib/planning-advice.mjs';
import { createOpenRouterJev } from '../lib/openrouter-jev.mjs';
const capture = { id:'c',runId:'r',revision:1,digest:'d',fingerprint:'f',plan:{goal:'test'} };
test('integrated advice is durable, bounded, identity-bound and never changes gates', async () => {
 const state={planning:{approval:{unchanged:true}},plan:{acceptance:['exact']}};let calls=0,saves=0;
 const options={enabled:true,persist:()=>saves++,createAdvisor:()=>({classify:async()=>{calls++;assert.ok(saves);return {model:'jev',probabilities:{srp:.2,di:.6,tests:.4}};}})};
 assert.equal((await inspectAdvice(state,capture)).mode,'disabled');assert.equal(calls,0);
 const result=await inspectAdvice(state,capture,options);assert.deepEqual(result.findings.map(f=>f.category),['di']);assert.equal(result.authority,'none');
 assert.equal((await inspectAdvice(state,{...capture,id:'c2'},options)).reused,true);assert.equal(calls,1);
 await inspectAdvice(state,{...capture,fingerprint:'changed'},options);await inspectAdvice(state,{...capture,revision:2},options);
 assert.equal((await inspectAdvice(state,{...capture,revision:3},options)).mode,'limit');assert.equal(calls,3);assert.deepEqual(state.planning,{approval:{unchanged:true}});assert.deepEqual(state.plan.acceptance,['exact']);
 const failed={};await inspectAdvice(failed,capture,{...options,createAdvisor:()=>{throw Error('secret');}});assert.equal(failed.advisorAttempts[0].mode,'unavailable');assert.ok(!JSON.stringify(failed).includes('secret'));
 assert.equal(configuredAdvisor({enabled:false,env:{}}),undefined);assert.throws(()=>configuredAdvisor({enabled:true,env:{}}),/key/);
});
test('OpenRouter adapter bounds, credentials, model and Noul validation', async () => {
 const payload={model:'typesafe/jev-1.13-test',answers:Object.fromEntries(['srp','di','tests'].map(k=>[k,{type:'noul',noul:.2}])),usage:{cost:.001,prompt_tokens:10}};
 let options;
 const adapter=createOpenRouterJev({broker:'http://127.0.0.1:1234/jev',apiKey:'DO_NOT_SEND',fetchImpl:async(_url,o)=>{options=o;return Response.json(payload);}});
 assert.equal((await adapter.classify({goal:'hi'})).costUsd,.001);assert.equal(options.headers.authorization,undefined);assert.equal(options.redirect,'error');
 for(const broker of ['https://example.com/jev','http://localhost:1/jev','http://127.0.0.1:1/jev?x=1'])assert.throws(()=>createOpenRouterJev({broker}),/broker/);
 await assert.rejects(adapter.classify({goal:'x'.repeat(65000)}),/64KB/);
 await assert.rejects(createOpenRouterJev({apiKey:'x',timeoutMs:5,fetchImpl:()=>new Promise(()=>{})}).classify({}),/timeout/);
 await assert.rejects(createOpenRouterJev({apiKey:'x',fetchImpl:async()=>Response.json({...payload,model:'wrong'})}).classify({}),/model/);
 await assert.rejects(createOpenRouterJev({apiKey:'x',fetchImpl:async()=>new Response('x'.repeat(70000))}).classify({}),/large/);
});
