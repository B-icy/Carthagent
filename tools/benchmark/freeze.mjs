import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_ROOT, sha } from './runtime.mjs';
export const REPO = resolve(dirname(fileURLToPath(import.meta.url)),'../..');
function walk(root) { return readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(root,e.name)):[join(root,e.name)]); }
export function frozenFiles() {
  return [...walk(join(REPO,'tools/benchmark')), ...walk(join(REPO,'lib')), join(REPO,'extensions/delivery.ts'), join(REPO,'docs/tested-planning.md'), join(REPO,'skills/software-delivery/SKILL.md'), ...walk(join(ENGINE_ROOT,'dist')), join(ENGINE_ROOT,'package.json'), '/home/baissi/.pi/agent/bin/fd','/home/baissi/.pi/agent/bin/rg'];
}
export function createFreeze(root, readinessPath) {
  const readiness = JSON.parse(readFileSync(readinessPath,'utf8'));
  if (readiness.passed !== true) throw Error('Passing readiness receipt required');
  const files=Object.fromEntries(frozenFiles().map(f=>[f,sha(readFileSync(f))]));
  if (JSON.stringify(files)!==JSON.stringify(readiness.files)) throw Error('Readiness source hashes differ');
  if (!readiness.live || sha(readFileSync(readiness.live.path))!==readiness.live.sha256) throw Error('Live readiness receipt missing or changed');
  const value={version:3,at:new Date().toISOString(),files,readiness:{path:readinessPath,sha256:sha(readFileSync(readinessPath))},node:process.version};
  writeFileSync(join(root,'freeze.json'),JSON.stringify(value,null,2),{flag:'wx'});return value;
}
export function verifyFreeze(root) {
  const value=JSON.parse(readFileSync(join(root,'freeze.json'),'utf8'));
  if(value.version!==3 || value.node!==process.version)throw Error('Freeze version/runtime mismatch');
  const current=frozenFiles();
  if(current.length!==Object.keys(value.files).length)throw Error('Frozen file set changed');
  for(const f of current)if(sha(readFileSync(f))!==value.files[f])throw Error(`Frozen source changed: ${f}`);
  if(sha(readFileSync(value.readiness.path))!==value.readiness.sha256)throw Error('Readiness receipt changed');
  const readiness=JSON.parse(readFileSync(value.readiness.path,'utf8'));
  if(sha(readFileSync(readiness.live.path))!==readiness.live.sha256)throw Error('Live readiness receipt changed');
  return value;
}
if(process.argv[1]===fileURLToPath(import.meta.url))createFreeze(resolve(process.argv[2]),resolve(process.argv[3]));
