import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveOwnedOpenCode } from '../lib/opencode/runtime.mjs';

const directory = process.env.CTG_OWNED_OPENCODE_RUNTIME;
if (!directory) throw new Error('Set CTG_OWNED_OPENCODE_RUNTIME to an extracted, hash-verified CTG runtime artifact.');

const binary = await resolveOwnedOpenCode(directory);
const root = await mkdtemp(path.join(tmpdir(), 'ctg-owned-opencode-smoke-'));
const child = await import('node:child_process');
const { runtimeEnvironment } = await import('../lib/opencode/runtime.mjs');
const env = runtimeEnvironment({ root });
try {
  const version = await new Promise((resolve, reject) => {
    const process = child.spawn(binary, ['--version'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    process.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
    process.once('error', reject);
    process.once('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(`owned CLI exited ${code}`)));
  });
  if (version !== 'opencode v0.0.0-ctg.2.0.32') throw new Error(`Unexpected owned CLI identity: ${version}`);
  const files = await import('node:fs/promises');
  for (const key of ['HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'OPENCODE_DB']) {
    const value = env[key];
    if (!value || !path.resolve(value).startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`${key} escaped disposable runtime root: ${value}`);
  }
  await files.mkdir(env.OPENCODE_CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(path.join(env.OPENCODE_CONFIG_DIR, 'fixture-marker'), 'isolated');
  console.log(JSON.stringify({ binary, version, profileRoot: root, result: 'PASS' }, null, 2));
} finally {
  const persisted = await readFile(path.join(root, 'config', 'opencode', 'fixture-marker'), 'utf8').catch(() => undefined);
  if (persisted !== 'isolated') throw new Error('Temporary profile fixture did not persist inside the isolated root.');
  await rm(root, { recursive: true, force: true });
}
