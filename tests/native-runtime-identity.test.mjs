import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  loadNativeTestRuntime,
  preflightNativeTestRuntimeArtifact,
  NATIVE_TEST_COMPATIBILITY_VERSION,
} from '../tools/native-runtime-identity.mjs';

const payload = Buffer.from('reviewed fixture executable bytes');
const digest = createHash('sha256').update(payload).digest('hex');
const sourceRevision = '843a6c514e606b436a7fe713422ace0a93ad3d61';
const patchSha256 = 'a'.repeat(64);
const lockSha256 = 'b'.repeat(64);
const runtimeVersion = '0.0.0-ctg.2.0.32';
const platform = process.platform === 'win32' ? `windows-${process.arch}` : `${process.platform}-${process.arch}`;

async function fixture(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ctg-native-identity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ownedRoot = join(root, 'owned');
  const executableName = platform.startsWith('windows-') ? 'opencode.exe' : 'opencode';
  const binary = join(ownedRoot, `cli-${platform}`, 'bin', executableName);
  await mkdir(join(ownedRoot, `cli-${platform}`, 'bin'), { recursive: true });
  await writeFile(binary, payload);
  const manifest = {
    owner: 'Carthagent',
    sourceRepository: 'https://github.com/anomalyco/opencode',
    compatibilityVersion: NATIVE_TEST_COMPATIBILITY_VERSION,
    runtimeVersion,
    sourceRevision,
    patchSha256,
    lockSha256,
    channel: `ctg.${NATIVE_TEST_COMPATIBILITY_VERSION}`,
    platform,
    webUI: false,
    ...overrides,
  };
  await writeFile(join(ownedRoot, 'ctg-runtime.json'), JSON.stringify(manifest));
  const release = {
    version: 1,
    releaseVersion: '1.2.3',
    compatibilityVersion: NATIVE_TEST_COMPATIBILITY_VERSION,
    runtimeVersion,
    sourceRevision,
    patchSha256,
    lockSha256,
    assets: {
      [platform]: {
        name: `opencode-${platform}.tar.gz`,
        archiveSha256: 'c'.repeat(64),
        executableSha256: digest,
      },
    },
  };
  return { binary, ownedRoot, release };
}

function versionSpawner(version) {
  return (_binary, args, options) => {
    assert.deepEqual(args, ['--version']);
    assert.equal(options.windowsHide, true);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      child.stdout.emit('data', `${version}\n`);
      child.emit('close', 0);
    });
    return child;
  };
}

function versionSpawnerWithEnv(version, observeEnv) {
  return (_binary, args, options) => {
    assert.deepEqual(args, ['--version']);
    assert.equal(options.windowsHide, true);
    observeEnv(options.env);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      child.stdout.emit('data', `${version}\n`);
      child.emit('close', 0);
    });
    return child;
  };
}

test('accepts exactly the upstream compatibility CLI identity', async t => {
  const { binary } = await fixture(t);
  assert.deepEqual(await loadNativeTestRuntime({ binary, spawnImpl: versionSpawner('opencode v2.0.32') }), {
    binary,
    compatibilityVersion: '2.0.32',
    runtimeVersion: '2.0.32',
  });
});

test('independent native version verification removes only the draft transport credential from child env', async t => {
  const { binary, ownedRoot, release } = await fixture(t);
  let childEnv;
  await loadNativeTestRuntime({
    binary,
    ownedRoot,
    expectedManifest: release,
    env: { PATH: '/fixture/path', LANG: 'C.UTF-8', CTG_RUNTIME_GITHUB_TOKEN: 'fake-runtime-token' },
    spawnImpl: versionSpawnerWithEnv(`opencode v${runtimeVersion}`, env => { childEnv = env; }),
  });
  assert.equal(childEnv.CTG_RUNTIME_GITHUB_TOKEN, undefined);
  assert.equal(childEnv.PATH, '/fixture/path');
  assert.equal(childEnv.LANG, 'C.UTF-8');
});

