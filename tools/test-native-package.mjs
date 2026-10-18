#!/usr/bin/env node
/** Build and install the published artifact in isolation, then exercise its owned host. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  assert.equal(manifest.dependencies['@opencode/cli'], '2.0.32');
  const binary = join(install, 'node_modules/@opencode/cli/bin/opencode.exe');
  assert.ok((await stat(binary)).size > 100_000_000, 'native host binary must be materialized by postinstall');
  const version = run(binary, ['--version'], { cwd: install }).trim();
  assert.equal(version, 'opencode v2.0.32');

  // Exercise the actual packed installation's default dependency discovery
  // before setting the explicit override used by the host acceptance probes.
  const installed = join(install, 'node_modules/carthagent');
  const runtimeModule = join(installed, 'lib/opencode/runtime.mjs');
  const runtimeRequire = createRequire(runtimeModule);
  const runtime = await import(pathToFileURL(runtimeModule));
  const previousBinary = process.env.CTG_OPENCODE_BIN;
  const previousOwned = process.env.CTG_OWNED_OPENCODE_RUNTIME;
  const previousHome = process.env.HOME;
  const previousXdgConfig = process.env.XDG_CONFIG_HOME;
  const previousXdgData = process.env.XDG_DATA_HOME;
  const previousXdgState = process.env.XDG_STATE_HOME;
  const previousXdgCache = process.env.XDG_CACHE_HOME;
  delete process.env.CTG_OPENCODE_BIN;
  delete process.env.CTG_OWNED_OPENCODE_RUNTIME;
  process.env.HOME = join(temp, 'resolver-home');
  process.env.XDG_CONFIG_HOME = join(temp, 'resolver-config');
  process.env.XDG_DATA_HOME = join(temp, 'resolver-data');
  process.env.XDG_STATE_HOME = join(temp, 'resolver-state');
  process.env.XDG_CACHE_HOME = join(temp, 'resolver-cache');
  try {
    assert.equal(runtimeRequire.resolve('@opencode/cli/package.json'), join(install, 'node_modules/@opencode/cli/package.json'));
    assert.equal(await runtime.resolveOpenCode(), binary, 'default resolver must find the hoisted package binary without overrides');
  } finally {
    if (previousBinary === undefined) delete process.env.CTG_OPENCODE_BIN;
    else process.env.CTG_OPENCODE_BIN = previousBinary;
    if (previousOwned === undefined) delete process.env.CTG_OWNED_OPENCODE_RUNTIME;
    else process.env.CTG_OWNED_OPENCODE_RUNTIME = previousOwned;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousXdgConfig === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdgConfig;
    if (previousXdgData === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousXdgData;
    if (previousXdgState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previousXdgState;
    if (previousXdgCache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previousXdgCache;
  }

  const env = {
    ...process.env,
    CTG_OPENCODE_BIN: binary,
    CTG_EVALUATION_MAX_TURNS: '8',
    CTG_EVALUATION_MAX_COST: '1',
    HOME: join(temp, 'home'),
    XDG_CONFIG_HOME: join(temp, 'config'),
    XDG_DATA_HOME: join(temp, 'data'),
    XDG_STATE_HOME: join(temp, 'state'),
    XDG_CACHE_HOME: join(temp, 'cache'),
  };
  // The product entrypoint is intentionally parent-composed. Build a disposable
  // host entrypoint that composes the package's exported native integration.
  const installedPlugin = join(installed, '.ctg-production-plugin');
  await mkdir(installedPlugin);
  await writeFile(join(installedPlugin, 'index.ts'), `import { Plugin } from '@opencode/plugin';\nimport { setupCarthagent } from '../plugins/carthagent/src/index';\nexport default Plugin.define({ id: 'carthagent', setup: context => setupCarthagent(context, { delivery: true }) });\n`);
  // Run the acceptance harness from the installed artifact itself so its
  // imports (including @opencode/client) resolve only through that install.
  const composedPlugin = installedPlugin;
  for (const test of ['test-native-host.mjs', 'test-native-controls.mjs', 'test-native-outcomes.mjs', 'test-native-evaluation.mjs', 'test-native-swe.mjs']) {
    run(process.execPath, [join(installed, 'tools', test), composedPlugin], { cwd: install, env });
  }
  run(process.execPath, [join(installed, 'tools', 'test-native-swe-host.mjs'), join(installed, 'plugins/carthagent')], { cwd: install, env });
  for (const scenario of ['standard', 'strict', 'raw', 'budget', 'mixed', 'concurrent']) {
    run(process.execPath, [join(installed, 'tools', 'test-native-delivery-host.mjs'), composedPlugin], {
      cwd: install, env: { ...env, CTG_NATIVE_SCENARIO: scenario },
    });
  }
  run(process.execPath, [join(installed, 'tools', 'test-native-report.mjs'), join(installed, 'tools', 'native-report-plugin')], { cwd: install, env });
  console.log(JSON.stringify({ tarball: packed[0].filename, unpackedSize: packed[0].unpackedSize, binary, version }, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
}
