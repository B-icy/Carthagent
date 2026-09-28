import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
export const wait=ms=>new Promise(r=>setTimeout(r,ms));
export async function freePort(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
export function checks(){const results=[];return {results,async check(name,fn){try{await fn();results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:String(e.message).slice(0,1800)});}},summary(){return {passed:results.filter(r=>r.passed).length,total:results.length,results};}};}
export function command(cmd,args,cwd,env={},timeout=120000){const r=spawnSync(cmd,args,{cwd,env:{...process.env,PATH:'/home/baissi/.cargo/bin:'+process.env.PATH,...env},encoding:'utf8',timeout,maxBuffer:8000000});return {code:r.status,signal:r.signal,error:r.error?.message,stdout:r.stdout||'',stderr:r.stderr||''};}
export async function serve(cmd,args,cwd,env,port,logPath){
 const p=spawn(cmd,args,{cwd,env:{...process.env,...env},detached:true,stdio:['ignore','pipe','pipe']});let log='';p.stdout.on('data',c=>log+=c);p.stderr.on('data',c=>log+=c);let error;p.on('error',e=>error=e);
 const stop=async()=>{try{process.kill(-p.pid,'SIGTERM');}catch{}await wait(150);try{process.kill(-p.pid,'SIGKILL');}catch{}if(logPath)writeFileSync(logPath,log);};
 for(let i=0;i<100;i++){if(error||p.exitCode!==null){await stop();throw Error('Launch failed: '+(error?.message||log.slice(-1500)));}try{await fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(300)});return {url:`http://127.0.0.1:${port}`,stop};}catch{}await wait(100);}
 await stop();throw Error('Server readiness timeout: '+log.slice(-1000));
}
export async function json(url,path,body){const r=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(5000)});return {status:r.status,body:await r.json()};}
export async function browser(root){
 mkdirSync(root,{recursive:true});const port=await freePort();
 const driver=spawn('geckodriver',['--port',String(port),'--profile-root',root],{stdio:['ignore','ignore','pipe'],env:{...process.env,MOZ_HEADLESS:'1'}});let log='';driver.stderr.on('data',c=>log+=c);let failure;driver.on('error',e=>failure=e);
 const base=`http://127.0.0.1:${port}`;
 async function call(path,body,method=body===undefined?'GET':'POST'){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000)});const d=await r.json();if(!r.ok||d.value?.error)throw Error(JSON.stringify(d.value));return d.value;}
 let session;
 try{for(let i=0;i<100;i++){if(failure)throw failure;try{await call('/status');break;}catch{}await wait(100);}session=(await call('/session',{capabilities:{alwaysMatch:{browserName:'firefox','moz:firefoxOptions':{args:['-headless']}}}})).sessionId;}catch(e){driver.kill();writeFileSync(root+'/driver.log',log);throw Error('Browser infrastructure: '+e.message);}
 const prefix='/session/'+session;
 return {call:(p,b,m)=>call(prefix+p,b,m),exec:script=>call(prefix+'/execute/sync',{script:'return eval(arguments[0]);',args:[script]}),async shot(path){writeFileSync(path,Buffer.from(await call(prefix+'/screenshot'),'base64'));},async close(){try{await call(prefix,undefined,'DELETE');}finally{driver.kill();writeFileSync(root+'/driver.log',log);}}};
}
