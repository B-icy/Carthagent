#!/usr/bin/env node
/** Unix-only command and native-theme smoke tests in an isolated OpenCode PTY. */
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolveOpenCode, runtimeIdentity } from '../lib/opencode/runtime.mjs';
import { loadNativeTestRuntime, preflightNativeTestRuntimeArtifact } from './native-runtime-identity.mjs';
import { selectNativePtyRuntime } from './native-pty-runtime.mjs';

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
console.log(JSON.stringify({ selectedNativeRuntime: selection.identity, independentlyVerifiedRuntime: selection.verified }));
const pythonEnv = { ...process.env };
for (const key of Object.keys(pythonEnv)) {
  if (key.toLowerCase() === 'ctg_runtime_github_token') delete pythonEnv[key];
}
const plugin = resolve(process.argv[2] ?? resolve(root, 'plugins/carthagent'));
const themeState = mkdtempSync(join(tmpdir(), 'ctg-theme-reload-'));
const probes = [
  { command: '/ctg-status', expect: `OpenCode ${selection.identity.version}` },
  { command: '/ctg-workspace', expect: 'CARTHAGENT' },
  { command: '/help', expect: 'Carthagent commands', postSubmitMarker: '(/ctg-help)' },
  { command: '/ctg-help', expect: 'Carthagent commands' },
  { command: '/compact', expect: '/compact requires an open session.', secondEnter: true },
  {
    command: '/theme', commandArgs: 'carthage', expect: 'Theme changed to “carthage” (dark).', initialTheme: 'opencode', expectedTheme: 'carthage', color: '213,175,102', stateDir: themeState,
  },
  { command: '/ctg-status', expect: `OpenCode ${selection.identity.version}`, initialTheme: 'carthage', expectedTheme: 'carthage', color: '213,175,102', stateDir: themeState, reuseState: true, expectStartupColor: true },
  { command: '/demo', expect: 'Carthagent offline demo · fixture passed', postSubmitMarker: 'ℹ pass 2' },
];

try {
  for (const probe of probes) {
    const args = [resolve(root, 'tools/native-pty-smoke.py'), '--binary', binary, '--plugin', plugin,
      '--node-executable', process.execPath, '--command', probe.command, '--expect', probe.expect, '--ready', '◆ CTG',
      ...(probe.secondEnter ? ['--second-enter'] : ['--confirm'])];
    for (const next of probe.next ?? []) args.push('--after-command', next.command, '--after-expect', next.expect);
    if (probe.postSubmitMarker) args.push('--post-submit-marker', probe.postSubmitMarker);
    if (probe.color) args.push('--expect-color', probe.color);
    if (probe.initialTheme) args.push('--initial-theme', probe.initialTheme);
    if (probe.commandArgs) args.push('--command-args', probe.commandArgs);
    if (probe.expectedTheme) args.push('--expect-theme', probe.expectedTheme);
    if (probe.expectStartupColor) args.push('--expect-startup-color');
    if (probe.initialTheme && !probe.reuseState) args.push('--write-initial-theme');
    if (probe.stateDir) args.push('--state-dir', probe.stateDir);
    if (probe.reuseState) args.push('--reuse-state');
    const independentlyVerifiedSha256 = selection.verified.binarySha256
      ?? process.env.CTG_NATIVE_PTY_EXPECTED_SHA256?.toLowerCase()
      ?? selection.identity.binarySha256;
    const currentSha256 = createHash('sha256').update(await readFile(binary)).digest('hex');
    if (currentSha256 !== independentlyVerifiedSha256) throw new Error('Selected OpenCode binary changed after native runtime verification.');
    args.push('--expected-sha256', independentlyVerifiedSha256);
    const result = spawnSync('python3', args, { cwd: root, env: pythonEnv, stdio: 'inherit', timeout: 90_000 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Native PTY probe ${probe.command} failed with status ${result.status ?? 'unknown'}.`);
  }
} finally {
  rmSync(themeState, { recursive: true, force: true });
}
