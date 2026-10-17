import { Plugin } from '@opencode/plugin';
import guard from '../guard.js';
import advisor from '../advisor.js';
import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

export default Plugin.define({
  id:'ctg.benchmark',
  setup(ctx) {
    guard(ctx);
    advisor(ctx);
    const log=process.env.BENCH_TURN_LOG;
    const cap=Number(process.env.BENCH_TURN_LIMIT || 120);
    if(!Number.isInteger(cap) || cap<1 || cap>120) throw Error('Invalid productive turn limit');
    if(log){
      mkdirSync(dirname(log),{recursive:true});
      const turns=new Map<string,number>();
      ctx.session.hook('context',(event:any)=>{
        if(event.kind!=='primary')return;
        const current=turns.get(event.sessionID)||0;
        if(current>=cap){
          event.tools={};
          event.system.push({type:'text',text:'Productive model-turn budget is exhausted. Stop and report verified work.'});
          return;
        }
        const next=current+1;
        turns.set(event.sessionID,next);
        appendFileSync(log,JSON.stringify({turns:next,sessionID:event.sessionID,kind:event.kind})+'\n');
      });
    }
  },
});
