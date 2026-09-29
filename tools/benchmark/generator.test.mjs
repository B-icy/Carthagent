import test from 'node:test';
import assert from 'node:assert/strict';
import { generatorProfile, GLM_FLASH, DEEPSEEK } from './generator.mjs';
import { startGateway } from './gateway.mjs';

test('GLM profile is exact, copied and rejects aliases',()=>{
 assert.deepEqual(generatorProfile(GLM_FLASH),{model:GLM_FLASH,input:.15,output:.5,cacheRead:.03});
 const p=generatorProfile();p.input=100;assert.equal(generatorProfile().input,.3);
 assert.throws(()=>generatorProfile('~z-ai/glm-flash-latest'),/Unsupported/);
});
test('GLM gateway enforces configured request/response identity and prices; Jev independent',async()=>{
 let calls=0,wrong=false;
 const g=await startGateway({key:'dummy',generator:GLM_FLASH,allowJev:true,fetchImpl:async(url,options)=>{
  calls++;const p=JSON.parse(options.body);
  if(url.includes('decisions')) {assert.equal(p.model,'typesafe/jev-1.13');return Response.json({model:p.model,answers:Object.fromEntries(['srp','di','tests'].map(k=>[k,{type:'noul',noul:.1}])),usage:{cost:0}});}
  assert.equal(p.model,GLM_FLASH);assert.deepEqual(p.provider.max_price,{prompt:.15,completion:.5});assert.equal(p.reasoning.effort,'high');
  return new Response('data: '+JSON.stringify({model:wrong?DEEPSEEK:GLM_FLASH,usage:{cost:.001},choices:[]})+'\n\ndata: [DONE]\n\n');
 }});
 try{
  const request=model=>fetch(g.url+'/v1/chat/completions',{method:'POST',body:JSON.stringify({model,messages:[]})});
  assert.equal((await request(DEEPSEEK)).status,400);assert.equal(calls,0);
  const good=await request(GLM_FLASH);assert.equal(good.status,200);await good.text();
  const advice=await fetch(g.url+'/jev',{method:'POST',body:JSON.stringify({state:{}})});assert.equal(advice.status,200);await advice.text();
  wrong=true;assert.equal((await request(GLM_FLASH)).status,400);assert.equal(g.budget.spent,.002);assert.equal(g.budget.reserved,0);assert.equal(g.budget.stopped,'invalid-provider-response');
 }finally{await g.close();}
});
