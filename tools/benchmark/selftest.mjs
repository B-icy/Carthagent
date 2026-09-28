import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { evaluateLedger } from './eval-ledger.mjs';
import { quoteOracle } from './eval-shop.mjs';
import { validWorld,changedBlocks } from './eval-voxel.mjs';
import { browser } from './eval-common.mjs';
// Independent test-only reference process. Never copied into any candidate workspace.
const reference=String.raw`
import fs from 'node:fs';import readline from 'node:readline';
const file=process.argv[3], balances={},seen=new Map(),events=[];const max=99999999999999999999n;
const amount=s=>{if(typeof s!=='string'||! /^[+-]?\d+(\.\d{1,2})?$/.test(s))throw Error('decimal');const neg=s[0]==='-';s=s.replace(/^[+-]/,'');const [a,b='']=s.split('.');const n=BigInt(a)*100n+BigInt(b.padEnd(2,'0'));if(n>max)throw Error('range');return neg?-n:n;};
const fmt=n=>String(n/100n)+'.'+String(n%100n).padStart(2,'0');
function apply(c,replay=false){const id=s=>{if(typeof s!=='string'||! /^[A-Za-z0-9_-]{1,40}$/.test(s))throw Error('id');return s;};
 if(c.op==='snapshot')return {ok:true,balances:Object.fromEntries(Object.entries(balances).map(([k,n])=>[k,fmt(n)]))};
 if(c.op==='balance'){id(c.account);if(balances[c.account]===undefined)throw Error('missing');return {ok:true,balance:fmt(balances[c.account])};}
 id(c.key);let norm,n;
 if(c.op==='open'){id(c.account);n=amount(c.balance);if(n<0n)throw Error('negative');norm=JSON.stringify(['open',c.account,String(n)]);}
 else if(c.op==='transfer'){id(c.from);id(c.to);n=amount(c.amount);norm=JSON.stringify(['transfer',c.from,c.to,String(n)]);}else throw Error('op');
 if(seen.has(c.key)){if(seen.get(c.key)!==norm)throw Error('conflict');return {ok:true};}
 if(c.op==='open'){if(balances[c.account]!==undefined)throw Error('exists');balances[c.account]=n;}
 else{if(c.from===c.to||n<=0n||balances[c.from]===undefined||balances[c.to]===undefined||balances[c.from]<n||balances[c.to]+n>max)throw Error('transfer');balances[c.from]-=n;balances[c.to]+=n;}
 seen.set(c.key,norm);if(!replay)fs.appendFileSync(file,JSON.stringify(c)+'\n');return {ok:true};}
try{if(fs.existsSync(file))for(const line of fs.readFileSync(file,'utf8').split('\n').filter(Boolean)){const c=JSON.parse(line);if(!['open','transfer'].includes(c.op))throw Error('record');apply(c,true);}}catch{process.exit(2);}
for await(const line of readline.createInterface({input:process.stdin})){try{console.log(JSON.stringify(apply(JSON.parse(line))));}catch(e){console.log(JSON.stringify({ok:false,error:e.message}));}}
`;
test('ledger evaluator passes reference and detects float/idempotency mutants through real processes',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ledger-oracle-'));writeFileSync(join(root,'ledger.mjs'),reference);
 const positive=await evaluateLedger(root,join(root,'good'));assert.equal(positive.passed,positive.total,JSON.stringify(positive));
 writeFileSync(join(root,'ledger.mjs'),reference.replace('BigInt(a)*100n+BigInt(b.padEnd(2,\'0\'))','BigInt(Math.round(Number(s)*100))'));
 const floating=await evaluateLedger(root,join(root,'float'));assert.ok(floating.results.some(r=>r.name.includes('large magnitudes')&&!r.passed));
 writeFileSync(join(root,'ledger.mjs'),reference.replace("if(seen.has(c.key))","if(false && seen.has(c.key))"));
 const duplicate=await evaluateLedger(root,join(root,'duplicate'));assert.ok(duplicate.results.some(r=>r.name.includes('idempotency')&&!r.passed));
});
test('shop oracle catches rounding/shipping mutants and voxel oracle rejects unchanged/malformed state',()=>{
 assert.deepEqual(quoteOracle([{id:'mug',quantity:1}],'WELCOME10'),{subtotalCents:1299,discountCents:129,shippingCents:599,totalCents:1769});
 assert.notEqual(quoteOracle([{id:'mug',quantity:1}],'WELCOME10').discountCents,Math.round(1299*.1));
 assert.equal(quoteOracle([{id:'mat',quantity:2},{id:'mug',quantity:1}],'WELCOME10').shippingCents,599);
 const s={seed:1,player:{x:1,y:3,z:1,yaw:0,pitch:0},blocks:Array.from({length:256},(_,i)=>[i%16,0,Math.floor(i/16),i%3+1])};validWorld(s);assert.equal(changedBlocks(s,structuredClone(s)),0);assert.throws(()=>validWorld({...s,blocks:[]}));assert.throws(()=>validWorld({...s,player:{...s.player,y:0}}));
});
test('real Firefox infrastructure and native click screenshot',async()=>{
 const root='/home/baissi/benchmarks/deepseek-jev-v1/infrastructure-browser';mkdirSync(root,{recursive:true});const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<button onclick="this.textContent=\'clicked\'" id="go">ready</button>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));let b;
 try{b=await browser(root);await b.call('/url',{url:`http://127.0.0.1:${server.address().port}`});const el=await b.call('/element',{using:'css selector',value:'#go'});await b.call('/element/'+el['element-6066-11e4-a52e-4f735466cecf']+'/click',{});assert.equal(await b.exec('document.querySelector("#go").textContent'),'clicked');await b.shot(root+'/smoke.png');assert.equal(readFileSync(root+'/smoke.png').subarray(1,4).toString(),'PNG');}finally{await b?.close();await new Promise(r=>server.close(r));}
});
