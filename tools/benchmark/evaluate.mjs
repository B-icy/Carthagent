import { readFileSync,writeFileSync,mkdirSync,existsSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateLedger } from './eval-ledger.mjs';
import { evaluateShop } from './eval-shop.mjs';
import { evaluateVoxel } from './eval-voxel.mjs';
import { MATRIX } from './tasks.mjs';
import { ROOT } from './runner.mjs';
const [task,arm]=process.argv.slice(2);
for(const [t,a] of task==='matrix'?MATRIX:[[task,arm]]){
 if(!['ledger','shop','voxel'].includes(t)||!['plain','harness','jev'].includes(a))throw Error('Invalid evaluation');
 const run=join(ROOT,`${t}-${a}`),out=join(run,'evaluation');if(existsSync(out))throw Error('Evaluation exists: refusing overwrite');mkdirSync(out,{recursive:true});
 const score=await ({ledger:evaluateLedger,shop:evaluateShop,voxel:evaluateVoxel}[t])(join(run,'workspace'),out);
 const result={task:t,arm:a,execution:JSON.parse(readFileSync(join(run,'result.json'),'utf8')),score,evaluatedAt:new Date().toISOString()};writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
