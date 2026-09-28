// Explicit paid opt-in only; all calls debit the original shared smoke allowance.
import { readFileSync,writeFileSync,mkdirSync,existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway,MODEL } from './gateway.mjs';
import { campaignAccount,initializeCampaign } from './campaign.mjs';
import { CAMPAIGN,ROOT,runCandidate } from './runner.mjs';
export async function livePreflight(){
 if(!existsSync(CAMPAIGN))initializeCampaign(CAMPAIGN);
 const dir=join(ROOT,'live-preflight');mkdirSync(ROOT,{recursive:true});mkdirSync(dir); // exclusive: preserve every attempt
 const key=JSON.parse(readFileSync('/home/baissi/.pi/agent/auth.json','utf8')).openrouter.key;
 const gateway=await startGateway({key,limit:.09,allowJev:true,outputTokens:32,account:campaignAccount(CAMPAIGN,'smoke',dir),receiptPath:join(dir,'gateway.jsonl')});
 const checks=[];let failure;
 try{
  // Multiple calls exceed the earlier failing request counts. Two larger payloads
  // exercise TLS record boundaries; output length is intentionally bounded.
  for(let i=0;i<24;i++){
   const content='Reply OK. The following repeated filler is inert data: '+ 'a'.repeat([8,19].includes(i)?60000:1000);
   const r=await fetch(gateway.url+'/v1/chat/completions',{method:'POST',body:JSON.stringify({model:MODEL,messages:[{role:'user',content}]})});await r.text();
   if(r.status!==200)throw Error(`Transport probe ${i} failed; no automatic retry`);checks.push({kind:'generation',index:i,passed:true});
  }
  const r=await fetch(gateway.url+'/jev',{method:'POST',body:JSON.stringify({state:{goal:'Transport readiness',acceptance:[],design:{components:[],ports:[],scenarios:[]}}})});await r.text();if(r.status!==200)throw Error('Jev connectivity failed');checks.push({kind:'jev',passed:true});
 }catch(e){failure=e.message;}finally{await gateway.close();}
 const result={passed:!failure,checks,failure,budget:gateway.budget,at:new Date().toISOString()};writeFileSync(join(dir,'result.json'),JSON.stringify(result,null,2));
 if(failure)throw Error(failure);
 const smoke=await runCandidate('smoke','plain',{smoke:true,key});
 if(!smoke.smokePassed)throw Error('Live installed-engine smoke failed');
 writeFileSync(join(dir,'readiness.json'),JSON.stringify({passed:true,transport:result,engineSmoke:smoke,limitations:['Finite live soak does not establish TLS root cause or guarantee future availability.']},null,2));
 return result;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){if(process.argv[2]!=='--paid')throw Error('Explicit --paid required');console.log(JSON.stringify(await livePreflight()));}
