import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import guard from './guard.ts';

const key = sessionID => `benchmark/${sessionID}/tools`;
function harness(storage = new Map()) {
  const hooks = new Map();
  const eventQueues=[];
  const ctx = {
    session:{hook:async(name,callback)=>{hooks.set(`session:${name}`,callback);return{dispose:async()=>{}};}},
    tool:{hook:async(name,callback)=>{hooks.set(`tool:${name}`,callback);return{dispose:async()=>{}};}},
    storage:{
      get:async name=>storage.get(name),
      set:async(name,value)=>{storage.set(name,structuredClone(value));},
    },
    event:{subscribe:({signal})=>({[Symbol.asyncIterator]:async function*(){
      const queue=[];const waiters=[];eventQueues.push({queue,waiters});
      const onAbort=()=>{for(const waiter of waiters.splice(0))waiter();};
      signal.addEventListener('abort',onAbort,{once:true});
      try {
        while(!signal.aborted) {
          if(queue.length){yield queue.shift();continue;}
          await new Promise(resolve=>waiters.push(resolve));
        }
      } finally {signal.removeEventListener('abort',onAbort);}
    }})},
  };
  return { hooks, storage, ctx, emit:event=>{for(const {queue,waiters} of eventQueues){queue.push(event);for(const waiter of waiters.splice(0))waiter();}} };
}

test('parallel per-session admissions reserve the final slot once, replay IDs idempotently and persist across guard restart',async()=>{
  const temp=mkdtempSync(join(tmpdir(),'benchmark-guard-'));
  const old={limit:process.env.BENCH_TOOL_LIMIT,log:process.env.BENCH_GUARD_LOG,home:process.env.CTG_OPENCODE_HOME};
  process.env.BENCH_TOOL_LIMIT='2';
  process.env.BENCH_GUARD_LOG=join(temp,'guard.jsonl');
  process.env.CTG_OPENCODE_HOME=temp;
  const state=harness();
  let dispose=await guard(state.ctx);
  try {
    state.storage.set(key('session-a'),[{id:'already-used',tool:'read',admitted:true,at:1}]);
    const before=state.hooks.get('tool:execute.before');
    const results=await Promise.allSettled(Array.from({length:12},(_,index)=>before({id:`call-${index}`,tool:'read',sessionID:'session-a'})));
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(results.filter(result=>result.status==='rejected').length,11);
    assert.equal(state.storage.get(key('session-a')).filter(row=>row.admitted).length,2);

    // A duplicate delivery of the admitted call ID is idempotent, including
    // after a plugin restart which discards in-memory state.
    const admittedID=state.storage.get(key('session-a')).find(row=>row.id.startsWith('call-')&&row.admitted).id;
    await assert.rejects(before({id:admittedID,tool:'read',sessionID:'session-a'}),/invocation ID was already reserved/);
    assert.equal(state.storage.get(key('session-a')).filter(row=>row.admitted).length,2);
    await dispose();
    const other=harness(state.storage);
    dispose=await guard(other.ctx);
    await assert.rejects(other.hooks.get('tool:execute.before')({id:admittedID,tool:'read',sessionID:'session-a'}),/invocation ID was already reserved/);
    await other.hooks.get('tool:execute.before')({id:'neighbor',tool:'read',sessionID:'session-b'});
    assert.equal(other.storage.get(key('session-b')).filter(row=>row.admitted).length,1);
    await assert.rejects(other.hooks.get('tool:execute.before')({id:'new-after-restart',tool:'read',sessionID:'session-a'}),/budget exhausted/);
    assert.equal(other.storage.get(key('session-a')).filter(row=>row.admitted).length,2);
    await other.hooks.get('tool:execute.before')({id:'neighbor-after-rejection',tool:'read',sessionID:'session-b'});
    await assert.rejects(other.hooks.get('tool:execute.before')({id:'neighbor-at-cap',tool:'read',sessionID:'session-b'}),/budget exhausted/);
    assert.equal(other.storage.get(key('session-b')).filter(row=>row.admitted).length,2);
    assert.equal(JSON.parse(readFileSync(process.env.BENCH_GUARD_LOG,'utf8').trim().split('\n').at(-1)).sessionID,'session-b');
  } finally {
    await dispose();
    for(const [name,value] of Object.entries({BENCH_TOOL_LIMIT:old.limit,BENCH_GUARD_LOG:old.log,CTG_OPENCODE_HOME:old.home})) {
      if(value===undefined) delete process.env[name]; else process.env[name]=value;
    }
    rmSync(temp,{recursive:true,force:true});
  }
});

