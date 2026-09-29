import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { createServer as httpServer } from 'node:http';
import { sha } from './runtime.mjs';
import { mkdtempSync,readFileSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createCurlTransport } from './transport.mjs';
test('real TLS: trusted local certificate, fresh requests, no retry, redirect, bounds, deadline and cancellation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'benchmark-tls-')),key=join(dir,'key.pem'),cert=join(dir,'cert.pem');
 const r=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 let calls=0;const sockets=new Set();
 const server=createServer({key:readFileSync(key),cert:readFileSync(cert)},async(req,res)=>{calls++;sockets.add(req.socket);let body='';for await(const chunk of req)body+=chunk;
  if(req.url==='/stall')return;
  if(req.url==='/redirect'){res.writeHead(302,{location:'/ok'});return res.end();}
  if(req.url==='/big')return res.end('x'.repeat(10000));
  if(req.url==='/disconnect'){req.socket.destroy();return;}
  res.setHeader('x-request-id','tls-fixture');
  assert.equal(req.headers.authorization,'Bearer private-test');res.write(Buffer.from('héllo 🌍').subarray(0,3));res.end(Buffer.concat([Buffer.from('héllo 🌍').subarray(3),Buffer.from(body)]));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`https://127.0.0.1:${server.address().port}`;
 const options={method:'POST',headers:{Authorization:'Bearer private-test'},body:'payload'};
 try{
  await assert.rejects(createCurlTransport()(url,options),e=>e.code==='CURL_60');assert.equal(calls,0,'untrusted cert must fail');
  const fetch=createCurlTransport({caFile:cert});
  for(let i=0;i<25;i++)assert.equal(await(await fetch(url,options)).text(),'héllo 🌍payload');assert.equal(sockets.size,25,'fresh TLS connections');
  assert.equal((await fetch(url+'/redirect',options)).status,302);assert.equal(calls,26,'no redirect follow');
  await assert.rejects(fetch(url+'/disconnect',options));assert.equal(calls,27,'no retry of ambiguous POST');
  await assert.rejects(createCurlTransport({caFile:cert,maxBytes:100})(url+'/big',options),e=>e.code==='RESPONSE_TOO_LARGE');
  await assert.rejects(createCurlTransport({caFile:cert,timeoutMs:100})(url+'/stall',options));
  const ac=new AbortController();setTimeout(()=>ac.abort(),50);await assert.rejects(fetch(url+'/stall',{...options,signal:ac.signal}),e=>e.code==='ABORTED');
  await assert.rejects(fetch('http://example.com',options),/HTTPS required/);
  await assert.rejects(fetch(url,{headers:{Authorization:'x\nInjected: y'}}),/Invalid HTTP header/);
  await assert.rejects(createCurlTransport({executable:'/missing-curl'})(url,options),e=>e.code==='TRANSPORT_SPAWN');
  const large=JSON.stringify({content:'héllo\\\"\n'.repeat(16000)});const largeResponse=await fetch(url,{...options,body:large});assert.equal(largeResponse.headers.get('x-request-id'),'tls-fixture');assert.equal(await largeResponse.text(),'héllo 🌍'+large);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('real curl wire body remains byte-exact across former config limits and historical multi-turn request',async()=>{
 const received=[];const server=httpServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks);received.push(bytes);res.end(JSON.stringify({bytes:bytes.length,hash:sha(bytes)}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const send=createCurlTransport({allowLoopbackHttp:true});const payloads=[...Array.from([60000,90000,97377,130000,399000],n=>JSON.stringify({content:'x'.repeat(n)})),JSON.stringify({content:'line\nquote"slash\\tab\té🌍'.repeat(9000)})];
 const historical='/home/baissi/benchmarks/deepseek-jev-v3/http400-diagnostic/payload.json';if(existsSync(historical))payloads.push(readFileSync(historical,'utf8'));
 try{for(const body of payloads){const r=await send(`http://127.0.0.1:${server.address().port}`,{body,headers:{'Content-Type':'application/json'}});const d=await r.json();assert.equal(d.hash,sha(body));assert.equal(d.bytes,Buffer.byteLength(body));assert.deepEqual(JSON.parse(received.at(-1)),JSON.parse(body));}}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
