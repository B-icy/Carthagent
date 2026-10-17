#!/usr/bin/env node
/** Unix-only command and native-theme smoke tests in an isolated OpenCode PTY. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { selectNativePtyRuntime } from './native-pty-runtime.mjs';

if (process.platform === 'win32') {
  console.log('Native PTY smoke skipped: the Python PTY implementation is Unix-only.');
  process.exit(0);
}

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const runtime = await import(pathToFileURL(resolve(root, 'lib/opencode/runtime.mjs')).href);
const selected = await selectNativePtyRuntime({ runtime, root });
const { binary, identity: runtimeIdentity } = selected;
console.log(JSON.stringify({ selectedNativeRuntime: runtimeIdentity, independentlyVerifiedRuntime: selected.verified }));
const plugin = resolve(process.argv[2] ?? resolve(root, 'plugins/carthagent'));
const themeState = mkdtempSync(join(tmpdir(), 'ctg-theme-reload-'));
const probes = [
  { command: '/ctg-status', expect: `OpenCode ${runtimeIdentity.version}` },
  { command: '/ctg-workspace', expect: 'CARTHAGENT' },
  { command: '/help', expect: 'Carthagent commands', postSubmitMarker: '(/ctg-help)' },
  { command: '/ctg-help', expect: 'Carthagent commands' },
  { command: '/compact', expect: '/compact requires an open session.' },
  {
    command: '/theme', commandArgs: 'carthage', expect: 'Theme changed to “carthage” (dark).', initialTheme: 'opencode', expectedTheme: 'carthage', color: '213,175,102', stateDir: themeState,
  },
  { command: '/ctg-status', expect: `OpenCode ${runtimeIdentity.version}`, initialTheme: 'carthage', expectedTheme: 'carthage', color: '213,175,102', stateDir: themeState, reuseState: true, expectStartupColor: true },
  { command: '/demo', expect: 'Carthagent offline demo · fixture passed', postSubmitMarker: 'ℹ pass 2' },
];

const failures = [];
try {
for (const probe of probes) {
  const args = [resolve(root, 'tools/native-pty-smoke.py'), '--binary', binary, '--plugin', plugin,
    '--node-executable', process.execPath, '--command', probe.command, '--expect', probe.expect, '--ready', '◆ CTG',
    ...(probe.secondEnter ? ['--second-enter'] : ['--confirm'])];
  for (const next of probe.next ?? []) args.push('--after-command', next.command, '--after-expect', next.expect);
  if (probe.postSubmitMarker) args.push('--post-submit-marker', probe.postSubmitMarker);
  if (probe.color) args.push('--expect-color', probe.color);
  if (probe.initialTheme) args.push('--initial-theme', probe.initialTheme);
  if (probe.initialTheme && !probe.reuseState) args.push('--write-initial-theme');
  if (probe.expectedTheme) args.push('--expect-theme', probe.expectedTheme);
  if (probe.stateDir) args.push('--state-dir', probe.stateDir);
  if (probe.commandArgs) args.push('--command-args', probe.commandArgs);
  if (probe.reuseState) args.push('--reuse-state');
  if (probe.expectStartupColor) args.push('--expect-startup-color');
  const result = spawnSync('python3', args, { cwd: root, stdio: 'inherit', timeout: 90_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) failures.push(`${probe.command}: exit ${result.status ?? 'unknown'}`);
}
} finally {
  rmSync(themeState, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`Native PTY acceptance failures (${failures.length}):\n${failures.map(value => `- ${value}`).join('\n')}`);
  process.exit(1);
}
