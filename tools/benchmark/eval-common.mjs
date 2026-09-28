import { spawn } from 'node:child_process';
import { safeEnv, stopGroup } from './runtime.mjs';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { createServer } from 'node:net';
export const wait=ms=>new Promise(r=>setTimeout(r,ms));
export async function freePort(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
export function checks(){const results=[];return {results,async check(name,fn){try{await fn();results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:String(e.message).slice(0,1800)});}},summary(){return {passed:results.filter(r=>r.passed).length,total:results.length,results};}};}
export async function command(cmd,args,cwd,env={},timeout=120000){
 const child=spawn(cmd,args,{cwd,env:safeEnv(env),detached:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',error;
 const terminate=reason=>{error ||= reason; void stopGroup(child);};
 child.stdout.on('data',b=>{stdout+=b;if(Buffer.byteLength(stdout)>8000000)terminate('Output limit');});child.stderr.on('data',b=>{stderr+=b;if(Buffer.byteLength(stderr)>8000000)terminate('Output limit');});
 const timer=setTimeout(()=>terminate('Timeout'),timeout);child.on('error',e=>error=e.message);
 try {const result=await new Promise(r=>child.once('close',(code,signal)=>r({code,signal})));return {...result,error,stdout:stdout.slice(-8000000),stderr:stderr.slice(-8000000)};}finally{clearTimeout(timer);await stopGroup(child);}
}
export async function eventually(fn,timeout=2200){let error;const end=Date.now()+timeout;do{try{return await fn();}catch(e){error=e;}await wait(75);}while(Date.now()<end);throw error || Error('Condition timeout');}
export async function serve(cmd,args,cwd,env,port,logPath){
 const p=spawn(cmd,args,{cwd,env:safeEnv(env),detached:true,stdio:['ignore','pipe','pipe']});let log='';const collect=c=>{log=(log+c).slice(-1000000);};p.stdout.on('data',collect);p.stderr.on('data',collect);let error;p.on('error',e=>error=e);
 const stop=async()=>{await stopGroup(p);if(logPath)appendFileSync(logPath,log);};
 for(let i=0;i<100;i++){if(error||p.exitCode!==null){await stop();throw Error('Launch failed: '+(error?.message||log.slice(-1500)));}try{const response=await fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(300)});await response.body?.cancel();return {url:`http://127.0.0.1:${port}`,stop};}catch{}await wait(100);}
 await stop();throw Error('Server readiness timeout: '+log.slice(-1000));
}
export async function json(url,path,body){const r=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(5000)});return {status:r.status,body:await r.json()};}
export async function browser(root){
 mkdirSync(root,{recursive:true});const port=await freePort();
 const driver=spawn('geckodriver',['--port',String(port),'--profile-root',root],{detached:true,stdio:['ignore','ignore','pipe'],env:safeEnv({MOZ_HEADLESS:'1'})});let log='';driver.stderr.on('data',c=>log=(log+c).slice(-1000000));let failure;driver.on('error',e=>failure=e);
 const base=`http://127.0.0.1:${port}`;
 async function call(path,body,method=body===undefined?'GET':'POST'){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000)});const d=await r.json();if(!r.ok||d.value?.error)throw Error(JSON.stringify(d.value));return d.value;}
 let session;
 try{for(let i=0;i<100;i++){if(failure)throw failure;try{await call('/status');break;}catch{}await wait(100);}session=(await call('/session',{capabilities:{alwaysMatch:{browserName:'firefox','moz:firefoxOptions':{args:['-headless']}}}})).sessionId;}catch(e){await stopGroup(driver);writeFileSync(root+'/driver.log',log);throw Error('Browser infrastructure: '+e.message);}
 const prefix='/session/'+session;
 return {call:(p,b,m)=>call(prefix+p,b,m),exec:script=>call(prefix+'/execute/sync',{script:'return eval(arguments[0]);',args:[script]}),async shot(path){writeFileSync(path,Buffer.from(await call(prefix+'/screenshot'),'base64'));},async close(){try{await call(prefix,undefined,'DELETE');}finally{await stopGroup(driver);writeFileSync(root+'/driver.log',log);}}};
}
