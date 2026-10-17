#!/usr/bin/env node
/** Unix-only command and native-theme smoke tests in an isolated OpenCode PTY. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.platform === 'win32') {
  console.log('Native PTY smoke skipped: the Python PTY implementation is Unix-only.');
  process.exit(0);
}

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
// Always use the same resolver that the shipped launcher uses. In particular,
// acceptance must not be redirected to a separately supplied selector module.
const runtime = await import(pathToFileURL(resolve(root, 'lib/opencode/runtime.mjs')).href);
const explicitBinary = process.env.CTG_OPENCODE_BIN ?? process.env.OPENCODE_BIN;
let explicitDigest;
if (explicitBinary) {
  if (!explicitBinary.includes('/') && !explicitBinary.includes('\\')) {
    throw new Error('An explicit native PTY binary must be a filesystem path so its bytes can be verified before execution.');
  }
  const expected = process.env.CTG_NATIVE_PTY_EXPECTED_SHA256;
  if (!/^[a-f0-9]{64}$/i.test(expected ?? '')) {
    throw new Error('Explicit native PTY binary requires CTG_NATIVE_PTY_EXPECTED_SHA256, captured independently before execution.');
  }
  const explicitPath = resolve(explicitBinary);
  explicitDigest = createHash('sha256').update(await readFile(explicitPath)).digest('hex');
  if (explicitDigest !== expected.toLowerCase()) {
    throw new Error(`Explicit native PTY binary SHA-256 mismatch before runtime selection: ${explicitDigest}`);
  }
}
const binaryOptions = explicitBinary ? { binary: explicitBinary } : {};
if (typeof runtime.resolveOpenCode !== 'function' || typeof runtime.runtimeIdentity !== 'function') {
  throw new Error('Native PTY acceptance requires resolveOpenCode(options) and runtimeIdentity(binary, options) from the production runtime selector.');
}
const binary = await runtime.resolveOpenCode(binaryOptions);
const runtimeIdentity = await runtime.runtimeIdentity(binary, binaryOptions);
if (explicitBinary) {
  const actual = createHash('sha256').update(await readFile(runtimeIdentity.binaryPath ?? binary)).digest('hex');
  if (actual !== explicitDigest) throw new Error(`Explicit native PTY binary changed during runtime selection: ${actual}`);
} else if (runtimeIdentity.kind !== 'ctg-owned') {
  throw new Error(`Default native PTY must select the owned runtime, got ${runtimeIdentity.kind}.`);
}
if (!runtimeIdentity.binaryPath || resolve(runtimeIdentity.binaryPath) !== resolve(binary)) {
  throw new Error(`Runtime identity does not bind the selected executable: selected ${binary}, identity ${runtimeIdentity.binaryPath ?? 'missing'}.`);
}
console.log(JSON.stringify({ selectedNativeRuntime: runtimeIdentity }));
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
