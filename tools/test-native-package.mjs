#!/usr/bin/env node
/** Build and install the published artifact in isolation, then exercise its owned host. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, join as joinPath } from 'node:path';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), 'ctg-native-package-'));
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
};

try {
  const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', temp]));
  const tarball = join(temp, packed[0].filename);
  const paths = packed[0].files.map((file) => file.path);
  assert.ok(paths.includes('plugins/carthagent/index.ts'), 'pack must include plugin server entrypoint');
  assert.ok(paths.includes('plugins/carthagent/tui.ts'), 'pack must include plugin TUI entrypoint');
  assert.ok(!paths.some((path) => /(^|\/)node_modules(\/|$)/.test(path)), 'pack must not include node_modules');
  assert.ok(packed[0].size < 30_000_000, `unexpectedly large package tarball: ${packed[0].size} bytes`);

  const install = join(temp, 'install');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(install));
  run('npm', ['install', '--prefix', install, '--omit=dev', '--no-audit', '--no-fund', tarball]);
  const manifest = JSON.parse(await readFile(join(install, 'node_modules/carthagent/package.json'), 'utf8'));
  const installed = join(install, 'node_modules/carthagent');
  const installedPlugin = join(installed, 'plugins/carthagent');
  assert.equal(manifest.dependencies['@opencode/cli'], '2.0.32');
  assert.equal(manifest.dependencies['@opencode/theme'], '2.0.32');
  assert.equal(manifest.dependencies['@opentui/core'], '0.5.17');
  assert.equal(manifest.dependencies['@opentui/solid'], '0.5.17');
  assert.equal(manifest.dependencies['solid-js'], '1.9.12');
  assert.equal(manifest.dependencies['web-tree-sitter'], '^0.22.6');
  const sharedRuntime = ['@opentui/core', '@opentui/solid', 'solid-js'];
  for (const name of sharedRuntime) {
    const hostResolution = createRequire(join(install, 'node_modules/@opencode/cli/package.json')).resolve(name);
    const pluginResolution = createRequire(join(installedPlugin, 'package.json')).resolve(name);
    assert.equal(pluginResolution, hostResolution, `${name} must resolve to the same host and plugin runtime instance`);
  }
  const packageVersion = async (from, name) => {
    const entry = createRequire(from).resolve(name);
    let directory = dirname(entry);
    while (directory !== dirname(directory)) {
      try {
        const manifest = JSON.parse(await readFile(joinPath(directory, 'package.json'), 'utf8'));
        if (manifest.name === name) return manifest.version;
      } catch {}
      directory = dirname(directory);
    }
    throw new Error(`Could not locate ${name} package manifest from ${entry}`);
  };
  assert.equal(await packageVersion(join(install, 'node_modules/@opentui/core/package.json'), 'web-tree-sitter'), '0.25.10');
  assert.equal(await packageVersion(join(installed, 'package.json'), 'web-tree-sitter'), '0.22.6');
  const binary = join(install, 'node_modules/@opencode/cli/bin/opencode.exe');
  assert.ok((await stat(binary)).size > 100_000_000, 'native host binary must be materialized by postinstall');
  const version = run(binary, ['--version'], { cwd: install }).trim();
  assert.equal(version, 'opencode v2.0.32');

  const env = {
    ...process.env,
    CTG_OPENCODE_BIN: binary,
    HOME: join(temp, 'home'),
    USERPROFILE: join(temp, 'home'),
    APPDATA: join(temp, 'appdata'),
    LOCALAPPDATA: join(temp, 'localappdata'),
    XDG_CONFIG_HOME: join(temp, 'config'),
    XDG_DATA_HOME: join(temp, 'data'),
    XDG_STATE_HOME: join(temp, 'state'),
    XDG_CACHE_HOME: join(temp, 'cache'),
  };
  // Run the acceptance harness from the installed artifact itself so its
  // imports (including @opencode/client) resolve only through that install.
  for (const test of [
    'test-native-host.mjs', 'test-native-controls.mjs', 'test-native-outcomes.mjs',
    'test-native-product.mjs', 'test-native-runtime.mjs', 'test-native-tasks.mjs',
    'test-native-review.mjs', 'test-native-pty.mjs',
  ]) {
    run(process.execPath, [join(installed, 'tools', test), installedPlugin], { cwd: install, env });
  }
  console.log(JSON.stringify({ tarball: packed[0].filename, unpackedSize: packed[0].unpackedSize, binary, version }, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
}
