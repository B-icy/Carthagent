import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import {
  REQUIRED_RUNTIME_TARGETS,
  validateRuntimeReleaseManifest,
  verifyOwnedRuntimeRelease,
} from '../tools/verify-owned-runtime-release.mjs';

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

test('validates required five-platform manifest then supplies every trusted digest to acquisition', async () => {
  const { root, manifestPath, manifest } = await fixture();
  const calls = [];
  await verifyOwnedRuntimeRelease({
    releaseVersion: manifest.releaseVersion,
    manifestPath,
    assetsBaseUrl: 'https://github.example/releases/v9.8.7',
    repoRoot: root,
    acquireRuntime: async (options) => { calls.push(options); return `/verified/${options.platform}-${options.arch}`; },
  });
  assert.equal(root.length > 0, true);
  assert.equal(calls.length, 5);
  for (const [key, [platform, arch, name]] of Object.entries(REQUIRED_RUNTIME_TARGETS)) {
    const call = calls.find((item) => `${item.platform}-${item.arch}` === key);
    assert.ok(call, `acquired ${key}`);
    assert.equal(call.baseUrl, 'https://github.example/releases/v9.8.7');
    assert.equal(call.expectedArchiveSha256, manifest.assets[key].archiveSha256);
    assert.equal(call.expectedExecutableSha256, manifest.assets[key].executableSha256);
    assert.equal(call.expectedSourceRevision, manifest.sourceRevision);
    assert.equal(call.expectedPatchSha256, manifest.patchSha256);
    assert.equal(call.expectedLockSha256, manifest.lockSha256);
    assert.equal(manifest.assets[key].name, name);
    assert.equal(call.platform, platform);
    assert.equal(call.arch, arch);
  }
});

test('rejects absent Linux arm64 and a release-version mismatch before acquiring anything', async () => {
  const { root, manifestPath, manifest } = await fixture();
  delete manifest.assets['linux-arm64'];
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(verifyOwnedRuntimeRelease({
    releaseVersion: manifest.releaseVersion,
    manifestPath,
    assetsBaseUrl: 'https://example.test/release',
    repoRoot: root,
    acquireRuntime: async () => assert.fail('invalid manifest must not acquire assets'),
  }), /must contain exactly/);
  await assert.rejects(verifyOwnedRuntimeRelease({
    releaseVersion: '9.8.8', manifestPath, assetsBaseUrl: 'https://example.test/release', repoRoot: root,
    acquireRuntime: async () => assert.fail('wrong release version must not acquire assets'),
  }), /does not match/);
});

test('rejects malformed digests and noncanonical platform asset names', async () => {
  const { manifest } = await fixture();
  manifest.assets['windows-x64'].archiveSha256 = 'not-a-digest';
  assert.throws(() => validateRuntimeReleaseManifest(manifest, manifest.releaseVersion), /archiveSha256/);
  manifest.assets['windows-x64'].archiveSha256 = 'a'.repeat(64);
  manifest.assets['windows-x64'].name = 'arbitrary.tar.gz';
  assert.throws(() => validateRuntimeReleaseManifest(manifest, manifest.releaseVersion), /asset name/);
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctg-runtime-release-manifest-'));
  roots.push(root);
  await mkdir(path.join(root, 'script/ctg'), { recursive: true });
  await mkdir(path.join(root, 'docs/patches'), { recursive: true });
  const patch = Buffer.from('fixture pinned patch');
  const patchSha256 = createHash('sha256').update(patch).digest('hex');
  const sourceRevision = '0123456789abcdef0123456789abcdef01234567';
  const lockSha256 = 'b'.repeat(64);
  await writeFile(path.join(root, 'script/ctg/build-owned-runtime.sh'), [
    `EXPECTED_SOURCE="${sourceRevision}"`, `EXPECTED_PATCH="${patchSha256}"`, `EXPECTED_LOCK="${lockSha256}"`,
  ].join('\n'));
  await writeFile(path.join(root, 'docs/patches/opencode-v2.0.32-session-ui.patch'), patch);
  const manifest = {
    version: 1,
    releaseVersion: '9.8.7',
    compatibilityVersion: '2.0.32',
    runtimeVersion: '0.0.0-ctg.2.0.32',
    sourceRevision,
    patchSha256,
    lockSha256,
    assets: Object.fromEntries(Object.entries(REQUIRED_RUNTIME_TARGETS).map(([key, [, , name]], index) => [key, {
      name,
      archiveSha256: (index + 1).toString(16).repeat(64),
      executableSha256: (index + 6).toString(16).repeat(64),
    }])),
  };
  const manifestPath = path.join(root, 'runtime-release.json');
  await writeFile(manifestPath, JSON.stringify(manifest));
  return { root, manifestPath, manifest };
}
