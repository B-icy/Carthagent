#!/usr/bin/env node
/** Build and install the published artifact in isolation, then exercise its owned host. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join as joinPath, relative, sep } from 'node:path';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), 'ctg-native-package-'));
const focused = process.env.CTG_NATIVE_PACKAGE_TEST;
const requireOwnedRuntime = process.argv.includes('--require-owned') || process.env.CTG_REQUIRE_OWNED_RUNTIME === '1';
assert.ok(!requireOwnedRuntime || !focused, 'owned-runtime release acceptance cannot be narrowed to a focused probe');
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 300_000, ...options });
  if (result.error) throw new Error(`${command} ${args.join(' ')} failed: ${result.error.message}`, { cause: result.error });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
};

// A package gate must exercise the normal installed-product acquisition path,
// not a developer's binary, cache, profile, or running service. Keep every
// OpenCode data location under this invocation's temporary directory.
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^(?:CTG_OPENCODE_|CTG_OWNED_OPENCODE_RUNTIME$|CTG_RUNTIME_|CTG_TEST_|OPENCODE_|CARTHAGENT_(?:AGENT_DIR|CODING_AGENT_DIR|CONFIG|CLI)|PI_CODING_AGENT_DIR$)/i.test(key)) delete env[key];
}
const isolatedHome = join(temp, 'runtime-home');
Object.assign(env, {
  HOME: isolatedHome,
  USERPROFILE: isolatedHome,
  APPDATA: join(temp, 'appdata'),
  LOCALAPPDATA: join(temp, 'localappdata'),
  XDG_CONFIG_HOME: join(temp, 'config'),
  XDG_DATA_HOME: join(temp, 'data'),
  XDG_STATE_HOME: join(temp, 'state'),
  XDG_CACHE_HOME: join(temp, 'cache'),
  CTG_OPENCODE_HOME: join(temp, 'ctg-runtime'),
  CARTHAGENT_AGENT_DIR: join(temp, 'agent'),
  CARTHAGENT_CODING_AGENT_DIR: join(temp, 'agent'),
  PI_CODING_AGENT_DIR: join(temp, 'agent'),
  CARTHAGENT_CONFIG: join(temp, 'carthagent-config.json'),
  npm_config_cache: join(temp, 'npm-cache'),
});

try {
  await mkdir(isolatedHome, { recursive: true });
  const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', temp], { env }));
  const tarball = join(temp, packed[0].filename);
  const paths = packed[0].files.map((file) => file.path);
  assert.ok(paths.includes('plugins/carthagent/index.ts'), 'pack must include plugin server entrypoint');
  assert.ok(paths.includes('plugins/carthagent/tui.ts'), 'pack must include plugin TUI entrypoint');
  assert.ok(!paths.some((path) => /(^|\/)node_modules(\/|$)/.test(path)), 'pack must not include node_modules');
  assert.ok(packed[0].size < 30_000_000, `unexpectedly large package tarball: ${packed[0].size} bytes`);

  const install = join(temp, 'install');
  await mkdir(install);
  run('npm', ['install', '--prefix', install, '--omit=dev', '--no-audit', '--no-fund', tarball], { env });
  const manifest = JSON.parse(await readFile(join(install, 'node_modules/carthagent/package.json'), 'utf8'));
  const installed = join(install, 'node_modules/carthagent');
  const installedPlugin = join(installed, 'plugins/carthagent');
  assert.equal(manifest.dependencies['@opencode/cli'], '2.0.32');
  assert.equal(manifest.dependencies['@opencode/theme'], '2.0.32');
  assert.equal(manifest.dependencies['@opentui/core'], '0.5.17');
  assert.equal(manifest.dependencies['@opentui/solid'], '0.5.17');
  assert.equal(manifest.dependencies['solid-js'], '1.9.12');
  assert.equal(manifest.dependencies['web-tree-sitter'], '0.25.10');
  assert.equal(manifest.dependencies['web-tree-sitter-legacy'], 'npm:web-tree-sitter@0.22.6');
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
  assert.equal(await packageVersion(join(installed, 'package.json'), 'web-tree-sitter'), '0.25.10');
  assert.equal(JSON.parse(await readFile(join(install, 'node_modules/web-tree-sitter-legacy/package.json'), 'utf8')).version, '0.22.6');
  const releaseManifestPath = join(installed, 'lib/opencode/runtime-release.json');
  let releaseManifest;
  try { releaseManifest = JSON.parse(await readFile(releaseManifestPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }

  // Ask the installed package's *default* resolver and identity reporter.
  // The JSON explicitly distinguishes preview upstream-compatible packages
  // from packages whose resolver acquired the pinned CTG-owned runtime.
  const resolution = JSON.parse(run(process.execPath, ['--input-type=module', '-e', `
    import { pathToFileURL } from 'node:url';
    const runtime = await import(pathToFileURL(process.argv[1]).href);
    const { loadNativeTestRuntime } = await import(pathToFileURL(process.argv[2]).href);
    const options = {};
    const binary = await runtime.resolveOpenCode(options);
    const identity = await runtime.runtimeIdentity(binary, options);
    const expectedManifest = JSON.parse(await (await import('node:fs/promises')).readFile(process.argv[3], 'utf8').catch(error => error.code === 'ENOENT' ? 'null' : Promise.reject(error)));
    const { fileURLToPath } = await import('node:url');
    const ownedRoot = identity.kind === 'ctg-owned' ? fileURLToPath(new URL('../../../', pathToFileURL(binary))) : undefined;
    const verified = await loadNativeTestRuntime({ binary, ownedRoot, expectedManifest });
    console.log(JSON.stringify({ binary, ownedRoot: ownedRoot ?? null, identity, verified }));
  `, join(installed, 'lib/opencode/runtime.mjs'), join(installed, 'tools/native-runtime-identity.mjs'), releaseManifestPath], { cwd: install, env }).trim());
  const binary = resolve(resolution.binary);
  assert.ok((await stat(binary)).isFile(), 'default resolver must select a materialized runtime executable');
  assert.ok(resolution.identity && typeof resolution.identity.kind === 'string', 'default resolver must report runtime identity');
  if (resolution.identity.kind === 'ctg-owned') {
    assert.ok(releaseManifest, 'owned runtime identity requires a package-pinned release manifest');
    assert.ok(resolution.ownedRoot, 'owned runtime identity must report the acquired runtime root');
    assert.equal(resolution.identity.version, releaseManifest.runtimeVersion, 'owned runtime version must match the package-pinned release');
    assert.equal(resolution.identity.binaryPath && resolve(resolution.identity.binaryPath), binary, 'reported owned identity must name the selected executable');
    assert.equal(resolution.verified.binary, binary, 'independent verifier must select the exact default-resolved executable');
    assert.equal(resolution.verified.binarySha256, releaseManifest.assets[resolution.identity.platform].executableSha256,
      'independent verifier must match executable bytes against the installed trusted release manifest');
    assert.equal(resolution.verified.sourceRevision, releaseManifest.sourceRevision, 'independent verifier must check runtime source provenance');
    assert.equal(resolution.verified.patchSha256, releaseManifest.patchSha256, 'independent verifier must check runtime patch provenance');
    assert.equal(resolution.verified.lockSha256, releaseManifest.lockSha256, 'independent verifier must check runtime lock provenance');
    const ownedRelative = relative(isolatedHome, resolution.ownedRoot);
    assert.ok(ownedRelative && ownedRelative !== '..' && !ownedRelative.startsWith(`..${sep}`) && !isAbsolute(ownedRelative),
      `default acquisition cache must remain inside this test's isolated HOME (got ${resolution.ownedRoot})`);
  } else {
    assert.equal(resolution.identity.kind, 'upstream-compatible', 'unknown runtime identity cannot satisfy installed package acceptance');
    assert.equal(resolution.identity.version, '2.0.32', 'preview upstream runtime must match the explicitly supported compatibility version');
    assert.equal(resolution.verified.runtimeVersion, '2.0.32', 'independent verifier must validate upstream compatibility exactly');
    assert.ok(!releaseManifest && !requireOwnedRuntime,
      'a release package manifest or --require-owned requires the default resolver to acquire its package-pinned CTG runtime; upstream-compatible mode is preview-only');
  }

  // Independently check that the normal installation did acquire the upstream
  // dependency executable: it remains a compatibility check, not the selected
  // binary override used by the acceptance probes.
  const cliPackageJson = createRequire(join(install, 'node_modules/carthagent/package.json')).resolve('@opencode/cli/package.json');
  const cliManifest = JSON.parse(await readFile(cliPackageJson, 'utf8'));
  const cliBin = typeof cliManifest.bin === 'string' ? cliManifest.bin : cliManifest.bin?.opencode;
  assert.equal(typeof cliBin, 'string', '@opencode/cli must expose its executable through package metadata');
  const packagedBinary = resolve(dirname(cliPackageJson), cliBin);
  if (manifest.dependencies['@opencode/cli']) {
    assert.ok((await stat(packagedBinary)).isFile(), 'normal npm install must materialize the declared OpenCode dependency');
  }
  // Run the acceptance harness from the installed artifact itself so its
  // imports (including @opencode/client) resolve only through that install.
  const probes = [];
  const acceptanceTests = [
    'test-native-host.mjs', 'test-native-controls.mjs', 'test-native-outcomes.mjs',
    'test-native-product.mjs', 'test-native-runtime.mjs', 'test-native-tasks.mjs',
    'test-native-review.mjs', 'test-native-swe-host.mjs', 'test-native-pty.mjs',
    'test-native-evaluation.mjs', 'test-native-swe.mjs',
    'test-native-report.mjs',
    'test-native-delivery-host.mjs',
    '../tests/codegraph.test.mjs',
    '../tests/native-cli-host-smoke.mjs',
  ];
  assert.ok(!focused || acceptanceTests.includes(focused), `Unknown installed acceptance probe: ${focused}`);
  const tests = focused ? [focused] : acceptanceTests;
  const cases = tests.flatMap(test => test === 'test-native-delivery-host.mjs'
    ? ['standard', 'strict', 'budget', 'raw', 'mixed', 'concurrent'].map(scenario => ({ test, scenario }))
    : [{ test }]);
  for (const { test, scenario } of cases) {
    const identity = { test, ...(scenario ? { scenario } : {}), runtime: resolution.identity };
    if (test === 'test-native-pty.mjs' && process.platform === 'win32') {
      const result = { ...identity, status: 'skipped', reason: 'Unix-only Python PTY harness' };
      probes.push(result);
      console.log(JSON.stringify(result));
      continue;
    }
    const started = performance.now();
    console.log(JSON.stringify({ ...identity, status: 'started' }));
    try {
      const probePath = join(installed, 'tools', test);
      // Parser/WASM behavior must resolve from the packed installation too.
      const args = test.endsWith('.test.mjs') ? ['--test', probePath] : [probePath, installedPlugin];
      run(process.execPath, args, {
        cwd: install, env: { ...env, CTG_NATIVE_SCENARIO: scenario ?? '' },
      });
    } catch (error) {
      console.error(JSON.stringify({ ...identity, status: 'failed', elapsedMs: Math.round(performance.now() - started), completed: probes }));
      throw error;
    }
    const result = { ...identity, status: 'passed', elapsedMs: Math.round(performance.now() - started) };
    probes.push(result);
    console.log(JSON.stringify(result));
  }
  console.log(JSON.stringify({
    scope: focused ? 'focused' : 'full',
    acceptance: resolution.identity.kind === 'ctg-owned' ? 'owned-runtime' : 'preview-upstream-compatible',
    tarball: packed[0].filename,
    unpackedSize: packed[0].unpackedSize,
    runtime: resolution.identity,
    binary,
    probes,
  }, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
}
