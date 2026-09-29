import { spawn, spawnSync } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { mkdirSync, writeFileSync, readFileSync, appendFileSync, cpSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '../benchmark/gateway.mjs';
import { GLM_FLASH as MODEL, generatorProfile } from '../benchmark/generator.mjs';
const PROFILE = generatorProfile(MODEL);
import { safeEnv, provisionTools, ENGINE_ROOT, stopGroup, sha } from '../benchmark/runtime.mjs';
import { initializeCampaign, campaignAccount } from '../benchmark/campaign.mjs';
import { terminalStatus } from '../benchmark/runner.mjs';
import { TASKS, MATRIX, BASE } from './tasks.mjs';
export const ROOT='/home/baissi/benchmarks/glm-repo-pilot-v1';
const SETUP='/home/baissi/benchmarks/jev-repo-pilot';
const REPO=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const BWRAP=SETUP+'/setup/bubblewrap-root/usr/bin/bwrap';
const CAMPAIGN='/home/baissi/benchmarks/jev-repo-pilot/campaign.json';
const NODE=dirname(dirname(process.execPath));
function walk(root){return readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(root,e.name)):e.isFile()?[join(root,e.name)]:[]);}
export function manifest(){return Object.fromEntries([...['lib','extensions','docs','skills','tools/repo-pilot','tools/benchmark'].flatMap(d=>walk(join(REPO,d))),...walk(ROOT+'/reference'),...walk(ROOT+'/system'),...walk(ROOT+'/setup/fastify').filter(p=>!p.includes('/.git/')), ...walk(ENGINE_ROOT), ...walk(REPO+'/vendor'), ...walk(REPO+'/node_modules'),process.execPath,BWRAP].sort().map(p=>[p,sha(readFileSync(p))]));}
export function freeze(){writeFileSync(ROOT+'/freeze.json',JSON.stringify({at:new Date().toISOString(),base:BASE,generator:PROFILE,hashes:manifest(),limits:{candidate:14,smoke:1,cell:2.3,seconds:900,tools:120},compaction:{enabled:true,reserveTokens:70000,keepRecentTokens:6000}},null,2),{flag:'wx'});}
function verify(){const frozen=JSON.parse(readFileSync(ROOT+'/freeze.json'));if(JSON.stringify(frozen.hashes)!==JSON.stringify(manifest()))throw Error('Freeze mismatch');}
export function sandboxArgs(run, {broker=true,evaluator=false}={}){
 const args=['--die-with-parent','--new-session','--unshare-user','--unshare-pid','--unshare-ipc','--unshare-uts','--unshare-net','--cap-drop','ALL','--ro-bind','/usr','/usr','--ro-bind','/lib','/lib','--ro-bind','/lib64','/lib64','--symlink','usr/bin','/bin','--proc','/proc','--dev','/dev','--ro-bind',ROOT+'/system/hosts','/etc/hosts','--ro-bind',ROOT+'/system/nsswitch.conf','/etc/nsswitch.conf','--tmpfs','/tmp','--dir','/home','--dir','/home/agent','--ro-bind',NODE,'/node','--ro-bind',ENGINE_ROOT,'/engine','--bind',run+'/workspace','/work','--ro-bind',ROOT+'/setup/fastify/node_modules','/work/node_modules','--bind',run+'/config','/config','--bind',run+'/sessions','/sessions','--bind',run+'/logs','/logs','--ro-bind',ROOT+'/reference','/reference'];
 for(const d of ['lib','extensions','docs','skills','vendor','node_modules'])args.push('--ro-bind',REPO+'/'+d,'/harness/'+d);
 args.push('--ro-bind',REPO+'/tools/benchmark/guard.ts','/guard.ts','--ro-bind',REPO+'/tools/repo-pilot/sandbox-entry.mjs','/entry.mjs');
 if(broker)args.push('--ro-bind',run+'/broker.sock','/broker.sock');
 if(evaluator)args.push('--ro-bind',REPO+'/tools/repo-pilot/evaluator.cjs','/evaluate.cjs','--ro-bind',ROOT+'/setup/fastify/test','/work/test','--ro-bind',REPO+'/tools/repo-pilot/type-evaluator.cjs','/types.cjs');
 args.push('--chdir','/work','--clearenv');
 const env={HOME:'/home/agent',USER:'agent',PATH:'/node/bin:/usr/bin:/bin',LANG:'C.UTF-8',CI:'1',PI_CODING_AGENT_DIR:'/config',PI_OFFLINE:'1',PI_TELEMETRY:'0',BENCH_GUARD_LOG:'/logs/guard.jsonl',BENCH_TOOL_LIMIT:'120'};
 for(const[k,v]of Object.entries(env))args.push('--setenv',k,v);
 return args;
}
export function prepareRun(name,prompt){
 const run=ROOT+'/'+name;mkdirSync(run);for(const d of ['config','sessions','logs'])mkdirSync(run+'/'+d);
 cpSync(ROOT+'/setup/fastify',run+'/workspace',{recursive:true,filter:p=>!p.includes('/node_modules')});
 writeFileSync(run+'/workspace/TASK.md',prompt);appendFileSync(run+'/workspace/.gitignore','\n.harness/\nartifacts/\n');
 const git=spawnSync('git',['-c','user.name=Pilot','-c','user.email=pilot@localhost','add','.'],{cwd:run+'/workspace'});if(git.status)throw Error('git add');
 if(spawnSync('git',['-c','user.name=Pilot','-c','user.email=pilot@localhost','commit','-qm','Frozen pilot task and dependency lock'],{cwd:run+'/workspace'}).status)throw Error('git commit');
 provisionTools(run+'/config');writeFileSync(run+'/config/auth.json','{}');
 writeFileSync(run+'/config/settings.json',JSON.stringify({retry:{enabled:false,provider:{maxRetries:0}},compaction:{enabled:true,reserveTokens:70000,keepRecentTokens:6000}}));
 writeFileSync(run+'/config/models.json',JSON.stringify({providers:{benchmark:{baseUrl:'http://127.0.0.1:12345/v1',api:'openai-completions',apiKey:'local-dummy',models:[{id:MODEL,reasoning:true,input:['text'],contextWindow:100000,maxTokens:16384,cost:{input:PROFILE.input,output:PROFILE.output,cacheRead:PROFILE.cacheRead,cacheWrite:0},compat:{supportsDeveloperRole:false,thinkingFormat:'openrouter',maxTokensField:'max_tokens',supportsStore:false}}]}}}));return run;
}
export async function run(task,arm,{smoke=false,prompt:override}={}){
 if(!smoke)verify();
 const prompt=override||TASKS[task];const name=smoke?`smoke-${task}-${arm}`:`${task}-${arm}`;
 const dir=prepareRun(name,prompt);
 if(smoke && task==='compact')writeFileSync(dir+'/config/settings.json',JSON.stringify({retry:{enabled:false},compaction:{enabled:true,reserveTokens:90000,keepRecentTokens:2000}}));
 const key=JSON.parse(readFileSync('/home/baissi/.pi/agent/auth.json')).openrouter.key;
 const gateway=await startGateway({key,generator:MODEL,limit:smoke?.7:2.3,allowJev:arm==='jev',receiptPath:dir+'/gateway.jsonl',account:campaignAccount(CAMPAIGN,smoke?'smoke':'candidate',name)});
 const port=Number(new URL(gateway.url).port);const connections=new Set();
 const proxy=createServer(client=>{const upstream=connect(port,'127.0.0.1');connections.add(client);connections.add(upstream);client.pipe(upstream);upstream.pipe(client);for(const s of [client,upstream]){s.on('error',()=>{client.destroy();upstream.destroy();});s.on('close',()=>connections.delete(s));}});
 await new Promise(r=>proxy.listen(dir+'/broker.sock',r));
 const args=sandboxArgs(dir);args.push('/node/bin/node','/entry.mjs','/engine/dist/cli.js','--mode','json','-p','--offline','--no-extensions','--no-skills','--no-context-files','--no-prompt-templates','--no-themes','--no-approve','--provider','benchmark','--model',MODEL,'--thinking','high','--session-dir','/sessions','-e','/guard.ts');
 if(arm!=='plain')args.push('-e','/harness/extensions/delivery.ts','--skill','/harness/skills/software-delivery/SKILL.md','--append-system-prompt','Use delivery_design action=guide for exact schema before authoring design; /harness/docs/tested-planning.md has extended details only if needed. This is an existing library patch: inspect relevant files, submit a concrete plan, use focused edits and preserve upstream tests.');
 if(arm==='jev')args.push('--delivery-jev','--delivery-jev-broker','http://127.0.0.1:12345/jev');
 args.push('--tools',['read','bash','edit','write','grep','find','ls',...(arm==='plain'?[]:['delivery_plan','delivery_revise','delivery_design','delivery_progress','delivery_check','delivery_review','delivery_status','delivery_finish'])].join(','),prompt);
 writeFileSync(dir+'/invocation.json',JSON.stringify({task,arm,generator:PROFILE,base:BASE,args,settings:JSON.parse(readFileSync(dir+'/config/settings.json')),at:new Date().toISOString()},null,2));
 const started=Date.now(),events=[];let pending='',stopReason=null,count=0;const decoder=new TextDecoder();
 const child=spawn(BWRAP,args,{env:safeEnv(),stdio:['ignore','pipe','pipe'],detached:true});
 const kill=reason=>{stopReason ||= reason;try{process.kill(-child.pid,'SIGTERM');}catch{}setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},2000).unref();};
 child.stdout.on('data',chunk=>{appendFileSync(dir+'/events.jsonl',chunk);pending+=decoder.decode(chunk,{stream:true});let nl;while((nl=pending.indexOf('\n'))>=0){const line=pending.slice(0,nl);pending=pending.slice(nl+1);try{const e=JSON.parse(line);if(e.type==='message_end')events.push(e);if(e.type==='tool_execution_start')count++;if(e.type==='tool_execution_end'&&e.result?.content?.some(c=>c.text?.includes('Benchmark tool budget exhausted')))kill('tool-budget');}catch{}}});
 child.stderr.on('data',chunk=>appendFileSync(dir+'/stderr.log',chunk));const timer=setTimeout(()=>kill('wall-time'),(smoke?240:900)*1000);
 let exit;try{exit=await new Promise((r,j)=>{child.on('error',j);child.on('exit',(code,signal)=>r({code,signal}));});}finally{clearTimeout(timer);await stopGroup(child);for(const s of connections)s.destroy();await new Promise(r=>proxy.close(r));await gateway.close();}
 const classification=terminalStatus(events,exit,stopReason,gateway.budget);
 let resource=stopReason;if(gateway.receipts.some(r=>r.type==='failure'&&/input bound/i.test(r.reason||'')))resource='input-byte-limit';if(classification.terminalModelReason==='length')resource='output-token-limit';
 const result={task,arm,...exit,...classification,resource,wallMs:Date.now()-started,toolStarts:count,budget:gateway.budget};writeFileSync(dir+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));return result;
}
export function evaluate(task,arm){
 const dir=ROOT+'/'+task+'-'+arm;const args=sandboxArgs(dir,{broker:false,evaluator:true});
 const r=spawnSync(BWRAP,[...args,'/node/bin/node','/evaluate.cjs',task],{encoding:'utf8',timeout:60000,maxBuffer:4e6});writeFileSync(dir+'/evaluation.log',r.stdout+r.stderr);
 const evaluation=r.status===0?JSON.parse(r.stdout.trim()):{infrastructureError:true,status:r.status};
 const baseline=spawnSync(BWRAP,[...sandboxArgs(dir,{broker:false,evaluator:true}),'/node/bin/node','--test','test/internals/reply.test.js','test/internals/request.test.js'],{encoding:'utf8',timeout:120000,maxBuffer:8e6});writeFileSync(dir+'/regressions.log',baseline.stdout+baseline.stderr);
 const diff=spawnSync('git',['diff','--stat'],{cwd:dir+'/workspace',encoding:'utf8'}).stdout;
 const types=spawnSync(BWRAP,[...sandboxArgs(dir,{broker:false,evaluator:true}),'/node/bin/node','/types.cjs',task],{encoding:'utf8',timeout:60000,maxBuffer:4e6});writeFileSync(dir+'/types.log',types.stdout+types.stderr);
 const result={...evaluation,protectedRegressionExit:baseline.status,externalTypesExit:types.status,diff};writeFileSync(dir+'/evaluation.json',JSON.stringify(result,null,2));return result;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const [action,task,arm]=process.argv.slice(2);
 if(action==='init')initializeCampaign(CAMPAIGN,{candidateLimit:14,smokeLimit:1,historicalCandidate:0,historicalSmoke:0});
 else if(action==='freeze')freeze();
 else if(action==='smoke')await run(task,arm,{smoke:true,prompt:readFileSync(ROOT+'/smoke-prompt.txt','utf8')});
 else if(action==='matrix'){for(const[t,a]of MATRIX){const r=await run(t,a);evaluate(t,a);if(!r.resource&&['infrastructure-error','process-error','missing-terminal-message','model-error'].includes(r.status))throw Error('Infrastructure stop; no automatic retry');}}
 else if(action==='evaluate')console.log(evaluate(task,arm));
}
