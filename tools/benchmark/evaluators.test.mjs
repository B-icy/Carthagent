import test from 'node:test';import assert from 'node:assert/strict';
import{mkdtempSync,mkdirSync,existsSync,cpSync}from'node:fs';import{join,dirname}from'node:path';import{fileURLToPath}from'node:url';
import{evaluateShop}from'./eval-shop.mjs';import{evaluateVoxel}from'./eval-voxel.mjs';import{command}from'./eval-common.mjs';
const fixtures=join(dirname(fileURLToPath(import.meta.url)),'fixtures/shop');
test('full shop evaluator passes reference and rejects rounding/idempotency mutants over real HTTP/Firefox',async()=>{
 const base='/home/baissi/benchmarks/infrastructure-tests';mkdirSync(base,{recursive:true});const root=mkdtempSync(join(base,'shop-'));
 for(const mutant of ['', 'round','idempotency']){const score=await evaluateShop(fixtures,join(root,mutant||'reference'),{environment:{FIXTURE_MUTANT:mutant}});if(!mutant)assert.equal(score.passed,score.total,JSON.stringify(score));else assert.ok(score.results.some(r=>!r.passed&&r.name.includes(mutant==='round'?'exact-cent':'idempotent')),JSON.stringify(score));}
});
test('voxel evaluator regression on a copy of the retained v2 candidate, not an independent reference',async(t)=>{
 const original='/home/baissi/benchmarks/deepseek-jev-v2/voxel-plain/workspace';if(!existsSync(original)){t.skip('Historical candidate unavailable');return;}
 const base='/home/baissi/benchmarks/infrastructure-tests';mkdirSync(base,{recursive:true});const root=mkdtempSync(join(base,'voxel-')),workspace=join(root,'workspace');cpSync(original,workspace,{recursive:true,filter:path=>!['target','.git','.harness'].includes(path.split('/').at(-1))});const score=await evaluateVoxel(workspace,join(root,'evaluation'));assert.equal(score.passed,score.total,JSON.stringify(score));
});
test('evaluator children do not inherit supervisor credentials or NODE_OPTIONS',async()=>{process.env.BENCH_FAKE_SECRET='secret';const r=await command(process.execPath,['-e','console.log(process.env.BENCH_FAKE_SECRET || "clean")'],process.cwd());assert.equal(r.stdout.trim(),'clean');delete process.env.BENCH_FAKE_SECRET;});
