#!/usr/bin/env node
/** Unix-only command and native-theme smoke tests in an isolated OpenCode PTY. */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform === 'win32') {
  console.log('Native PTY smoke skipped: the Python PTY implementation is Unix-only.');
  process.exit(0);
}

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const binary = process.env.CTG_OPENCODE_BIN ?? process.env.OPENCODE_BIN ?? 'opencode';
const plugin = resolve(process.argv[2] ?? resolve(root, 'plugins/carthagent'));
const probes = [
  { command: '/ctg-status', expect: 'OpenCode 2.0.32' },
  { command: '/ctg-workspace', expect: 'CARTHAGENT' },
  { command: '/help', expect: 'Carthagent commands' },
  { command: '/ctg-help', expect: 'Carthagent commands' },
  { command: '/compact', expect: '/compact requires an open session.', secondEnter: true },
  {
    command: '/theme carthage', expect: 'Theme “carthage” saved',
    next: [{ command: '/ctg-workspace', expect: 'CARTHAGENT' }],
    color: '230,196,128',
  },
];

for (const probe of probes) {
  const args = [resolve(root, 'tools/native-pty-smoke.py'), '--binary', binary, '--plugin', plugin,
    '--command', probe.command, '--expect', probe.expect, '--ready', '◆ CTG',
    ...(probe.secondEnter ? ['--second-enter'] : ['--confirm'])];
  for (const next of probe.next ?? []) args.push('--after-command', next.command, '--after-expect', next.expect);
  if (probe.color) args.push('--expect-color', probe.color);
  const result = spawnSync('python3', args, { cwd: root, stdio: 'inherit', timeout: 90_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
