import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createBudget,reserve,reconcile,startGateway,MODEL } from './gateway.mjs';
test('reservation and unknown billing fail closed',()=>{
  const b=createBudget(.15); const r=reserve(b,'generation'); assert.throws(()=>reserve(b,'generation')); assert.equal(reconcile(b,r,{cost:.01}),true); assert.equal(b.spent,.01);
  const c=createBudget(); const cr=reserve(c,'generation'); assert.equal(reconcile(c,cr,{}),false); assert.throws(()=>reserve(c,'generation')); assert.equal(c.reserved,.15);
  const d=createBudget(); for(let i=0;i<3;i++)reconcile(d,reserve(d,'jev'),{cost:.001});assert.throws(()=>reserve(d,'jev'));
});
test('real HTTP proxy allowlist, outbound bounds, billing and advisory',async()=>{
  let calls=0;
  const g=await startGateway({key:'test-secret',allowJev:true,fetchImpl:async(url,options)=>{
    calls++; const p=JSON.parse(options.body); assert.equal(options.headers.Authorization,'Bearer test-secret');
    if(url.includes('decisions'))return Response.json({model:'typesafe/jev-1.13-test',answers:{srp:{type:'noul',noul:.8},di:{type:'noul',noul:.2},tests:{type:'noul',noul:.4}},usage:{cost:.001}});
    assert.equal(p.max_tokens,16384);assert.deepEqual(p.reasoning,{effort:'high'});assert.equal(p.plugins,undefined);assert.equal(p.provider.max_price.prompt,.3);
    return new Response('data: '+JSON.stringify({model:MODEL,choices:[],usage:{cost:.002,prompt_tokens:12,completion_tokens:2}})+'\n\ndata: [DONE]\n\n');
  }});
  try {
    const request=p=>fetch(g.url+'/v1/chat/completions',{method:'POST',body:JSON.stringify(p)});
    assert.equal((await request({model:'other',messages:[]})).status,400);assert.equal(calls,0);
    const good=await request({model:MODEL,messages:[{role:'user',content:'hello'}],plugins:['bad']});assert.equal(good.status,200);await good.text();assert.equal(g.budget.spent,.002);
    const jev=await fetch(g.url+'/jev',{method:'POST',body:JSON.stringify({state:{goal:'x'}})});assert.equal(jev.status,200);await jev.text();assert.equal(g.budget.jev,1);
    assert.ok(!JSON.stringify(g.receipts).includes('test-secret'));
    assert.equal((await request({model:MODEL,messages:[{content:'x'.repeat(403000)}]})).status,400);
  } finally {await g.close();}
});
test('locks before body read, handles split Unicode and stops wrong-model responses after billing',async()=>{
 let calls=0;const g=await startGateway({key:'x',fetchImpl:async(_url,o)=>{calls++;assert.equal(JSON.parse(o.body).messages[0].content,'héllo 🌍');return new Response('data: '+JSON.stringify({model:'wrong',usage:{cost:.001}})+'\n\ndata: [DONE]\n\n');}});
 try{
  const pending=httpRequest(g.url+'/v1/chat/completions',{method:'POST'});const done=new Promise((r,j)=>{pending.on('response',res=>{res.resume();res.on('end',()=>r(res.statusCode));});pending.on('error',j);});pending.write('{');await new Promise(r=>setTimeout(r,30));
  const second=await fetch(g.url+'/v1/chat/completions',{method:'POST',body:JSON.stringify({model:MODEL,messages:[]})});assert.equal(second.status,400);await second.text();assert.equal(calls,0);
  const payload=Buffer.from(JSON.stringify({model:MODEL,messages:[{role:'user',content:'héllo 🌍'}]}).slice(1));for(const byte of payload)pending.write(Buffer.from([byte]));pending.end();assert.equal(await done,400);assert.equal(calls,1);assert.equal(g.budget.spent,.001);assert.equal(g.budget.reserved,0);assert.equal(g.budget.stopped,'invalid-provider-response');
 }finally{await g.close();}
});
test('malformed cost prevents delivery and subsequent paid requests',async()=>{
 let calls=0;const g=await startGateway({key:'x',fetchImpl:async()=>{calls++;return new Response('data: {"choices":[],"usage":{}}\n\n');}});
 try{for(let i=0;i<2;i++){const r=await fetch(g.url+'/v1/chat/completions',{method:'POST',body:JSON.stringify({model:MODEL,messages:[]})});assert.equal(r.status,400);await r.text();}assert.equal(calls,1);}finally{await g.close();}
});