test('accepts the CTG runtime only with pinned provenance and independently expected hash', async t => {
  const { binary, ownedRoot, release } = await fixture(t);
  const runtime = await loadNativeTestRuntime({
    binary,
    ownedRoot,
    expectedManifest: release,
    spawnImpl: versionSpawner(`opencode v${runtimeVersion}`),
  });
  assert.deepEqual(runtime, {
    binary,
    compatibilityVersion: '2.0.32',
    runtimeVersion,
    binarySha256: digest,
    sourceRevision,
    patchSha256,
    lockSha256,
    platform,
  });
});

test('uses the explicit developer hash input when no trusted release record is passed', async t => {
  const { binary, ownedRoot, release } = await fixture(t);
  const runtime = await loadNativeTestRuntime({
    binary,
    ownedRoot,
    expectedManifest: release,
    env: { CTG_TEST_RUNTIME_SHA256: digest },
    spawnImpl: versionSpawner(`opencode v${runtimeVersion}`),
  });
  assert.equal(runtime.binarySha256, digest);
});

test('preflights an injected artifact against an explicit trusted manifest before runtime selection', async t => {
  const { ownedRoot, binary, release } = await fixture(t);
  const expectedManifestPath = join(ownedRoot, 'trusted-release.json');
  await writeFile(expectedManifestPath, JSON.stringify(release));
  const result = await preflightNativeTestRuntimeArtifact({
    ownedRoot,
    expectedManifestPath,
    spawnImpl: versionSpawner(`opencode v${runtimeVersion}`),
  });
  assert.equal(result.identity.binary, binary);
  assert.deepEqual(result.expectedManifest, release);
});

test('requires a trusted test manifest before preflighting an injected artifact', async t => {
  const { ownedRoot } = await fixture(t);
  await assert.rejects(preflightNativeTestRuntimeArtifact({ ownedRoot }), /trusted CTG_TEST_RUNTIME_RELEASE_MANIFEST is required/);
});

test('rejects versions that merely contain the compatibility version', async t => {
  const { binary } = await fixture(t);
  await assert.rejects(loadNativeTestRuntime({
    binary,
    spawnImpl: versionSpawner('opencode v9.0.0-ctg.2.0.32'),
  }), /Unsupported native test runtime version/);
});

test('requires trusted release metadata for owned artifacts', async t => {
  const { binary, ownedRoot } = await fixture(t);
  await assert.rejects(loadNativeTestRuntime({ binary, ownedRoot }), /required pinned identity fields/);
});

test('rejects self-declared provenance mismatches against trusted release metadata before execution', async t => {
  const cases = [
    ['sourceRevision', 'f'.repeat(40), /sourceRevision mismatch/],
    ['patchSha256', 'd'.repeat(64), /patchSha256 mismatch/],
    ['lockSha256', 'e'.repeat(64), /lockSha256 mismatch/],
    ['compatibilityVersion', '2.0.33', /compatibilityVersion mismatch/],
    ['runtimeVersion', '0.0.0-ctg.2.0.33', /runtimeVersion mismatch/],
  ];
  for (const [field, value, error] of cases) {
    const { binary, ownedRoot, release } = await fixture(t, { [field]: value });
    let spawned = false;
    await assert.rejects(loadNativeTestRuntime({ binary, ownedRoot, expectedManifest: release, spawnImpl: (...args) => { spawned = true; return versionSpawner(`opencode v${runtimeVersion}`)(...args); } }), error);
    assert.equal(spawned, false, `${field} mismatch must be rejected before executing binary`);
  }
});

test('checks owned executable path and bytes before invoking version command', async t => {
  const { binary, ownedRoot, release } = await fixture(t);
  let spawned = false;
  await assert.rejects(loadNativeTestRuntime({
    binary: join(ownedRoot, '..', 'opencode'),
    ownedRoot,
    expectedManifest: release,
    spawnImpl: () => { spawned = true; throw Error('must not execute'); },
  }), /executable must be/);
  await writeFile(binary, 'tampered executable');
  await assert.rejects(loadNativeTestRuntime({
    binary,
    ownedRoot,
    expectedManifest: release,
    spawnImpl: () => { spawned = true; throw Error('must not execute'); },
  }), /binary SHA-256 mismatch/);
  assert.equal(spawned, false);
});
