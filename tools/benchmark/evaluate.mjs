import { readFileSync,writeFileSync,mkdirSync,existsSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateLedger } from './eval-ledger.mjs';
import { evaluateShop } from './eval-shop.mjs';
import { evaluateVoxel } from './eval-voxel.mjs';
import { command } from './eval-common.mjs';
import { MATRIX } from './tasks.mjs';
import { ROOT } from './runner.mjs';
import { verifyFreeze } from './freeze.mjs';
const [task,arm]=process.argv.slice(2);
verifyFreeze(ROOT);
for(const [t,a] of task==='matrix'?MATRIX:[[task,arm]]){
 if(!['ledger','shop','voxel'].includes(t)||!['plain','harness','jev'].includes(a))throw Error('Invalid evaluation');
 const run=join(ROOT,`${t}-${a}`),out=join(run,'evaluation');
 if(!existsSync(join(run,'result.json'))){console.log(JSON.stringify({task:t,arm:a,status:'not-run'}));continue;}
 const execution=JSON.parse(readFileSync(join(run,'result.json'),'utf8'));
 if(['infrastructure-error','process-error','missing-terminal-message','model-error'].includes(execution.status)){console.log(JSON.stringify({task:t,arm:a,status:'not-scored-infrastructure',execution}));continue;}
 mkdirSync(out); // exclusive and race-safe, never overwrite previous evidence
 let score;
 try{score=await ({ledger:evaluateLedger,shop:evaluateShop,voxel:evaluateVoxel}[t])(join(run,'workspace'),out);}catch(e){score={infrastructureError:e.message};}
 const candidateTests=await command(t==='voxel'?'/home/baissi/.cargo/bin/cargo':'npm',['test'],join(run,'workspace'));
 writeFileSync(join(out,'candidate-tests.json'),JSON.stringify(candidateTests,null,2));
 const result={task:t,arm:a,execution,score,candidateTests:{code:candidateTests.code,error:candidateTests.error},evaluatedAt:new Date().toISOString()};writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
