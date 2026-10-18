#!/usr/bin/env node
/** Unix-only command and native-theme smoke tests in an isolated OpenCode PTY. */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolveOpenCode, runtimeIdentity } from '../lib/opencode/runtime.mjs';
import { loadNativeTestRuntime, preflightNativeTestRuntimeArtifact } from './native-runtime-identity.mjs';
import { selectNativePtyRuntime } from './native-pty-runtime.mjs';
import { nativePtySmokeArgs } from './native-pty-invocation.mjs';

if (process.platform === 'win32') {
  console.log('Native PTY smoke skipped: the Python PTY implementation is Unix-only.');
  process.exit(0);
}

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const selection = await selectNativePtyRuntime({
  runtime: { resolveOpenCode, runtimeIdentity },
  root,
  identityTools: { loadNativeTestRuntime, preflightNativeTestRuntimeArtifact },
});
const binary = selection.binary;
const plugin = resolve(process.argv[2] ?? resolve(root, 'plugins/carthagent'));
const probes = [
  { command: '/ctg-status', expect: 'OpenCode 2.0.32' },
  { command: '/ctg-workspace', expect: 'CARTHAGENT', dismissCompletion: true },
  { command: '/help', expect: 'Carthagent commands', postSubmitMarker: '(/ctg-help)', dismissCompletion: true },
  { command: '/ctg-help', expect: 'Carthagent commands', dismissCompletion: true },
  { command: '/compact', expect: '/compact requires an open session.', secondEnter: true, dismissCompletion: true },
  {
    command: '/theme carthage', expect: 'Theme “carthage” saved to native OpenCode cli.json.', postSubmitMarker: 'Restart the native CLI to apply it.', dismissCompletion: true,
  },
  { command: '/ctg-status', expect: 'OpenCode 2.0.32', initialTheme: 'carthage', color: '213,175,102' },
];

for (const probe of probes) {
  const currentSha256 = createHash('sha256').update(await readFile(binary)).digest('hex');
  if (currentSha256 !== selection.binarySha256) throw new Error('Selected OpenCode binary changed after native runtime verification.');
  const args = nativePtySmokeArgs({ root, binary, plugin, selection, probe });
  const result = spawnSync('python3', args, { cwd: root, stdio: 'inherit', timeout: 90_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
