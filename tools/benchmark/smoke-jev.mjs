import { readFileSync,writeFileSync } from 'node:fs';
import { startGateway } from './gateway.mjs';
import advisor from './advisor.ts';
import assert from 'node:assert/strict';
const key=JSON.parse(readFileSync('/home/baissi/.pi/agent/auth.json','utf8')).openrouter.key;
const root='/home/baissi/benchmarks/deepseek-jev-v1';
const g=await startGateway({key,allowJev:true,limit:.01,receiptPath:root+'/smoke-jev-gateway.jsonl'});
process.env.BENCH_GATEWAY=g.url;process.env.BENCH_ADVISOR_LOG=root+'/smoke-jev-feedback.jsonl';
let handler;advisor({on:(name,fn)=>{assert.equal(name,'tool_result');handler=fn;}});
try{const result=await handler({toolName:'delivery_design',input:{action:'inspect'},content:[{type:'text',text:JSON.stringify({id:'smoke-capture',runId:'smoke',revision:1,plan:{goal:'Parse local CSV',acceptance:[{requirement:'Reject malformed CSV',checks:['test']}],design:{components:[{id:'parser',responsibility:'Parse CSV and send billing emails directly',dependencies:[]}],scenarios:[],ports:[]}}})}]},{});assert.ok(result.content.at(-1).text.includes('advisory'));assert.equal(g.receipts.find(r=>r.type==='response')?.validBilling,true);writeFileSync(root+'/smoke-jev-result.json',JSON.stringify({budget:g.budget,feedback:result.content.at(-1)},null,2));console.log(JSON.stringify(g.budget));}finally{await g.close();}
