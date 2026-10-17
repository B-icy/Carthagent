#!/usr/bin/env node
/** Unix-only PTY helper; CI skips this test explicitly on Windows. */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform === 'win32') {
  console.log('Native PTY smoke skipped: the Python PTY implementation is Unix-only.');
  process.exit(0);
}
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const binary = process.env.CTG_OPENCODE_BIN ?? resolve(root, 'node_modules/@opencode/cli/bin/opencode.exe');
const plugin = resolve(root, 'plugins/carthagent');
const testPlugin = resolve(plugin, 'test-plugin');
const result = spawnSync('python3', [resolve(root, 'tools/native-pty-smoke.py'), '--binary', binary, '--plugin', plugin, '--delivery-plugin', testPlugin], {
  cwd: root,
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
