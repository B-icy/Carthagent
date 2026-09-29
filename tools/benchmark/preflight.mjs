import { readdirSync,mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { command } from './eval-common.mjs';
import { ROOT } from './runner.mjs';
import { REPO,createFreeze,frozenFiles } from './freeze.mjs';
import { sha } from './runtime.mjs';
// No paid calls. Rebuild readiness after any code change. Output directory is exclusive.
export async function preflight(out){
 mkdirSync(out,{recursive:false});
 const files=Object.fromEntries(frozenFiles().map(f=>[f,sha(readFileSync(f))]));
 const tests=readdirSync(join(REPO,'tools/benchmark')).filter(f=>f.endsWith('.test.mjs')).map(f=>'tools/benchmark/'+f);
 const focused=await command(process.execPath,['--test',...tests,'tools/benchmark/selftest.mjs'],REPO,{},240000);writeFileSync(join(out,'focused.log'),focused.stdout+focused.stderr);
 const quality=await command('npm',['run','quality'],REPO,{},240000);writeFileSync(join(out,'quality.log'),quality.stdout+quality.stderr);
 const livePath=join(ROOT,'live-preflight/readiness.json');const live=JSON.parse(readFileSync(livePath,'utf8'));
 const result={passed:focused.code===0&&!focused.error&&quality.code===0&&!quality.error&&live.passed===true,focused:{code:focused.code,error:focused.error},quality:{code:quality.code,error:quality.error},live:{path:livePath,sha256:sha(readFileSync(livePath))},files,at:new Date().toISOString()};
 const path=join(out,'readiness.json');writeFileSync(path,JSON.stringify(result,null,2));if(!result.passed)throw Error('Readiness failed; inspect logs');return path;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(!process.argv[2])throw Error('Usage: node tools/benchmark/preflight.mjs NEW_OUTPUT_DIRECTORY [--freeze]');
 const path=await preflight(process.argv[2]);if(process.argv[3]==='--freeze')createFreeze(ROOT,path);console.log(path);
}
