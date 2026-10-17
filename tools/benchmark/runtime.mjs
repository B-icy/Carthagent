import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
export const ENGINE_RUNTIME = 'opencode-2';
export const isolatedHome = config => join(config, 'home');
export function safeEnv(extra = {}, home = undefined) {
  const allowed = { PATH: process.env.PATH || '', LANG: process.env.LANG || 'C.UTF-8', CI: '1', NODE_ENV: 'production' };
  if (home) { mkdirSync(home, { recursive: true }); allowed.HOME = home; allowed.XDG_CONFIG_HOME = join(home, '.config'); allowed.XDG_DATA_HOME = join(home, '.local/share'); allowed.XDG_CACHE_HOME = join(home, '.cache'); }
  return { ...allowed, ...extra };
}
export const sha = value => createHash('sha256').update(value).digest('hex');
export function provisionTools(config) {
  mkdirSync(config, { recursive: true });
  const receipt = { runtime: ENGINE_RUNTIME, opencodePackage: '@opencode/client@2.0.32', home: isolatedHome(config), noPiDiscovery: true };
  writeFileSync(join(config, 'runtime.json'), JSON.stringify(receipt, null, 2), { flag: 'wx' });
  return receipt;
}
export async function stopGroup(child, graceMs = 250) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  await new Promise(r => setTimeout(r, graceMs));
  try { process.kill(-child.pid, 'SIGKILL'); } catch {}
}
