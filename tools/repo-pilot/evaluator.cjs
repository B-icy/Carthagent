const assert = require('node:assert/strict');
const path = require('node:path');
const fastify = require(path.join(process.cwd(),'fastify.js'));
const task = process.argv[2];const rows=[];
async function category(name, fn){try{await fn();rows.push({name,passed:true});}catch(e){rows.push({name,passed:false,error:String(e.message).slice(0,1200)});}}
async function scenario(fn, {real=false,hook=false}={}) {
 const app=fastify();let failure;
 app.register(async child=>{
  if(hook)child.addHook('onSend',async(req,reply,payload)=>{try{fn(reply,req);}catch(e){failure=e;}return payload;});
  child.get('/',(req,reply)=>{if(!hook)try{fn(reply,req);}catch(e){failure=e;}reply.send('ok');});
 });
 try{let result;if(real){await app.listen({port:0,host:'127.0.0.1'});const r=await fetch(app.listeningOrigin);result={statusCode:r.status,headers:Object.fromEntries(r.headers),cookies:r.headers.getSetCookie()};await r.text();}else result=await app.inject('/');if(failure)throw failure;assert.equal(result.statusCode,200);return result;}finally{await app.close();}
}
(async()=>{
 if(task==='append'){
 await category('chainable effective header and order',()=>scenario(r=>{assert.equal(r.appendHeader('X-Test','one'),r);r.appendHeader('x-test',[0,'','two,two']);assert.deepEqual(r.getHeader('X-TEST'),['one','0','','two,two']);}));
 await category('raw precedence and no alias mutation',()=>scenario(r=>{const old=['a'];r.raw.setHeader('x-test',old);r.appendHeader('X-Test',['b']);assert.deepEqual(old,['a']);assert.deepEqual(r.getHeader('x-test'),['a','b']);r.header('x-test','override');r.appendHeader('x-test','c');assert.deepEqual(r.getHeader('x-test'),['override','c']);}));
 await category('set-cookie append exactly once',async()=>{const v=await scenario(r=>{r.header('set-cookie',['a=1']);r.appendHeader('Set-Cookie',['b=2','c=3']);},{real:true});assert.deepEqual(v.cookies,['a=1','b=2','c=3']);});
 await category('array copied empty no-op',()=>scenario(r=>{const values=['a'];r.appendHeader('x-test',values);values.push('b');assert.deepEqual(r.getHeader('x-test'),['a']);r.appendHeader('x-test',[]);assert.deepEqual(r.getHeader('x-test'),['a']);}));
 await category('atomic invalid values and names',()=>scenario(r=>{r.header('x-test','old');for(const bad of [undefined,null,{},NaN,Infinity,['good','bad\r\nx'],['good',{}],['good','x\u0000']]){assert.throws(()=>r.appendHeader('x-test',bad),TypeError);assert.equal(r.getHeader('x-test'),'old');}for(const name of ['bad name','',':bad',7])assert.throws(()=>r.appendHeader(name,[]),TypeError);}));
 await category('onSend real HTTP and normal header unaffected',async()=>{const v=await scenario(r=>{r.header('x-other','before');r.header('x-other','after');r.appendHeader('x-test','a').appendHeader('x-test','b');},{real:true,hook:true});assert.equal(v.headers['x-test'],'a, b');assert.equal(v.headers['x-other'],'after');});
 } else {
 await category('chainable token normalization',()=>scenario(r=>{assert.equal(r.vary('Accept-Encoding, Accept'),r);r.vary(['accept-encoding',' Origin , accept']);assert.equal(r.getHeader('vary'),'Accept-Encoding, Accept, Origin');}));
 await category('raw header merge Fastify precedence',()=>scenario(r=>{r.raw.setHeader('Vary',['Accept','accept']);r.vary('Origin');assert.equal(r.getHeader('vary'),'Accept, Origin');r.header('vary','X-Custom');r.vary('Accept');assert.equal(r.getHeader('vary'),'X-Custom, Accept');}));
 await category('wildcard dominance all input validated',()=>scenario(r=>{r.vary('Accept');r.vary(['Origin','*']);assert.equal(r.getHeader('vary'),'*');r.vary('Accept-Encoding');assert.equal(r.getHeader('vary'),'*');assert.throws(()=>r.vary(['*','bad name']),TypeError);assert.equal(r.getHeader('vary'),'*');}));
 await category('empty no-op and no input mutation',()=>scenario(r=>{r.header('vary',['Accept','Accept']);const old=r.getHeader('vary');r.vary(' , \t,');assert.equal(r.getHeader('vary'),old);const values=['Origin','Accept'];r.vary(values);assert.deepEqual(values,['Origin','Accept']);assert.equal(r.getHeader('vary'),'Accept, Origin');}));
 await category('invalid input atomic incl CRLF',()=>scenario(r=>{r.header('vary','Accept');for(const bad of [null,undefined,7,{},['Origin',3],['Origin',['Accept']],['Origin','bad name'],'Accept\r\n','\nAccept','bad:token']){assert.throws(()=>r.vary(bad),TypeError);assert.equal(r.getHeader('vary'),'Accept');}}));
 await category('onSend real HTTP',async()=>{const v=await scenario(r=>{r.header('x-other','same');r.vary('Accept-Encoding').vary('Origin');},{real:true,hook:true});assert.equal(v.headers.vary,'Accept-Encoding, Origin');assert.equal(v.headers['x-other'],'same');});
 }
 await category('independent requests',async()=>{const app=fastify();app.get('/:id',(req,r)=>{if(task==='append')r.appendHeader('x-test',req.params.id);else r.vary(req.params.id);return 'ok';});try{const a=await app.inject('/Accept'),b=await app.inject('/Origin');assert.equal(String(a.headers[task==='append'?'x-test':'vary']),'Accept');assert.equal(String(b.headers[task==='append'?'x-test':'vary']),'Origin');}finally{await app.close();}});
 console.log(JSON.stringify({task,passed:rows.filter(x=>x.passed).length,total:rows.length,categories:rows}));
})().catch(e=>{console.error(e);process.exitCode=2;});
