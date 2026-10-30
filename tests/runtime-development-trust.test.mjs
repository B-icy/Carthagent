import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { CTG_RUNTIME_PATCH_SHA256, readRuntimeReleaseManifest } from '../lib/opencode/runtime.mjs';
import { preflightNativeTestRuntimeArtifact } from '../tools/native-runtime-identity.mjs';

const developmentPatch = 'd'.repeat(64);
const target = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
const executableName = process.platform === 'win32' ? 'opencode.exe' : 'opencode';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Rewrite just the development pin in a private package copy. Release and
// development are intentionally distinct even while the checked-in pins match.
// No process environment or built-in module mocks affect other test suites.
async function fixture(t, patchSha256 = developmentPatch) {
  const root = await mkdtemp(path.join(tmpdir(), 'ctg-development-trust-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageRoot = path.join(root, 'package');
  const moduleRoot = path.join(packageRoot, 'lib/opencode');
  await mkdir(moduleRoot, { recursive: true });
  for (const name of ['runtime.mjs', 'runtime-artifact.mjs', 'runtime-github-transport.mjs']) {
    let source = await readFile(new URL(`../lib/opencode/${name}`, import.meta.url), 'utf8');
    if (name === 'runtime.mjs') {
      const declaration = /export const CTG_DEVELOPMENT_RUNTIME_PATCH_SHA256 = '[a-f0-9]{64}';/g;
      assert.equal([...source.matchAll(declaration)].length, 1);
      source = source.replace(declaration, `export const CTG_DEVELOPMENT_RUNTIME_PATCH_SHA256 = '${developmentPatch}';`);
    }
    await writeFile(path.join(moduleRoot, name), source);
  }
  await writeFile(path.join(packageRoot, 'package.json'), await readFile(new URL('../package.json', import.meta.url)));
  const runtime = await import(pathToFileURL(path.join(moduleRoot, 'runtime.mjs')).href);
  assert.notEqual(runtime.CTG_DEVELOPMENT_RUNTIME_PATCH_SHA256, runtime.CTG_RUNTIME_PATCH_SHA256);
  const ownedRoot = path.join(root, 'owned');
  const relativeExecutable = `cli-${target}/bin/${executableName}`;
  const binary = path.join(ownedRoot, relativeExecutable);
  const payload = Buffer.from('independently hashed runtime fixture');
  const digest = sha256(payload);
  const manifest = {
    owner: 'Carthagent', sourceRepository: 'https://github.com/anomalyco/opencode',
    sourceRevision: runtime.CTG_RUNTIME_SOURCE, lockSha256: runtime.CTG_RUNTIME_LOCK_SHA256,
    patchSha256, compatibilityVersion: runtime.OPENCODE_VERSION,
    runtimeVersion: runtime.CTG_RUNTIME_VERSION, channel: `ctg.${runtime.OPENCODE_VERSION}`,
    platform: target, webUI: false,
  };
  await mkdir(path.dirname(binary), { recursive: true });
  await writeFile(binary, payload, { mode: 0o755 });
  const writeManifest = value => writeFile(path.join(ownedRoot, 'ctg-runtime.json'), JSON.stringify(value));
  const writeSums = (hash = digest, name = relativeExecutable) => writeFile(path.join(ownedRoot, 'SHA256SUMS'), `${hash}  ${name}\n`);
  await writeManifest(manifest);
  await writeSums();
  const release = JSON.parse(await readFile(new URL('../lib/opencode/runtime-release.json', import.meta.url), 'utf8'));
  for (const asset of Object.values(release.assets)) asset.executableSha256 = digest;
  const releasePath = path.join(moduleRoot, 'runtime-release.json');
  await writeFile(releasePath, JSON.stringify(release));
  const calls = [];
  const spawns = [];
  const spawnVersion = version => (command, args, options) => {
    spawns.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    queueMicrotask(() => {
      child.stdout.end(`${version}\n`);
      child.stderr.end();
      child.emit('close', 0);
    });
    return child;
  };
  const spawnImpl = spawnVersion(`opencode v${runtime.CTG_RUNTIME_VERSION}`);
  const publicOptions = {
    spawnImpl,
    acquireOwnedRuntime: async input => { calls.push(input); return ownedRoot; },
  };
  return { root, runtime, ownedRoot, binary, payload, digest, relativeExecutable, manifest, release, releasePath,
    writeManifest, writeSums, calls, spawns, spawnVersion, spawnImpl, publicOptions };
}

test('published preview.10 release trust stays valid independently of the development patch pin', async t => {
  assert.equal(CTG_RUNTIME_PATCH_SHA256, 'b4238d77827d7ccf8f87fb0326551eaa62268d9387cd89e29bd0cf12bd6dafaa');
  const published = await readRuntimeReleaseManifest();
  assert.equal(published.releaseVersion, '1.1.0-preview.10');
  const f = await fixture(t, CTG_RUNTIME_PATCH_SHA256);
  assert.deepEqual(await f.runtime.readRuntimeReleaseManifest(f.releasePath), f.release);
  assert.equal(await f.runtime.resolveOpenCode(f.publicOptions), f.binary);
  const [acquisition] = f.calls;
  assert.equal(acquisition.expectedPatchSha256, CTG_RUNTIME_PATCH_SHA256);
  assert.equal(acquisition.expectedSourceRevision, f.runtime.CTG_RUNTIME_SOURCE);
  assert.equal(acquisition.expectedLockSha256, f.runtime.CTG_RUNTIME_LOCK_SHA256);
  assert.equal(acquisition.expectedArchiveSha256, f.release.assets[target].archiveSha256);
  assert.equal(acquisition.expectedExecutableSha256, f.digest);
  assert.equal(acquisition.expectedCompatibilityVersion, f.runtime.OPENCODE_VERSION);
  assert.equal(acquisition.expectedRuntimeVersion, f.runtime.CTG_RUNTIME_VERSION);
  assert.equal(acquisition.expectedChannel, f.manifest.channel);
  assert.match(acquisition.baseUrl, /\/v1\.1\.0-preview\.10$/);
  const identity = await f.runtime.runtimeIdentity(f.binary, f.publicOptions);
  assert.equal(identity.kind, 'ctg-owned');
  assert.equal(identity.patchSha256, CTG_RUNTIME_PATCH_SHA256);
  assert.equal(f.publicOptions.ownedRuntime, undefined);
});

test('default acquisition rejects development provenance even with matching pinned executable bytes', async t => {
  const f = await fixture(t);
  await assert.rejects(f.runtime.resolveOpenCode(f.publicOptions), /not compatible with the pinned/);
  assert.equal(f.calls[0].expectedPatchSha256, CTG_RUNTIME_PATCH_SHA256);
  assert.equal(f.spawns.length, 0, 'development provenance is rejected before executing --version');
});

test('public release manifest cannot promote the development pin or unpinned provenance', async t => {
  const f = await fixture(t);
  for (const changes of [
    { patchSha256: developmentPatch }, { sourceRevision: 'e'.repeat(40) },
    { lockSha256: 'e'.repeat(64) }, { runtimeVersion: '0.0.0-ctg.2.0.33' },
    { compatibilityVersion: '2.0.33' }, { releaseVersion: '1.1.0-preview.11' },
  ]) {
    await writeFile(f.releasePath, JSON.stringify({ ...f.release, ...changes }));
    await assert.rejects(f.runtime.resolveOpenCode(f.publicOptions), /Invalid or incompatible.*release manifest/);
  }
  assert.equal(f.calls.length, 0, 'invalid release metadata never reaches acquisition');
  assert.equal(f.spawns.length, 0);
});

test('default resolution rechecks the release executable pin, not a rewritten adjacent SHA256SUMS', async t => {
  const f = await fixture(t, CTG_RUNTIME_PATCH_SHA256);
  assert.equal(await f.runtime.resolveOpenCode(f.publicOptions), f.binary);
  await writeFile(f.binary, 'development executable bytes');
  await f.writeSums(sha256('development executable bytes'));
  await assert.rejects(f.runtime.resolveOpenCode(f.publicOptions), /pinned executable SHA-256 mismatch/);
  assert.equal(f.calls.length, 2);
  assert.equal(f.spawns.length, 1, 'changed bytes rejected before a second version execution');
  assert.equal(f.publicOptions.ownedRuntime, undefined);
});

test('explicit roots accept release and development provenance without consulting public release metadata', async t => {
  for (const patchSha256 of [CTG_RUNTIME_PATCH_SHA256, developmentPatch]) {
    const f = await fixture(t, patchSha256);
    // An explicit root does not turn this adjacent test record into a pin.
    await writeFile(f.releasePath, JSON.stringify({ patchSha256: 'f'.repeat(64) }));
    const options = { ...f.publicOptions, ownedRuntime: f.ownedRoot };
    assert.equal(await f.runtime.resolveOpenCode(options), f.binary);
    assert.equal(await f.runtime.resolveOwnedOpenCode(f.ownedRoot, { spawnImpl: f.spawnImpl }), f.binary);
    const identity = await f.runtime.runtimeIdentity(f.binary, options);
    assert.equal(identity.patchSha256, patchSha256);
    assert.equal(identity.binarySha256, f.digest);
    assert.equal(identity.kind, 'ctg-owned');
    assert.equal(f.calls.length, 0);
  }
});

test('explicit development roots retain every pinned provenance and host-platform check', async t => {
  const f = await fixture(t);
  for (const [field, value, error] of [
    ['owner', 'Other', /not compatible/],
    ['sourceRepository', 'https://example.test/opencode', /not compatible/],
    ['sourceRevision', 'f'.repeat(40), /not compatible/],
    ['patchSha256', 'f'.repeat(64), /not compatible/],
    ['lockSha256', 'f'.repeat(64), /not compatible/],
    ['compatibilityVersion', '2.0.33', /not compatible/],
    ['runtimeVersion', '0.0.0-ctg.2.0.33', /not compatible/],
    ['channel', 'latest', /not compatible/],
    ['webUI', true, /not compatible/],
    ['platform', 'other-platform', /does not match this host/],
  ]) {
    await f.writeManifest({ ...f.manifest, [field]: value });
    // A matching adjacent "trusted" record must not bless arbitrary metadata.
    await writeFile(f.releasePath, JSON.stringify({ ...f.release, [field]: value }));
    await assert.rejects(f.runtime.resolveOwnedOpenCode(f.ownedRoot, { spawnImpl: f.spawnImpl }), error, field);
  }
  assert.equal(f.spawns.length, 0);
});

test('explicit development roots require exact executable layout, actual hash, checksum entry, and version', async t => {
  const f = await fixture(t);
  const options = { ownedRuntime: f.ownedRoot, spawnImpl: f.spawnImpl };
  await writeFile(f.binary, 'tampered bytes');
  await assert.rejects(f.runtime.resolveOpenCode(options), /executable SHA-256 mismatch/);
  await writeFile(f.binary, f.payload);
  await f.writeSums(f.digest, `cli-${target}/bin/not-opencode`);
  await assert.rejects(f.runtime.resolveOpenCode(options), /checksum does not list/);
  await rm(path.join(f.ownedRoot, 'SHA256SUMS'));
  await assert.rejects(f.runtime.resolveOpenCode(options), /checksums are missing/);
  await f.writeSums();
  await writeFile(path.join(path.dirname(f.binary), 'not-opencode'), f.payload);
  await rm(f.binary);
  await assert.rejects(f.runtime.resolveOpenCode(options), /executable is missing/);
  assert.equal(f.spawns.length, 0);
  await writeFile(f.binary, f.payload);
  for (const version of ['opencode v2.0.32', 'opencode v9.0.0-ctg.2.0.32', `opencode v${f.runtime.CTG_RUNTIME_VERSION} extra`]) {
    await assert.rejects(f.runtime.resolveOpenCode({ ...options, spawnImpl: f.spawnVersion(version) }), /identity mismatch/);
  }
});

test('explicit binary remains upstream-compatible and takes precedence over an owned root', async t => {
  const f = await fixture(t);
  await f.writeManifest({ ...f.manifest, patchSha256: 'f'.repeat(64) });
  const options = { binary: f.binary, ownedRuntime: f.ownedRoot,
    spawnImpl: f.spawnVersion(`opencode v${f.runtime.OPENCODE_VERSION}`) };
  assert.equal(await f.runtime.resolveOpenCode(options), f.binary);
  const identity = await f.runtime.runtimeIdentity(f.binary, options);
  assert.equal(identity.kind, 'upstream-compatible');
  assert.equal(identity.version, f.runtime.OPENCODE_VERSION);
});

test('native preflight requires independently supplied development provenance and bytes, not released metadata', async t => {
  const f = await fixture(t);
  const testManifestPath = path.join(f.root, 'trusted-development-test.json');
  const options = { ownedRoot: f.ownedRoot, expectedManifestPath: testManifestPath, env: {}, spawnImpl: f.spawnImpl };
  await writeFile(testManifestPath, JSON.stringify(f.release));
  await assert.rejects(preflightNativeTestRuntimeArtifact(options), /patchSha256 mismatch/);
  assert.equal(f.spawns.length, 0);
  const developmentManifest = { ...f.release, patchSha256: developmentPatch };
  await writeFile(testManifestPath, JSON.stringify(developmentManifest));
  const result = await preflightNativeTestRuntimeArtifact(options);
  assert.deepEqual(result.expectedManifest, developmentManifest);
  assert.equal(result.identity.patchSha256, developmentPatch);
  assert.equal(result.identity.binarySha256, f.digest);
  assert.equal(await f.runtime.resolveOpenCode({ ownedRuntime: f.ownedRoot, spawnImpl: f.spawnImpl }), f.binary);
  await writeFile(testManifestPath, JSON.stringify({ ...developmentManifest, patchSha256: 'f'.repeat(64) }));
  await assert.rejects(preflightNativeTestRuntimeArtifact({ ...options, env: { CTG_TEST_RUNTIME_SHA256: f.digest } }), /patchSha256 mismatch/);
  await writeFile(testManifestPath, JSON.stringify(developmentManifest));
  await writeFile(f.binary, 'unreviewed rebuild');
  await assert.rejects(preflightNativeTestRuntimeArtifact(options), /binary SHA-256 mismatch/);
  assert.equal((await readRuntimeReleaseManifest()).patchSha256, CTG_RUNTIME_PATCH_SHA256);
});
