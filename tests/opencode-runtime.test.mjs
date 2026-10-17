import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { getEventListeners } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { nativeCommandConfig } from '../lib/opencode/compatibility.mjs';
import { CTG_RUNTIME_LOCK_SHA256, CTG_RUNTIME_PATCH_SHA256, CTG_RUNTIME_SOURCE, CTG_RUNTIME_VERSION, OPENCODE_VERSION, provisionRuntime, readRuntimeReleaseManifest, resolveOpenCode, resolveOwnedOpenCode, resolvePathCommand, runtimeEnvironment, runtimeIdentity, runtimePaths, withFileLock, workspaceEnvironment } from '../lib/opencode/runtime.mjs';
import { cancelSession, createSession, ensureService, getSession, launchTui, promptSession, serviceRequest, sessionMessages, setSessionEnvironment, stopService } from '../lib/opencode/service.mjs';
import { runHeadless } from '../lib/opencode/headless.mjs';

function pendingUntilAbort(signal) {
  return new Promise((_, reject) => {
    const keepAlive = setTimeout(() => {}, 5000);
    const aborted = () => {
      clearTimeout(keepAlive);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

test('CTG runtime paths and env are isolated from host OpenCode roots', () => {
  const root = path.join(os.tmpdir(), 'ctg-test-profile');
  const paths = runtimePaths({ root });
  const env = runtimeEnvironment({ root, env: { ANTHROPIC_API_KEY: 'test' } });
  assert.equal(env.XDG_CONFIG_HOME, paths.config);
  assert.equal(env.XDG_DATA_HOME, paths.data);
  assert.equal(env.XDG_STATE_HOME, paths.state);
  assert.equal(env.XDG_CACHE_HOME, paths.cache);
  assert.equal(env.HOME, paths.home);
  assert.equal(env.APPDATA, path.join(paths.home, 'AppData', 'Roaming'));
  assert.equal(env.LOCALAPPDATA, path.join(paths.home, 'AppData', 'Local'));
  assert.equal(env.OPENCODE_TEST_HOME, paths.home);
  assert.equal(env.OPENCODE_CONFIG_DIR, paths.configDir);
  assert.equal(env.OPENCODE_CONFIG_PROJECT_DISABLE, 'true');
  assert.equal(env.OPENCODE_DB, path.join(paths.data, 'opencode.db'));
  assert.equal(env.ANTHROPIC_API_KEY, 'test');
  assert.equal(env.OPENCODE_CUSTOM_CONFIG, undefined);
  assert.notEqual(paths.serviceFile, path.join(os.homedir(), '.local/state/opencode/service.json'));
});

test('runtime removes inherited OpenCode profile overrides', () => {
  const root = path.resolve('/tmp/ctg-isolated');
  const paths = runtimePaths({ root });
  const env = runtimeEnvironment({ root, env: {
    OPENCODE_CONFIG_DIR: '/user/config',
    OPENCODE_CONFIG: '/user/opencode.json',
    OPENCODE_CONFIG_PROJECT_DISABLE: 'false',
    OPENCODE_SERVER_PASSWORD: 'user-service-secret',
    OPENAI_API_KEY: 'preserved',
  } });
  assert.equal(env.OPENCODE_CONFIG_DIR, paths.configDir);
  assert.equal(env.OPENCODE_CONFIG, paths.configFile);
  assert.equal(env.OPENCODE_CONFIG_PROJECT_DISABLE, 'true');
  assert.equal(env.OPENCODE_SERVER_PASSWORD, undefined);
  assert.equal(env.OPENAI_API_KEY, 'preserved');
  assert.equal(env.APPDATA, paths.appData);
  assert.equal(env.LOCALAPPDATA, paths.localAppData);
});

test('runtime overrides inherited Windows profile roots with CTG-owned paths', () => {
  const root = path.resolve('/tmp/ctg-windows-roots');
  const paths = runtimePaths({ root });
  const env = runtimeEnvironment({ root, env: {
    APPDATA: 'C:\\Users\\foreign\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\foreign\\AppData\\Local',
    OPENCODE_CONFIG_PROJECT_DISABLE: 'false',
  } });
  assert.equal(env.APPDATA, paths.appData);
  assert.equal(env.LOCALAPPDATA, paths.localAppData);
  assert.equal(env.OPENCODE_CONFIG_PROJECT_DISABLE, 'true');
});

test('stale-lock recovery is serialized across independent processes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctg-stale-recovery-'));
  const lock = path.join(root, 'lifecycle.lock');
  const gate = path.join(root, 'go');
  const worker = path.join(root, 'worker.mjs');
  const markerDir = path.join(root, 'active');
  await mkdir(markerDir);
  await writeFile(lock, JSON.stringify({ pid: 2_000_000_000, token: 'dead-owner', startedAt: 0 }));
  await writeFile(worker, `
    import { readFile, rm, writeFile } from 'node:fs/promises';
    import { withFileLock } from ${JSON.stringify(new URL('../lib/opencode/runtime.mjs', import.meta.url).href)};
    const [lock, gate, markerDir, name] = process.argv.slice(2);
    while (true) { try { await readFile(gate); break; } catch { await new Promise(r => setTimeout(r, 5)); } }
    await withFileLock(lock, async () => {
      const marker = markerDir + '/' + name;
      await writeFile(marker, 'active');
      const current = await (await import('node:fs/promises')).readdir(markerDir);
      if (current.includes('a') && current.includes('b')) await writeFile(markerDir + '/overlap', current.join(','));
      await new Promise(r => setTimeout(r, 120));
      await rm(marker);
    }, { staleLockAge: 0, timeout: 5000, pollInterval: 2, afterStaleLockCheck: async () => {
      await writeFile(markerDir + '/checked-' + name, 'yes');
      while (true) {
        try { await readFile(markerDir + '/checked-a'); await readFile(markerDir + '/checked-b'); break; }
        catch { await new Promise(r => setTimeout(r, 2)); }
      }
    } });
  `);
  try {
    const a = spawn(process.execPath, [worker, lock, gate, markerDir, 'a'], { stdio: 'ignore' });
    const b = spawn(process.execPath, [worker, lock, gate, markerDir, 'b'], { stdio: 'ignore' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await writeFile(gate, 'go');
    const exited = Promise.all([a, b].map((child) => new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`lock worker exited ${code}`)));
    })));
    await exited;
    await assert.rejects(readFile(path.join(markerDir, 'overlap')), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('persistent stale recovery marker fails closed at the lock deadline with manual recovery guidance', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctg-stale-recovery-stuck-'));
  const lock = path.join(root, 'lifecycle.lock');
  try {
    await writeFile(lock, JSON.stringify({ pid: 2_000_000_000, token: 'dead-owner', startedAt: 0 }));
    await writeFile(`${lock}.recovery`, JSON.stringify({ pid: 2_000_000_000, token: 'abandoned-recovery' }));
    const startedAt = Date.now();
    await assert.rejects(withFileLock(lock, async () => assert.fail('must not acquire lock'), {
      timeout: 75,
      pollInterval: 250,
      staleLockAge: 0,
    }), (error) => {
      assert.match(error.message, /Timed out waiting for CTG runtime lock/);
      assert.match(error.message, /inspect and remove the stale lock\/recovery files/);
      assert.ok(error.message.includes(`${lock}.recovery`), 'manual guidance must name the recovery marker path');
      return true;
    });
    assert.ok(Date.now() - startedAt < 400, 'recovery-marker retries must observe the bounded deadline');
    assert.equal((await readFile(`${lock}.recovery`, 'utf8')).includes('abandoned-recovery'), true, 'stale marker remains for deliberate manual recovery');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('profile provisioning creates private isolated profile and absolute plugin reference', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctg-runtime-'));
  try {
    const paths = await provisionRuntime({ root, pluginPath: path.join(root, 'plugins/carthagent'), profile: { model: 'fake/test' } });
    const config = JSON.parse(await readFile(paths.configFile, 'utf8'));
    assert.equal(config.model, 'fake/test');
    assert.deepEqual(config.plugins, [path.join(root, 'plugins/carthagent')]);
    if (process.platform !== 'win32') assert.equal((await stat(paths.configFile)).mode & 0o777, 0o600);
    assert.equal((await stat(paths.appData)).isDirectory(), true);
    assert.equal((await stat(paths.localAppData)).isDirectory(), true);
    await writeFile(paths.configFile, JSON.stringify({ model: 'kept/model', plugins: ['kept-plugin'], commands: { keep: 'hello' } }));
    await provisionRuntime({ root, pluginPath: path.join(root, 'plugins/carthagent'), profile: { theme: 'kept-theme' } });
    const updated = JSON.parse(await readFile(paths.configFile, 'utf8'));
    assert.equal(updated.model, 'kept/model');
    assert.equal(updated.theme, 'kept-theme');
    assert.deepEqual(updated.commands, { keep: 'hello' });
    assert.deepEqual(updated.plugins, ['kept-plugin', path.join(root, 'plugins/carthagent')]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('workspace environment records workspace without leaking CTG XDG overrides', () => {
  const workspace = path.resolve('/tmp/workspace');
  const env = workspaceEnvironment(workspace, { XDG_CONFIG_HOME: '/host/config', OPENAI_API_KEY: 'secret' });
  assert.equal(env.XDG_CONFIG_HOME, '/host/config');
  assert.equal(env.CTG_WORKSPACE, workspace);
  assert.equal(env.OPENAI_API_KEY, 'secret');
});

test('native slash command conversion validates and preserves template', () => {
  assert.deepEqual(nativeCommandConfig({ review: { description: 'Review', template: 'Inspect $ARGUMENTS', agent: 'build' } }), {
    review: { description: 'Review', template: 'Inspect $ARGUMENTS', agent: 'build' },
  });
  assert.throws(() => nativeCommandConfig({ 'Bad Name': 'no' }), /Invalid slash command/);
});

test('native API requests preserve structured responses and reject status failures', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('{"ok":true}', { status: 200 });
    assert.deepEqual(await serviceRequest({ url: 'http://127.0.0.1:1', headers: {} }, 'GET', '/api/info'), { ok: true });
    globalThis.fetch = async () => new Response('{"message":"bad"}', { status: 500 });
    await assert.rejects(serviceRequest({ url: 'http://127.0.0.1:1', headers: {} }, 'GET', '/api/info'), /failed \(500\)/);
  } finally { globalThis.fetch = original; }
});

test('default packaged OpenCode resolves through Node package exports when hoisted beside CTG', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctg-hoisted-resolution-'));
  const packageRoot = path.join(root, 'node_modules', 'carthagent');
  const dependencyRoot = path.join(root, 'node_modules', '@opencode', 'cli');
  try {
    await mkdir(path.join(packageRoot, 'lib', 'opencode'), { recursive: true });
    await mkdir(path.join(dependencyRoot, 'bin'), { recursive: true });
    const runtime = await readFile(new URL('../lib/opencode/runtime.mjs', import.meta.url), 'utf8');
    const artifactModule = await readFile(new URL('../lib/opencode/runtime-artifact.mjs', import.meta.url), 'utf8');
    await writeFile(path.join(packageRoot, 'lib', 'opencode', 'runtime.mjs'), runtime);
    await writeFile(path.join(packageRoot, 'lib', 'opencode', 'runtime-artifact.mjs'), artifactModule);
    await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'carthagent', version: '1.0.0', type: 'module' }));
    await writeFile(path.join(dependencyRoot, 'package.json'), JSON.stringify({ name: '@opencode/cli', bin: { opencode: './bin/opencode.exe' }, version: OPENCODE_VERSION }));
    const binary = path.join(dependencyRoot, 'bin', 'opencode.exe');
    await writeFile(binary, 'hoisted package fixture');
    const { pathToFileURL } = await import('node:url');
    const imported = await import(`${pathToFileURL(path.join(packageRoot, 'lib/opencode/runtime.mjs')).href}?test=${Date.now()}`);
    const spawnImpl = (_command, _args, options) => {
      const child = spawn(process.execPath, ['-e', `process.stdout.write('opencode v${OPENCODE_VERSION}')`], options);
      return child;
    };
    assert.equal(await imported.resolveOpenCode({ spawnImpl }), binary);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('packaged release manifest automatically acquires the pinned owned runtime and binds identity', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctg-release-manifest-'));
  const artifact = path.join(root, 'cache', `${process.platform}-${process.arch}`);
  const manifestPath = path.join(root, 'runtime-release.json');
  const hostPlatform = process.platform === 'win32' ? 'windows' : process.platform;
  const target = `${hostPlatform}-${process.arch}`;
  const binary = path.join(artifact, `cli-${target}`, 'bin', process.platform === 'win32' ? 'opencode.exe' : 'opencode');
  const { createHash } = await import('node:crypto');
  const packageMetadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const binaryBytes = Buffer.from('pinned acquired executable');
  const binaryHash = createHash('sha256').update(binaryBytes).digest('hex');
  const platformKeys = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'windows-x64'];
  const assets = Object.fromEntries(platformKeys.map((key) => [key, {
    name: `opencode-${key}.tar.gz`, archiveSha256: 'a'.repeat(64), executableSha256: key === target ? binaryHash : 'b'.repeat(64),
  }]));
  const release = {
    version: 1, releaseVersion: packageMetadata.version, compatibilityVersion: OPENCODE_VERSION,
    runtimeVersion: CTG_RUNTIME_VERSION, sourceRevision: CTG_RUNTIME_SOURCE,
    patchSha256: CTG_RUNTIME_PATCH_SHA256, lockSha256: CTG_RUNTIME_LOCK_SHA256, assets,
  };
  try {
    await mkdir(path.dirname(binary), { recursive: true });
    await writeFile(binary, binaryBytes, { mode: 0o755 });
    await writeFile(path.join(artifact, 'ctg-runtime.json'), JSON.stringify({
      owner: 'Carthagent', sourceRepository: 'https://github.com/anomalyco/opencode',
      sourceRevision: CTG_RUNTIME_SOURCE, lockSha256: CTG_RUNTIME_LOCK_SHA256,
      patchSha256: CTG_RUNTIME_PATCH_SHA256, compatibilityVersion: OPENCODE_VERSION,
      runtimeVersion: CTG_RUNTIME_VERSION, channel: `ctg.${OPENCODE_VERSION}`,
      platform: target, webUI: false,
    }));
    await writeFile(path.join(artifact, 'SHA256SUMS'), `${binaryHash}  cli-${target}/bin/${process.platform === 'win32' ? 'opencode.exe' : 'opencode'}\n`);
    await writeFile(manifestPath, JSON.stringify(release));
    const calls = [];
    const spawnImpl = (command, args, options) => spawn(process.execPath, ['-e', `process.stdout.write('opencode v${CTG_RUNTIME_VERSION}')`], options);
    const options = {
      runtimeReleaseManifestPath: manifestPath,
      runtimeCacheRoot: path.join(root, 'owned-cache'),
      runtimeReleaseBaseUrl: `https://example.test/releases/v${packageMetadata.version}`,
      acquireOwnedRuntime: async (input) => {
        calls.push(input);
        const currentHash = createHash('sha256').update(await readFile(binary)).digest('hex');
        if (currentHash !== input.expectedExecutableSha256) throw new Error('pinned executable SHA-256 mismatch');
        return artifact;
      },
      spawnImpl,
    };
    const resolved = await resolveOpenCode(options);
    assert.equal(resolved, binary);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].releaseVersion, packageMetadata.version);
    assert.equal(calls[0].expectedArchiveSha256, assets[target].archiveSha256);
    assert.equal(calls[0].expectedExecutableSha256, assets[target].executableSha256);
    assert.equal(calls[0].expectedChannel, `ctg.${OPENCODE_VERSION}`);
    // Production ensureService resolves and identifies with one shared options
    // object; automatic selection identity is kept separate from the explicit
    // developer-preview ownedRuntime selector.
    const identity = await runtimeIdentity(resolved, options);
    assert.equal(identity.kind, 'ctg-owned');
    assert.equal(identity.patchSha256, CTG_RUNTIME_PATCH_SHA256);
    assert.equal(options.ownedRuntime, undefined);

    // A second resolution with the same options cannot trust the mutable
    // adjacent SHA256SUMS as the release digest; the pinned manifest digest is
    // checked again before returning the cached executable.
    const tamperedBytes = Buffer.from('tampered executable');
    const tamperedHash = createHash('sha256').update(tamperedBytes).digest('hex');
    await writeFile(binary, tamperedBytes, { mode: 0o755 });
    await writeFile(path.join(artifact, 'SHA256SUMS'), `${tamperedHash}  cli-${target}/bin/${process.platform === 'win32' ? 'opencode.exe' : 'opencode'}\n`);
    await assert.rejects(resolveOpenCode(options), /pinned executable SHA-256 mismatch/);
    assert.equal(calls.length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('present but invalid runtime release manifest fails closed instead of selecting package CLI', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctg-invalid-release-manifest-'));
  const manifestPath = path.join(root, 'runtime-release.json');
  try {
    await writeFile(manifestPath, JSON.stringify({ version: 1, releaseVersion: '1.2.3', assets: {} }));
    await assert.rejects(resolveOpenCode({ runtimeReleaseManifestPath: manifestPath }), /Invalid or incompatible CTG OpenCode release manifest/);
    await assert.rejects(readRuntimeReleaseManifest(manifestPath), /Invalid or incompatible CTG OpenCode release manifest/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('incomplete release platform matrix fails closed without acquisition', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctg-unsupported-release-target-'));
  const manifestPath = path.join(root, 'runtime-release.json');
  const packageMetadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const keys = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'windows-x64'];
  const assets = Object.fromEntries(keys.map((key) => [key, {
    name: `opencode-${key}.tar.gz`, archiveSha256: 'a'.repeat(64), executableSha256: 'b'.repeat(64),
  }]));
  delete assets[`${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`];
  try {
    await writeFile(manifestPath, JSON.stringify({
      version: 1, releaseVersion: packageMetadata.version,
      compatibilityVersion: OPENCODE_VERSION, runtimeVersion: CTG_RUNTIME_VERSION,
      sourceRevision: CTG_RUNTIME_SOURCE, patchSha256: CTG_RUNTIME_PATCH_SHA256,
      lockSha256: CTG_RUNTIME_LOCK_SHA256, assets,
    }));
    let acquired = false;
    await assert.rejects(resolveOpenCode({
      runtimeReleaseManifestPath: manifestPath,
      acquireOwnedRuntime: async () => { acquired = true; throw new Error('must not acquire'); },
    }), /Invalid or incompatible CTG OpenCode release manifest/);
    assert.equal(acquired, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('missing runtime release manifest keeps the developer-preview package resolver available', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctg-missing-release-manifest-'));
  const packageRoot = path.join(root, 'node_modules', 'carthagent');
  const dependencyRoot = path.join(root, 'node_modules', '@opencode', 'cli');
  try {
    await mkdir(path.join(packageRoot, 'lib', 'opencode'), { recursive: true });
    await mkdir(path.join(dependencyRoot, 'bin'), { recursive: true });
    for (const name of ['runtime.mjs', 'runtime-artifact.mjs']) {
      await writeFile(path.join(packageRoot, 'lib', 'opencode', name), await readFile(new URL(`../lib/opencode/${name}`, import.meta.url), 'utf8'));
    }
    await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'carthagent', version: '1.0.0', type: 'module' }));
    await writeFile(path.join(dependencyRoot, 'package.json'), JSON.stringify({ name: '@opencode/cli', version: OPENCODE_VERSION, bin: { opencode: './bin/opencode' } }));
    const binary = path.join(dependencyRoot, 'bin', 'opencode');
    await writeFile(binary, 'preview fixture');
    const { pathToFileURL } = await import('node:url');
    const imported = await import(`${pathToFileURL(path.join(packageRoot, 'lib/opencode/runtime.mjs')).href}?missing=${Date.now()}`);
    const spawnImpl = (_command, _args, options) => spawn(process.execPath, ['-e', `process.stdout.write('opencode v${OPENCODE_VERSION}')`], options);
    assert.equal(await imported.resolveOpenCode({ spawnImpl }), binary);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('session API helpers use the v2 envelope, prompt payload, and endpoint contracts', async () => {
  const original = globalThis.fetch;
  const calls = [];
  const work = path.resolve('/work');
  const workspace = path.resolve('/workspace');
  try {
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response('{"data":{"id":"ses_example"}}', { status: 200 });
    };
    const service = { url: 'http://127.0.0.1:1234', headers: {} };
    assert.deepEqual(await createSession(service, work), { id: 'ses_example' });
    assert.equal(JSON.parse(calls[0].init.body).location.directory, work);
    await promptSession(service, 'ses_example', 'hello');
    assert.equal(new URL(calls[1].url).pathname, '/api/session/ses_example/prompt');
    assert.equal(JSON.parse(calls[1].init.body).text, 'hello');
    await setSessionEnvironment(service, 'ses_example', { API_KEY: 'fixture' }, { location: workspace });
    assert.equal(calls[2].init.method, 'PUT');
    assert.equal(new URL(calls[2].url).pathname, '/api/session/ses_example/environment');
    assert.equal(JSON.parse(calls[2].init.body).variables.API_KEY, 'fixture');
    assert.equal(JSON.parse(calls[2].init.body).variables.CTG_WORKSPACE, workspace);
    assert.equal(new URL(calls[0].url).searchParams.get('location[directory]'), work);
    await sessionMessages(service, 'ses_example', { location: { directory: workspace } });
    assert.equal(new URL(calls[3].url).searchParams.get('location[directory]'), workspace);
    await cancelSession(service, 'ses_example', { location: { directory: workspace }, timeout: 100 });
    const interrupt = new URL(calls[4].url);
    assert.equal(interrupt.pathname, '/api/session/ses_example/interrupt');
    assert.equal(interrupt.searchParams.get('location[directory]'), workspace);
    assert.equal(interrupt.searchParams.get('resume'), 'false');
    assert.ok(calls[4].init.signal instanceof AbortSignal, 'interrupt requests have a bounded abort signal');
    await getSession(service, 'ses_example', { location: workspace });
    assert.equal(new URL(calls[5].url).pathname, '/api/session/ses_example');
    assert.equal(new URL(calls[5].url).searchParams.get('location[directory]'), workspace);
  } finally { globalThis.fetch = original; }
});

test('native TUI attaches to the ensured authenticated service', () => {
  let captured;
  const service = {
    url: 'http://127.0.0.1:4567',
    info: { password: 'ctg-test-password' },
    binary: '/ctg/opencode',
    paths: { root: '/ctg/profile' },
  };
  launchTui(service, '/work', { sessionID: 'ses_123', spawnImpl: (...args) => (captured = args) });
  assert.deepEqual(captured[0], '/ctg/opencode');
  assert.deepEqual(captured[1], ['--server', 'http://127.0.0.1:4567', '/work', '--session', 'ses_123']);
  assert.equal(captured[2].env.OPENCODE_PASSWORD, 'ctg-test-password');
  assert.equal(captured[2].cwd, '/work');
});

test('a live registered process is retained when health inspection fails', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctg-live-unhealthy-'));
  const paths = runtimePaths({ root });
  const original = globalThis.fetch;
  try {
    await provisionRuntime({ root });
    const record = { id: 'ctg-live', pid: process.pid, url: 'http://127.0.0.1:1', password: 'test', version: '2.0.32' };
    await writeFile(paths.serviceFile, JSON.stringify(record));
    globalThis.fetch = async () => { throw new Error('temporary outage'); };
    const options = { root, binary: '/missing/binary' };
    // stopService does not need to resolve an executable and must not discard ownership.
    await assert.rejects(stopService(options), /alive but its service identity cannot be verified/);
    assert.deepEqual(JSON.parse(await readFile(paths.serviceFile, 'utf8')), record);
  } finally { globalThis.fetch = original; await rm(root, { recursive: true, force: true }); }
});

test('runtime identity binds compatibility services to the exact executable path and digest', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctg-runtime-identity-'));
  const first = path.join(root, 'first');
  const second = path.join(root, 'second');
  try {
    await writeFile(first, 'same compatibility version');
    await writeFile(second, 'same compatibility version, different executable bytes');
    const firstIdentity = await runtimeIdentity(first, { binary: first });
    const secondIdentity = await runtimeIdentity(second, { binary: second });
    assert.equal(firstIdentity.kind, 'upstream-compatible');
    assert.equal(firstIdentity.version, OPENCODE_VERSION);
    assert.notEqual(firstIdentity.binaryPath, secondIdentity.binaryPath);
    assert.notEqual(firstIdentity.binarySha256, secondIdentity.binarySha256);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('PATH-selected commands resolve to a concrete executable identity', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctg-path-identity-'));
  const bin = path.join(root, 'bin');
  const executable = path.join(bin, 'opencode');
  const script = path.join(root, 'version.cjs');
  try {
    await mkdir(bin, { recursive: true });
    await writeFile(script, `console.log('opencode v2.0.32')`);
    await writeFile(executable, `#!/usr/bin/env node\nrequire(${JSON.stringify(script)})\n`, { mode: 0o755 });
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` };
    const resolved = await resolveOpenCode({ binary: 'opencode', env });
    assert.equal(resolved, executable);
    const identity = await runtimeIdentity('opencode', { binary: 'opencode', env });
    assert.equal(identity.binaryPath, executable);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Windows PATH lookup does not append PATHEXT to an already suffixed executable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctg-win-path-'));
  const bin = path.join(root, 'bin');
  try {
    await mkdir(bin);
    const executable = path.join(bin, 'foo.exe');
    await writeFile(executable, 'fixture');
    const extensionless = path.join(bin, 'foo.COM');
    await writeFile(extensionless, 'fixture');
    assert.equal(resolvePathCommand('foo.exe', { PATH: bin, PATHEXT: '.COM;.EXE;.CMD' }, 'win32'), executable);
    assert.equal(resolvePathCommand('foo', { PATH: bin, PATHEXT: '.COM;.EXE;.CMD' }, 'win32'), extensionless);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('ensureService rejects normal/owned selector switches without stopping the registered process', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctg-runtime-selector-switch-'));
  const artifact = path.join(root, 'owned-artifact');
  const binary = path.join(root, 'upstream-opencode');
  const ownedPlatform = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
  const artifactPlatform = ownedPlatform;
  const ownedBinary = path.join(artifact, `cli-${artifactPlatform}`, 'bin', process.platform === 'win32' ? 'opencode.exe' : 'opencode');
  const script = path.join(root, 'fixture-runtime.cjs');
  const originalFetch = globalThis.fetch;
  let registeredProcess;
  try {
    await writeFile(script, `if (process.argv[3] === '--version') console.log(process.argv[2].includes('owned-artifact') ? 'opencode v${CTG_RUNTIME_VERSION}' : 'opencode v2.0.32');\n`);
    await writeFile(binary, 'upstream executable fixture');
    await mkdir(path.dirname(ownedBinary), { recursive: true });
    await writeFile(ownedBinary, 'owned executable fixture');
    const { createHash } = await import('node:crypto');
    const ownedHash = createHash('sha256').update(await readFile(ownedBinary)).digest('hex');
    await writeFile(path.join(artifact, 'SHA256SUMS'), `${ownedHash}  cli-${artifactPlatform}/bin/${process.platform === 'win32' ? 'opencode.exe' : 'opencode'}\n`);
    await writeFile(path.join(artifact, 'ctg-runtime.json'), JSON.stringify({
      owner: 'Carthagent', sourceRepository: 'https://github.com/anomalyco/opencode',
      sourceRevision: CTG_RUNTIME_SOURCE, lockSha256: CTG_RUNTIME_LOCK_SHA256, patchSha256: CTG_RUNTIME_PATCH_SHA256,
      compatibilityVersion: OPENCODE_VERSION, runtimeVersion: CTG_RUNTIME_VERSION, channel: 'ctg.2.0.32', platform: ownedPlatform, webUI: false,
    }));
    const spawnImpl = (command, args, options) => spawn(process.execPath, [script, command, ...args], options);
    const upstream = await runtimeIdentity(binary, { binary });
    const owned = await runtimeIdentity(ownedBinary, { ownedRuntime: artifact });
    const paths = runtimePaths({ root: path.join(root, 'profile') });
    await mkdir(path.dirname(paths.serviceFile), { recursive: true });
    registeredProcess = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    await new Promise((resolve, reject) => {
      registeredProcess.once('spawn', resolve);
      registeredProcess.once('error', reject);
    });
    const registered = { id: 'existing', pid: registeredProcess.pid, url: 'http://127.0.0.1:4567', password: 'fixture', version: upstream.version, runtimeIdentity: upstream };
    await writeFile(paths.serviceFile, JSON.stringify(registered));
    globalThis.fetch = async () => new Response(JSON.stringify({ data: { version: upstream.version, pid: registeredProcess.pid } }));
    for (const selected of [
      { root: paths.root, ownedRuntime: artifact, spawnImpl },
      { root: paths.root, binary: path.join(root, 'same-version-different-binary'), spawnImpl },
    ]) {
      if (selected.binary) await writeFile(selected.binary, 'different upstream executable fixture');
      await assert.rejects(ensureService(selected), /already running runtime .* selected .* active service was left running/);
      assert.deepEqual(JSON.parse(await readFile(paths.serviceFile, 'utf8')), registered);
    }
    const ownedRecord = { ...registered, version: owned.version, runtimeIdentity: owned };
    await writeFile(paths.serviceFile, JSON.stringify(ownedRecord));
    globalThis.fetch = async () => new Response(JSON.stringify({ data: { version: owned.version, pid: registeredProcess.pid, capabilities: { shellOrigin: true } } }));
    await assert.rejects(ensureService({ root: paths.root, ownedRuntime: artifact, binary, spawnImpl }), /already running runtime .* selected .* active service was left running/);
    assert.deepEqual(JSON.parse(await readFile(paths.serviceFile, 'utf8')), ownedRecord);
    await writeFile(paths.serviceFile, JSON.stringify(ownedRecord));
    globalThis.fetch = async () => new Response(JSON.stringify({ data: { version: owned.version, pid: registeredProcess.pid, capabilities: { shellOrigin: true } } }));
    await assert.rejects(ensureService({ root: paths.root, binary, spawnImpl }), /already running runtime .* selected .* active service was left running/);
    assert.deepEqual(JSON.parse(await readFile(paths.serviceFile, 'utf8')), ownedRecord);

    // A selector mismatch must leave the registered process alive.
    assert.equal(registeredProcess.exitCode, null);
    assert.deepEqual(JSON.parse(await readFile(paths.serviceFile, 'utf8')), ownedRecord);
  } finally {
    globalThis.fetch = originalFetch;
    if (registeredProcess?.exitCode === null) registeredProcess.kill('SIGKILL');
    await rm(root, { recursive: true, force: true });
  }
});

test('dead mismatched registration is cleaned before a replacement service starts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctg-dead-registration-'));
  const paths = runtimePaths({ root });
  const script = path.join(root, 'server.cjs');
  try {
    await writeFile(script, `if (process.argv[2] === '--version') { console.log('2.0.32'); process.exit(0); }\nconst http=require('node:http');const s=http.createServer((q,r)=>{if(q.url==='/api/info'){r.setHeader('content-type','application/json');r.end(JSON.stringify({version:'2.0.32',pid:process.pid}));return}r.statusCode=404;r.end()});s.listen(Number(process.argv[process.argv.indexOf('--port')+1]),'127.0.0.1',()=>console.log('server listening on http://127.0.0.1:'+s.address().port));`);
    await mkdir(path.dirname(paths.serviceFile), { recursive: true });
    await writeFile(paths.serviceFile, JSON.stringify({ id: 'dead-legacy', pid: 2_000_000_000, url: 'http://127.0.0.1:1', version: '2.0.32' }));
    const spawnImpl = (command, args, options) => spawn(process.execPath, [script, ...args], options);
    const service = await ensureService({ root, binary: process.execPath, spawnImpl, startupTimeout: 5000 });
    assert.equal(service.info.runtimeIdentity.kind, 'upstream-compatible');
    assert.equal(service.info.pid, service.pid);
    assert.notEqual(service.pid, 2_000_000_000);
    await stopService({ root });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('ensure and stop serialize on the same lifecycle lock', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctg-lifecycle-race-'));
  const script = path.join(root, 'fake-opencode.cjs');
  const source = `if (process.argv[2] === '--version') { console.log('2.0.32'); process.exit(0); }\nconst http = require('node:http'); const server = http.createServer((req,res) => { if (req.url === '/api/info') { res.setHeader('content-type','application/json'); res.end(JSON.stringify({version:'2.0.32',pid:process.pid})); } else { res.statusCode=404; res.end(); } }); server.listen(Number(process.argv[process.argv.indexOf('--port')+1]), '127.0.0.1', () => console.log('server listening on http://127.0.0.1:'+server.address().port));\n`;
  try {
    await writeFile(script, source);
    const spawnImpl = (command, args, options) => spawn(command, [script, ...args], options);
    const options = { root, binary: process.execPath, spawnImpl, startupTimeout: 5000, stopTimeout: 3000 };
    const [ensured, stopped] = await Promise.all([ensureService(options), stopService(options)]);
    assert.equal(typeof stopped, 'boolean');
    if (ensured?.pid) {
      // It either remains the correctly registered live service or stop removed it.
      const current = await readFile(runtimePaths({ root }).serviceFile, 'utf8').then(JSON.parse).catch(() => undefined);
      if (current) assert.equal(current.pid, ensured.pid);
    }
    await stopService(options).catch(() => {});
    assert.equal(await readFile(runtimePaths({ root }).serviceFile, 'utf8').then(JSON.parse).catch(() => undefined), undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('an explicitly selected unusable OpenCode binary does not fall back', async () => {
  await assert.rejects(resolveOpenCode({ binary: '/missing/ctg-opencode' }), /ENOENT|not found/i);
});

test('owned runtime resolver requires pinned manifest, native platform, checksum, and detached version', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctg-owned-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const platform = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
  const artifactPlatform = platform;
  const executable = path.join(root, `cli-${artifactPlatform}`, 'bin', process.platform === 'win32' ? 'opencode.exe' : 'opencode');
  await mkdir(path.dirname(executable), { recursive: true });
  const fake = path.join(root, 'fixture-runtime.cjs');
  await writeFile(fake, `if (process.argv[2] === '--version') console.log('opencode v${CTG_RUNTIME_VERSION}'); else process.exit(1);\n`);
  await writeFile(executable, 'fixture');
  const { createHash } = await import('node:crypto');
  const checksum = createHash('sha256').update(await readFile(executable)).digest('hex');
  const manifest = {
    owner: 'Carthagent', sourceRepository: 'https://github.com/anomalyco/opencode',
    sourceRevision: CTG_RUNTIME_SOURCE, lockSha256: CTG_RUNTIME_LOCK_SHA256, patchSha256: CTG_RUNTIME_PATCH_SHA256,
    compatibilityVersion: OPENCODE_VERSION, runtimeVersion: CTG_RUNTIME_VERSION,
    channel: 'ctg.2.0.32', platform, webUI: false,
  };
  await writeFile(path.join(root, 'ctg-runtime.json'), `${JSON.stringify(manifest)}\n`);
  await writeFile(path.join(root, 'SHA256SUMS'), `${checksum}  cli-${artifactPlatform}/bin/${process.platform === 'win32' ? 'opencode.exe' : 'opencode'}\n`);
  const spawnImpl = (command, args, options) => spawn(process.execPath, [fake, ...args], options);
  assert.equal(await resolveOwnedOpenCode(root, { spawnImpl }), executable);
  await writeFile(executable, 'modified', { mode: 0o755 });
  await assert.rejects(resolveOwnedOpenCode(root, { spawnImpl }), /SHA-256 mismatch/);
  await writeFile(executable, 'fixture');
  await writeFile(path.join(root, 'SHA256SUMS'), `${checksum}  cli-${artifactPlatform}/bin/not-opencode\n`);
  await assert.rejects(resolveOwnedOpenCode(root, { spawnImpl }), /checksum does not list/);
  await writeFile(path.join(root, 'SHA256SUMS'), `${checksum}  cli-${artifactPlatform}/bin/${process.platform === 'win32' ? 'opencode.exe' : 'opencode'}\n`);
  await writeFile(path.join(root, 'ctg-runtime.json'), `${JSON.stringify({ ...manifest, sourceRevision: 'unpinned' })}\n`);
  await assert.rejects(resolveOwnedOpenCode(root, { spawnImpl }), /not compatible/);
  await writeFile(path.join(root, 'ctg-runtime.json'), `${JSON.stringify({ ...manifest, platform: 'other-platform' })}\n`);
  await assert.rejects(resolveOwnedOpenCode(root, { spawnImpl }), /does not match this host/);
});

test('headless runner passes workspace environment and returns assistant content and status', async () => {
  const original = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, init = {}) => {
      const pathname = new URL(url).pathname;
      calls.push({ pathname, init });
      if (pathname === '/api/session') return new Response('{"data":{"id":"ses_headless"}}');
      if (pathname.endsWith('/environment')) return new Response(null, { status: 204 });
      if (pathname.endsWith('/prompt')) return new Response('{"data":{"id":"user_headless"}}');
      if (pathname.endsWith('/wait')) return new Response(null, { status: 204 });
      if (/\/api\/session\/ses_headless$/.test(pathname)) return new Response('{"data":{"id":"ses_headless","outcome":"succeeded"}}');
      if (pathname.endsWith('/message')) return new Response(JSON.stringify({ data: [{ type: 'assistant', finish: 'stop', content: [{ type: 'text', text: 'fixture result' }] }] }));
      throw new Error(`Unexpected endpoint ${pathname}`);
    };
    const result = await runHeadless({ url: 'http://127.0.0.1:3333', headers: {} }, '/workspace', 'say the fixture', { env: { FIXTURE_KEY: 'injected' } });
    assert.deepEqual(result.result, {
      status: 'stop',
      text: 'fixture result',
      error: undefined,
      message: { type: 'assistant', finish: 'stop', content: [{ type: 'text', text: 'fixture result' }] },
    });
    assert.equal(calls.find((call) => call.pathname.endsWith('/environment')).init.method, 'PUT');
    assert.equal(JSON.parse(calls.find((call) => call.pathname.endsWith('/environment')).init.body).variables.FIXTURE_KEY, 'injected');
    assert.equal(JSON.parse(calls.find((call) => call.pathname.endsWith('/prompt')).init.body).text, 'say the fixture');
    assert.equal(result.outcome, 'succeeded');
    assert.equal(result.terminal, true);
    assert.equal(result.budgetReason, undefined, 'a successful terminal session has no budget failure reason');
  } finally { globalThis.fetch = original; }
});

test('pre-aborted headless calls do not create or resume a session or return prior output', async () => {
  const original = globalThis.fetch;
  let requests = 0;
  try {
    globalThis.fetch = async () => { requests += 1; throw new Error('pre-aborted execution must not make API requests'); };
    const controller = new AbortController();
    controller.abort(new Error('already cancelled'));
    const service = { url: 'http://127.0.0.1:3333', headers: {} };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const created = await runHeadless(service, '/workspace', 'new work', { signal: controller.signal });
      assert.equal(created.outcome, 'interrupted');
      assert.equal(created.result, undefined);
      assert.deepEqual(created.messages, []);
      assert.equal(created.accepted, undefined);
      assert.equal(created.budgetReason, undefined);
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0, 'pre-aborted initial calls must not leak forwarding listeners');
      const resumed = await runHeadless(service, '/workspace', 'more work', { sessionID: 'ses_old_success', signal: controller.signal });
      assert.equal(resumed.outcome, 'interrupted');
      assert.equal(resumed.session.id, 'ses_old_success');
      assert.equal(resumed.result, undefined, 'must not reuse a prior successful assistant from the resumed session');
      assert.deepEqual(resumed.messages, []);
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0, 'pre-aborted resumed calls must not leak forwarding listeners');
    }
    assert.equal(requests, 0);
  } finally { globalThis.fetch = original; }
});

test('headless result uses newest terminal assistant from chronological conversation history', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/api/session') return new Response('{"data":{"id":"ses_resume"}}');
      if (pathname.endsWith('/environment') || pathname.endsWith('/wait')) return new Response(null, { status: 204 });
      if (pathname.endsWith('/prompt')) return new Response('{"data":{"id":"user-new"}}');
      if (pathname === '/api/session/ses_resume') return new Response('{"data":{"id":"ses_resume","outcome":"succeeded"}}');
      if (pathname.endsWith('/message')) return new Response(JSON.stringify({ data: [
        { id: 'assistant-final', type: 'assistant', time: { created: 300 }, finish: 'stop', content: [{ type: 'text', text: 'final answer' }] },
        { id: 'assistant-tool', type: 'assistant', time: { created: 250 }, finish: 'tool-calls', content: [{ type: 'tool-call', text: '' }] },
        { id: 'user-new', type: 'user', time: { created: 200 }, content: [{ type: 'text', text: 'new prompt' }] },
        { id: 'assistant-old', type: 'assistant', time: { created: 100 }, finish: 'stop', content: [{ type: 'text', text: 'old result' }] },
      ] }));
      throw new Error(`Unexpected endpoint ${pathname}`);
    };
    const result = await runHeadless({ url: 'http://127.0.0.1:3333', headers: {} }, '/workspace', 'continue', { sessionID: 'ses_resume' });
    assert.deepEqual(result.messages.map((item) => item.id), ['user-new', 'assistant-tool', 'assistant-final']);
    assert.equal(result.result.text, 'final answer');
    assert.equal(result.result.message.id, 'assistant-final', 'a preceding tool-call assistant must not replace the final response');
    assert.equal(result.budgetReason, undefined, 'a terminal successful resumed turn has no budget failure reason');
  } finally { globalThis.fetch = original; }
});

test('headless fails closed for 503 outcome projection and preserves terminal idle errors', async () => {
  const original = globalThis.fetch;
  let projectionCalls = 0;
  try {
    globalThis.fetch = async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/api/session') return new Response('{"data":{"id":"ses_projection"}}');
      if (pathname.endsWith('/environment') || pathname.endsWith('/wait')) return new Response(null, { status: 204 });
      if (pathname.endsWith('/prompt')) return new Response('{"data":{"id":"inbox_projection"}}');
      if (pathname === '/api/session/ses_projection') {
        projectionCalls += 1;
        return new Response('{"error":"projection unavailable"}', { status: 503 });
      }
      if (pathname.endsWith('/message')) return new Response(JSON.stringify({ data: [
        { id: 'idle-error', type: 'idle', outcome: 'failed', error: { message: 'provider offline' }, time: { created: 300 } },
        { id: 'user-current', type: 'user', time: { created: 200 } },
      ] }));
      throw new Error(`Unexpected endpoint ${pathname}`);
    };
    const result = await runHeadless({ url: 'http://127.0.0.1:3333', headers: {} }, '/workspace', 'go', { timeout: 100 });
    assert.equal(projectionCalls > 0, true);
    assert.equal(result.outcome, 'failed');
    assert.equal(result.terminal, true);
    assert.equal(result.error.message, 'provider offline');
    assert.equal(result.result, undefined, 'idle failure must not accidentally select an earlier assistant result');
  } finally { globalThis.fetch = original; }
});

test('aborting headless execution sends a native interrupt for that session', async () => {
  const original = globalThis.fetch;
  const paths = [];
  try {
    globalThis.fetch = async (url, init = {}) => {
      const pathname = new URL(url).pathname;
      paths.push(pathname);
      if (pathname === '/api/session') return new Response('{"data":{"id":"ses_cancel"}}');
      if (pathname.endsWith('/environment')) return new Response(null, { status: 204 });
      if (pathname.endsWith('/prompt')) return new Response('{"data":{"id":"inbox_cancel"}}');
      if (pathname.endsWith('/wait')) return pendingUntilAbort(init.signal);
      if (pathname.endsWith('/interrupt')) return new Response(null, { status: 204 });
      throw new Error(`Unexpected endpoint ${pathname}`);
    };
    const controller = new AbortController();
    const resultPromise = runHeadless({ url: 'http://127.0.0.1:3333', headers: {} }, '/workspace', 'wait', { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort(new Error('test cancellation'));
    const result = await resultPromise;
    assert.equal(result.outcome, 'interrupted');
    assert.equal(result.budgetReason, undefined);
    assert.ok(paths.includes('/api/session/ses_cancel/interrupt'));
  } finally { globalThis.fetch = original; }
});

test('headless timeout aborts the wait request and interrupts the native session', async () => {
  const original = globalThis.fetch;
  const paths = [];
  try {
    globalThis.fetch = async (url, init = {}) => {
      const pathname = new URL(url).pathname;
      paths.push(pathname);
      if (pathname === '/api/session') return new Response('{"data":{"id":"ses_timeout"}}');
      if (pathname.endsWith('/environment')) return new Response(null, { status: 204 });
      if (pathname.endsWith('/prompt')) return new Response('{"data":{"id":"inbox_timeout"}}');
      if (pathname.endsWith('/wait')) return pendingUntilAbort(init.signal);
      if (pathname.endsWith('/interrupt')) return new Response(null, { status: 204 });
      if (pathname.endsWith('/message')) return new Response('{"data":[{"id":"idle-timeout","type":"idle","outcome":"interrupted","time":{"created":3}}]}');
      throw new Error(`Unexpected endpoint ${pathname}`);
    };
    const result = await runHeadless({ url: 'http://127.0.0.1:3333', headers: {} }, '/workspace', 'hang', { timeout: 30 });
    assert.equal(result.outcome, 'interrupted');
    assert.equal(result.terminal, true);
    assert.equal(result.budgetReason, undefined);
    assert.ok(paths.includes('/api/session/ses_timeout/interrupt'));
  } finally { globalThis.fetch = original; }
});

test('headless reports timeout distinctly when no terminal outcome can be observed', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init = {}) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/api/session') return new Response('{"data":{"id":"ses_no_outcome"}}');
      if (pathname.endsWith('/environment')) return new Response(null, { status: 204 });
      if (pathname.endsWith('/prompt')) return new Response('{"data":{"id":"inbox_no_outcome"}}');
      if (pathname.endsWith('/wait')) return pendingUntilAbort(init.signal);
      if (pathname.endsWith('/interrupt')) return new Response(null, { status: 204 });
      if (pathname.endsWith('/message')) return new Response('{"data":[]}');
      if (pathname === '/api/session/ses_no_outcome') return new Response('{"data":{"id":"ses_no_outcome"}}');
      throw new Error(`Unexpected endpoint ${pathname}`);
    };
    const result = await runHeadless({ url: 'http://127.0.0.1:3333', headers: {} }, '/workspace', 'hang', { timeout: 25 });
    assert.equal(result.outcome, 'timed-out');
    assert.equal(result.terminal, false);
    assert.equal(result.budgetReason, 'timed-out');
  } finally { globalThis.fetch = original; }
});
