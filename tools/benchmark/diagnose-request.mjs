// Offline only: reconstruct the final request using the installed serializer.
// No tool execution, model generation or candidate/session mutation.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { ENGINE_ROOT, sha } from './runtime.mjs';
export async function reconstruct(run) {
  const { buildSystemPrompt } = await import(pathToFileURL(join(ENGINE_ROOT,'dist/core/system-prompt.js')));
  const { createToolDefinition } = await import(pathToFileURL(join(ENGINE_ROOT,'dist/core/tools/index.js')));
  const { stream } = await import(pathToFileURL(join(ENGINE_ROOT,'node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js')));
  const invocation=JSON.parse(readFileSync(join(run,'invocation.json'),'utf8'));
  if(invocation.arm!=='plain')throw Error('Reconstruction currently supports plain arm only');
  const workspace=join(run,'workspace'), toolNames=['read','bash','edit','write','grep','find','ls'];
  const definitions=toolNames.map(name=>createToolDefinition(name,workspace));
  const systemPrompt=buildSystemPrompt({cwd:workspace,selectedTools:toolNames,toolSnippets:Object.fromEntries(definitions.map(t=>[t.name,t.promptSnippet])),promptGuidelines:definitions.flatMap(t=>t.promptGuidelines || []),skills:[],contextFiles:[]});
  const files=readdirSync(join(run,'sessions')).filter(f=>f.endsWith('.jsonl'));if(files.length!==1)throw Error('Expected one session');
  const entries=readFileSync(join(run,'sessions',files[0]),'utf8').trim().split('\n').map(JSON.parse);
  const messages=entries.filter(e=>e.type==='message').map(e=>e.message).filter(m=>!(m.role==='assistant'&&['error','aborted'].includes(m.stopReason)));
  const config=JSON.parse(readFileSync(join(run,'config/models.json'),'utf8')).providers.benchmark;
  const model={...config.models[0],provider:'benchmark',api:config.api,baseUrl:config.baseUrl};
  let raw;
  const s=stream(model,{systemPrompt,messages,tools:definitions},{apiKey:'offline-placeholder',onPayload:payload=>{raw=payload;throw Error('OFFLINE_CAPTURE_ONLY');},fetch:()=>{throw Error('NETWORK_FORBIDDEN');}});
  await s.result();if(!raw)throw Error('Serializer did not produce payload');
  const payload={model:raw.model,messages:raw.messages,tools:raw.tools,tool_choice:raw.tool_choice,stream:true,stream_options:{include_usage:true},max_tokens:16384,reasoning:{effort:'high'},provider:{max_price:{prompt:.30,completion:1.20},require_parameters:true}};
  const receipts=readFileSync(join(run,'gateway.jsonl'),'utf8').trim().split('\n').map(JSON.parse),last=receipts.filter(r=>r.type==='request'&&r.kind==='generation').at(-1);
  return {payload,report:{originalHash:last.requestHash,reconstructedHash:sha(JSON.stringify(payload)),hashMatches:sha(JSON.stringify(payload))===last.requestHash,originalBytes:last.bytes,reconstructedBytes:Buffer.byteLength(JSON.stringify(payload)),messages:payload.messages.length,...inspectRequest(payload)}};
}
export function inspectRequest(payload){
 const issues=[],pending=new Set(),seen=new Set();let toolCalls=0,toolResults=0;
 for(const [i,m] of payload.messages.entries()){
  if(m.role==='tool'){toolResults++;if(!pending.delete(m.tool_call_id))issues.push(`message ${i}: unmatched tool result`);}
  else {if(pending.size)issues.push(`message ${i}: missing tool results before ${m.role}`);for(const t of m.tool_calls || []){toolCalls++;if(seen.has(t.id))issues.push(`message ${i}: duplicate tool id`);seen.add(t.id);pending.add(t.id);try{JSON.parse(t.function.arguments);}catch{issues.push(`message ${i}: invalid tool arguments`);}}}
 }
 if(pending.size)issues.push('Missing final tool results');
 return {toolCalls,toolResults,issues,reasoningMessages:payload.messages.filter(m=>m.reasoning_details).length,tools:payload.tools?.map(t=>t.function?.name)};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const [run,out]=process.argv.slice(2);if(!run||!out)throw Error('Usage: diagnose-request.mjs RUN NEW_OUTPUT_DIRECTORY');
 const {payload,report}=await reconstruct(run);mkdirSync(out,{mode:0o700});writeFileSync(join(out,'payload.json'),JSON.stringify(payload),{mode:0o600});writeFileSync(join(out,'inspection.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