test('Code Mode same-tool calls sharing an execute ID fail closed as ambiguous, not exhausted',async()=>{
  const temp=mkdtempSync(join(tmpdir(),'benchmark-guard-codemode-'));
  const old={limit:process.env.BENCH_TOOL_LIMIT,log:process.env.BENCH_GUARD_LOG,home:process.env.CTG_OPENCODE_HOME};
  process.env.BENCH_TOOL_LIMIT='3';process.env.BENCH_GUARD_LOG=join(temp,'guard.jsonl');process.env.CTG_OPENCODE_HOME=temp;
  const state=harness();let dispose=await guard(state.ctx);
  try{
    const before=state.hooks.get('tool:execute.before');
    const invoke=(tool,id='execute-1')=>before({id,tool,sessionID:'codemode-session'});
    await invoke('execute');await invoke('carthagent.delivery_plan');
    let nestedExecutions=0;
    const executeNested=async()=>{await invoke('carthagent.delivery_plan');nestedExecutions++;};
    const repeated=await Promise.allSettled([executeNested(),executeNested()]);
    assert.equal(repeated.filter(result=>result.status==='rejected').length,2);
    for(const result of repeated)if(result.status==='rejected'){
      assert.match(result.reason.message,/attribution unavailable/);
      assert.doesNotMatch(result.reason.message,/exhausted/);
    }
    assert.equal(nestedExecutions,0,'ambiguous calls must be rejected at the pre-execution hook boundary');
    assert.equal(state.storage.get(key('codemode-session')).filter(row=>row.admitted).length,2,'ambiguous repeated calls must not consume or appear admitted against the remaining slot');
    assert.equal(state.storage.get(key('codemode-session')).length,2,'ambiguous calls do not create inferred reservations');
    await invoke('carthagent.delivery_check','execute-2');
    assert.deepEqual(state.storage.get(key('codemode-session')).map(row=>({tool:row.tool,admitted:row.admitted})),[
      {tool:'execute',admitted:true},{tool:'carthagent.delivery_plan',admitted:true},{tool:'carthagent.delivery_check',admitted:true},
    ]);
    const log=readFileSync(process.env.BENCH_GUARD_LOG,'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(log.map(row=>row.tool),['execute','carthagent.delivery_plan','carthagent.delivery_check']);
  }finally{
    await dispose();
    for(const[name,value]of Object.entries({BENCH_TOOL_LIMIT:old.limit,BENCH_GUARD_LOG:old.log,CTG_OPENCODE_HOME:old.home}))if(value===undefined)delete process.env[name];else process.env[name]=value;
    rmSync(temp,{recursive:true,force:true});
  }
});

test('failed durable reservation is fail-closed and a cancelled queued call consumes no slot',async()=>{
  const temp=mkdtempSync(join(tmpdir(),'benchmark-guard-fail-'));
  const old={limit:process.env.BENCH_TOOL_LIMIT,log:process.env.BENCH_GUARD_LOG,home:process.env.CTG_OPENCODE_HOME};
  process.env.BENCH_TOOL_LIMIT='1';
  process.env.BENCH_GUARD_LOG=join(temp,'guard.jsonl');
  process.env.CTG_OPENCODE_HOME=temp;
  const storage=new Map();
  const state=harness(storage);
  let failWrite=true, releaseRead, enteredRead;
  const entered=new Promise(resolve=>{enteredRead=resolve;});
  let holdNextRead=false;
  state.ctx.storage.get=async name=>{
    if(name===key('queued-session')&&holdNextRead){
      holdNextRead=false;
      await new Promise(resolve=>{releaseRead=resolve;enteredRead();});
    }
    return storage.get(name);
  };
  state.ctx.storage.set=async(name,value)=>{
    if(failWrite){failWrite=false;throw Error('durable storage unavailable');}
    storage.set(name,structuredClone(value));
  };
  let dispose=await guard(state.ctx);
  try {
    const before=state.hooks.get('tool:execute.before');
    await assert.rejects(before({id:'write-fails',tool:'read',sessionID:'session-write-fails'}),/durable storage unavailable/);
    assert.equal(storage.has(key('session-write-fails')),false);
    holdNextRead=true;
    const owner=before({id:'slow-owner',tool:'read',sessionID:'queued-session'});
    await entered;
    state.emit({type:'session.execution.interrupted',data:{sessionID:'queued-session'}});
    await new Promise(resolve=>setImmediate(resolve));
    const cancelled=before({id:'cancelled',tool:'read',sessionID:'queued-session'});
    await before({id:'independent-session',tool:'read',sessionID:'independent'});
    assert.equal(storage.get(key('independent')).filter(row=>row.admitted).length,1,'different session admissions do not wait on the held session queue');
    releaseRead();
    await assert.rejects(owner,/cancelled before reservation/);
    await assert.rejects(cancelled,/cancelled before reservation/);
    assert.equal(storage.has(key('queued-session')),false,'interrupted in-flight admission must not write a reservation');
    await before({id:'neighbor',tool:'read',sessionID:'neighbor'});
    assert.equal(storage.get(key('neighbor')).filter(row=>row.admitted).length,1);
    holdNextRead=true;
    const draining=before({id:'drain-owner',tool:'read',sessionID:'draining'});
    await entered;
    const unloading=dispose();
    releaseRead();
    await assert.rejects(draining,/cancelled before reservation/);
    await unloading;
    assert.equal(storage.has(key('draining')),false,'unload waits for queued callbacks without admitting late work');
  } finally {
    releaseRead?.();
    await dispose();
    for(const [name,value] of Object.entries({BENCH_TOOL_LIMIT:old.limit,BENCH_GUARD_LOG:old.log,CTG_OPENCODE_HOME:old.home})) {
      if(value===undefined) delete process.env[name]; else process.env[name]=value;
    }
    rmSync(temp,{recursive:true,force:true});
  }
});
