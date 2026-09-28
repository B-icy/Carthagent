import { createHash } from 'node:crypto';
// Known credentials are removed BEFORE truncation. This is not general-purpose
// secret detection: provider errors may echo submitted source or planning data.
export function redactError(value, secrets = []) {
  let text=String(value);
  for(const secret of secrets.filter(s=>typeof s==='string'&&s.length)){
    const variants=[secret,JSON.stringify(secret).slice(1,-1),encodeURIComponent(secret),Buffer.from(secret).toString('base64')];
    for(const v of variants)text=text.split(v).join('[REDACTED]');
  }
  return text.replace(/Bearer\s+[^\s"'<>]+/gi,'Bearer [REDACTED]').replace(/sk-or-v1-[A-Za-z0-9_-]+/g,'[REDACTED]').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'?');
}
export async function upstreamError(response,{secrets=[],maxBytes=16384}={}){
  const reader=response.body?.getReader();const chunks=[];let bytes=0,truncated=false;
  try{if(reader)for(;;){const {done,value}=await reader.read();if(done)break;const take=Math.min(value.byteLength,maxBytes-bytes);chunks.push(value.subarray(0,take));bytes+=take;if(value.byteLength>take||bytes===maxBytes){truncated=true;await reader.cancel();break;}}}finally{reader?.releaseLock();}
  const body=Buffer.concat(chunks).toString('utf8');let parsed;try{parsed=JSON.parse(body);}catch{}
  const clean=v=>typeof v==='string'||typeof v==='number'?redactError(v,secrets).slice(0,2000):null;
  return {status:response.status,code:clean(parsed?.error?.code),message:clean(parsed?.error?.message || parsed?.message),provider:clean(parsed?.error?.metadata?.provider_name),requestId:clean(response.headers.get('x-request-id')||parsed?.request_id||parsed?.id),bodyExcerpt:truncated?'[Oversized upstream error omitted]':redactError(body,secrets).slice(0,8000),truncated:truncated||body.length>8000,bodyPrefixSha256:createHash('sha256').update(body).digest('hex')};
}
