import { copyFileSync, mkdirSync, readFileSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
export const ENGINE_ROOT = '/home/baissi/.nvm/versions/node/v26.7.0/lib/node_modules/@earendil-works/pi-coding-agent';
export const ENGINE = join(ENGINE_ROOT, 'dist/cli.js');
export function safeEnv(extra = {}) {
  return { HOME: '/home/baissi', USER: 'baissi', PATH: `/home/baissi/.cargo/bin:${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin:/snap/bin`, LANG: 'C.UTF-8', CI: '1', ...extra };
}
export const sha = value => createHash('sha256').update(value).digest('hex');
export function provisionTools(config, source = '/home/baissi/.pi/agent/bin') {
  mkdirSync(join(config, 'bin'), { recursive: true });
  return Object.fromEntries(['fd', 'rg'].map(name => {
    const target = join(config, 'bin', name);
    copyFileSync(join(source, name), target); chmodSync(target, 0o755);
    const r = spawnSync(target, ['--version'], { env: safeEnv(), encoding: 'utf8', timeout: 5000 });
    if (r.status !== 0) throw Error(`Offline tool unavailable: ${name}`);
    return [name, { sha256: sha(readFileSync(target)), version: r.stdout.trim() }];
  }));
}
export async function stopGroup(child, graceMs = 250) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  await new Promise(r => setTimeout(r, graceMs));
  try { process.kill(-child.pid, 'SIGKILL'); } catch {}
}
