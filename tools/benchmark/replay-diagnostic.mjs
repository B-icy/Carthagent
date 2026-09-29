// Explicit one-shot paid diagnostic. Never executes returned tools or resumes a candidate.
import{readFileSync,writeFileSync}from'node:fs';import{join}from'node:path';import{fileURLToPath}from'node:url';
import{curlFetch}from'./transport.mjs';import{upstreamError}from'./upstream-error.mjs';import{campaignAccount}from'./campaign.mjs';import{sha}from'./runtime.mjs';
export async function replay(dir){
 const original=readFileSync(join(dir,'payload.json'),'utf8'),inspection=JSON.parse(readFileSync(join(dir,'inspection.json'),'utf8'));
 if(!inspection.hashMatches||sha(original)!==inspection.originalHash)throw Error('Exact reconstruction required');
 const path=join(dir,'replay.json');writeFileSync(path,JSON.stringify({status:'reserved-pending',at:new Date().toISOString()}),{flag:'wx',mode:0o600});
 const payload=JSON.parse(original);payload.max_tokens=32;const wire=JSON.stringify(payload);
 if(Buffer.byteLength(wire)>100000)throw Error('Diagnostic input exceeds reservation envelope');
 const account=campaignAccount('/home/baissi/benchmarks/deepseek-jev-campaign.json','smoke',dir+'/one-shot-replay');const hold=account.reserve(.04);
 const key=JSON.parse(readFileSync('/home/baissi/.pi/agent/auth.json','utf8')).openrouter.key;
 const result={originalHash:sha(original),replayHash:sha(wire),changedFields:{max_tokens:{before:16384,after:32}},reserved:.04,hold,at:new Date().toISOString()};
 try{
  const response=await curlFetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:wire,signal:AbortSignal.timeout(180000)});
  result.httpStatus=response.status;
  if(!response.ok){result.error=await upstreamError(response,{secrets:[key]});result.billing='unknown-hold-retained';}
  else{const text=await response.text();let usage;for(const line of text.split('\n'))if(line.startsWith('data: {')){const c=JSON.parse(line.slice(6));if(c.usage)usage=c.usage;if(c.id)result.id=c.id;if(c.provider)result.provider=c.provider;if(c.model)result.model=c.model;}
   if(!Number.isFinite(usage?.cost)||usage.cost<0||usage.cost>.04)throw Error('Unknown diagnostic billing');account.reconcile(hold,usage.cost);result.usage=usage;result.billing='reconciled';result.outputExecuted=false;
  }
 }catch(e){result.failure={name:e.name,code:e.code||null};result.billing='unknown-hold-retained';}
 writeFileSync(path,JSON.stringify(result,null,2),{mode:0o600});return result;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){if(process.argv[2]!=='--paid'||!process.argv[3])throw Error('Usage: replay-diagnostic.mjs --paid DIAGNOSTIC_DIR');console.log(JSON.stringify(await replay(process.argv[3])));}
