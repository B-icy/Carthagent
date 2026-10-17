import test from 'node:test';import assert from 'node:assert/strict';
import {upstreamError}from'./upstream-error.mjs';import{startGateway,MODEL}from'./gateway.mjs';
import{inspectCapturedRequest,inspectRequest}from'./diagnose-request.mjs';import{mkdtempSync,writeFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
test('bounded error receipts redact reflected credentials and preserve diagnostic fields',async()=>{
 const secret='private+key/test';const r=await upstreamError(Response.json({error:{code:400,message:'Invalid tool history: '+secret,metadata:{provider_name:'fixture',raw:'Bearer token '+encodeURIComponent(secret)}}},{status:400,headers:{'x-request-id':'req123'}}),{secrets:[secret]});assert.equal(r.status,400);assert.equal(r.requestId,'req123');assert.equal(r.provider,'fixture');assert.match(r.message,/Invalid tool history/);assert.ok(!JSON.stringify(r).includes(secret));assert.ok(!JSON.stringify(r).includes(encodeURIComponent(secret)));
 let canceled=false;const over=await upstreamError(new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('x'.repeat(17000)));},cancel(){canceled=true;}}),{status:400}));assert.equal(canceled,true);assert.equal(over.bodyExcerpt,'[Oversized upstream error omitted]');
 const html=await upstreamError(new Response('<html>bad request</html>',{status:400}));assert.match(html.bodyExcerpt,/bad request/);
});
test('gateway records upstream rejection without replay or credential leak',async()=>{let calls=0;const g=await startGateway({key:'reflected-secret',fetchImpl:async()=>{calls++;return Response.json({error:{code:400,message:'Invalid input reflected-secret'}},{status:400});}});try{for(let i=0;i<2;i++){const r=await fetch(g.url+'/v1/chat/completions',{method:'POST',body:JSON.stringify({model:MODEL,messages:[]})});await r.text();assert.equal(r.status,400);}assert.equal(calls,1);assert.match(g.receipts.find(r=>r.type==='http-failure').message,/Invalid input/);assert.ok(!JSON.stringify(g.receipts).includes('reflected-secret'));assert.equal(g.budget.reserved,.15);}finally{await g.close();}});
test('offline native request inspection validates captured OpenAI-compatible payloads without replay',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ctg-native-request-diagnostic-'));
 try{
  const capture=join(dir,'request.json');
  const payload={model:MODEL,messages:[{role:'assistant',tool_calls:[{id:'read-1',type:'function',function:{name:'read',arguments:JSON.stringify({path:'src/main.rs'})}}]},{role:'tool',tool_call_id:'read-1',content:'ok'}],tools:[{type:'function',function:{name:'read'}}],stream:true,max_tokens:16384,reasoning:{effort:'high'}};
  writeFileSync(capture,JSON.stringify(payload));
  const inspected=await inspectCapturedRequest(capture);
  assert.deepEqual(inspected.report.issues,[]);assert.equal(inspected.report.toolCalls,1);assert.equal(inspected.report.toolResults,1);
  assert.equal(inspected.report.sourceHash,inspected.report.normalizedHash);
  assert.equal(JSON.stringify(inspected.report).includes('.pi/'),false);
  const orphan={...payload,messages:[...payload.messages,{role:'tool',tool_call_id:'missing',content:'x'}]};
  assert.ok(inspectRequest(orphan).issues.some(issue=>issue.includes('unmatched tool result')));
  assert.ok(inspectRequest({...payload,messages:[{role:'assistant',tool_calls:[{id:'bad',function:{arguments:'{'}}]}]}).issues.some(issue=>issue.includes('invalid tool arguments')));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
