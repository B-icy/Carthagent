import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, test } from 'node:test';
import { verifyOwnedRuntimeRelease } from '../tools/verify-owned-runtime-release.mjs';

const sourceRevision = '0123456789abcdef0123456789abcdef01234567';
const patchBytes = Buffer.from('pinned fixture patch');
const patchSha256 = sha(patchBytes);
const lockSha256 = 'b'.repeat(64);
const version = '9.8.7';
const platforms = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'windows-x64'];
const temporary = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test('verifies all five trusted archive digests, inner provenance, and executable digests', async () => {
  const fixture = await makeFixture();
  await verifyOwnedRuntimeRelease(fixture);
});

test('rejects altered archive bytes even if the downloaded asset name is correct', async () => {
  const fixture = await makeFixture();
  const target = path.join(fixture.assetsDir, 'opencode-linux-arm64.tar.gz');
  await writeFile(target, Buffer.concat([await readFile(target), Buffer.from('tampered')]));
  await assert.rejects(verifyOwnedRuntimeRelease(fixture), /SHA-256 does not match/);
});

test('rejects a platform set that omits Linux arm64', async () => {
  const fixture = await makeFixture();
  await rm(path.join(fixture.assetsDir, 'opencode-linux-arm64.tar.gz'));
  await assert.rejects(verifyOwnedRuntimeRelease(fixture), /must include all five/);
});

async function makeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctg-runtime-release-test-'));
  temporary.push(root);
  const assetsDir = path.join(root, 'assets');
  const repoRoot = path.join(root, 'repo');
  await mkdir(assetsDir);
  await mkdir(path.join(repoRoot, 'script/ctg'), { recursive: true });
  await mkdir(path.join(repoRoot, 'docs/patches'), { recursive: true });
  await writeFile(path.join(repoRoot, 'script/ctg/build-owned-runtime.sh'), [
    `EXPECTED_SOURCE="${sourceRevision}"`, `EXPECTED_PATCH="${patchSha256}"`, `EXPECTED_LOCK="${lockSha256}"`,
  ].join('\n'));
  await writeFile(path.join(repoRoot, 'docs/patches/opencode-v2.0.32-session-ui.patch'), patchBytes);
  const release = {
    version: 1,
    releaseVersion: version,
    compatibilityVersion: '2.0.32',
    runtimeVersion: '0.0.0-ctg.2.0.32',
    sourceRevision,
    patchSha256,
    lockSha256,
    assets: {},
  };
  const archives = [];
  for (const platform of platforms) {
    const name = `opencode-${platform}.tar.gz`;
    const osName = platform.split('-')[0];
    const executablePath = `cli-${platform}/bin/${osName === 'windows' ? 'opencode.exe' : 'opencode'}`;
    const executable = Buffer.from(`fixture ${platform}`);
    const executableSha256 = sha(executable);
    const innerManifest = {
      owner: 'Carthagent', sourceRepository: 'https://github.com/anomalyco/opencode',
      sourceRevision, lockSha256, patchSha256, compatibilityVersion: '2.0.32',
      runtimeVersion: '0.0.0-ctg.2.0.32', channel: 'ctg.2.0.32', platform: `${osName}-${platform.split('-')[1]}`, webUI: false,
    };
    const sums = `${executableSha256}  ${executablePath}\n`;
    const archive = makeArchive([
      [executablePath, executable],
      ['ctg-runtime.json', Buffer.from(JSON.stringify(innerManifest))],
      ['SHA256SUMS', Buffer.from(sums)],
    ]);
    archives.push([name, archive]);
    release.assets[platform] = { name, archiveSha256: sha(archive), executableSha256 };
  }
  for (const [name, archive] of archives) await writeFile(path.join(assetsDir, name), archive);
  const manifestPath = path.join(root, 'runtime-release.json');
  await writeFile(manifestPath, JSON.stringify(release));
  return { version, manifestPath, assetsDir, repoRoot };
}

function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function tarOctal(value, width) { return Buffer.from(`${value.toString(8).padStart(width - 1, '0')}\0`); }
function tarEntry(name, data) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  tarOctal(0o644, 8).copy(header, 100);
  tarOctal(0, 8).copy(header, 108);
  tarOctal(0, 8).copy(header, 116);
  tarOctal(data.length, 12).copy(header, 124);
  tarOctal(0, 12).copy(header, 136);
  header.fill(32, 148, 156);
  header[156] = '0'.charCodeAt(0);
  header.write('ustar\0', 257, 6);
  header.write('00', 263, 2);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  tarOctal(checksum, 8).copy(header, 148);
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([header, data, padding]);
}
function makeArchive(entries) {
  return gzipSync(Buffer.concat([...entries.map(([name, data]) => tarEntry(name, data)), Buffer.alloc(1024)]));
}
