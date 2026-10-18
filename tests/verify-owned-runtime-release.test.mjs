import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import { afterEach, test } from 'node:test';
import {
  REQUIRED_RUNTIME_TARGETS,
  validateRuntimeReleaseManifest,
  verifyOwnedRuntimeRelease,
} from '../tools/verify-owned-runtime-release.mjs';
import { createRuntimeGithubFetch } from '../lib/opencode/runtime-github-transport.mjs';

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
    assert.equal(call.expectedCompatibilityVersion, manifest.compatibilityVersion);
    assert.equal(call.expectedRuntimeVersion, manifest.runtimeVersion);
    assert.equal(call.expectedChannel, `ctg.${manifest.compatibilityVersion}`);
    assert.equal(manifest.assets[key].name, name);
    assert.equal(call.platform, platform);
    assert.equal(call.arch, arch);
  }
});

test('verifier wires the opt-in credential transport to every production acquisition', async () => {
  const { root, manifestPath, manifest } = await fixture();
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify([]), { status: 200 });
  };
  await verifyOwnedRuntimeRelease({
    releaseVersion: manifest.releaseVersion, manifestPath,
    assetsBaseUrl: `https://github.com/B-icy/Carthagent/releases/download/v${manifest.releaseVersion}`,
    repoRoot: root, runtimeToken: 'fixture-token-never-real', fetchImpl: fakeFetch,
    acquireRuntime: async (options) => {
      assert.equal(typeof options.fetchImpl, 'function');
      // Exercise the injected fetch adapter without initiating external I/O.
      await assert.rejects(options.fetchImpl(`${options.baseUrl}/${manifest.assets['linux-x64'].name}`), /release was not found/);
      return '/verified';
    },
  });
  assert.equal(calls.length, 5);
  assert.ok(calls.every(({ url, init }) => url.startsWith('https://api.github.com/repos/B-icy/Carthagent/releases?')));
  assert.ok(calls.every(({ init }) => init.headers.authorization === 'Bearer fixture-token-never-real'));
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

test('verifies all five USTAR assets through the production acquirer over loopback', async (t) => {
  const { root, manifestPath, manifest } = await fixture();
  const assets = new Map();
  for (const [key, [platform, arch, name]] of Object.entries(REQUIRED_RUNTIME_TARGETS)) {
    const executable = Buffer.from(`fixture executable for ${key}\n`);
    const executablePath = `cli-${key}/bin/${key.startsWith('windows-') ? 'opencode.exe' : 'opencode'}`;
    const runtime = {
      owner: 'Carthagent', sourceRepository: 'https://github.com/anomalyco/opencode',
      sourceRevision: manifest.sourceRevision, patchSha256: manifest.patchSha256,
      lockSha256: manifest.lockSha256, compatibilityVersion: manifest.compatibilityVersion,
      runtimeVersion: manifest.runtimeVersion, channel: `ctg.${manifest.compatibilityVersion}`,
      platform: `${platform}-${arch}`, webUI: false,
    };
    const archive = makeUstarArchive([
      [executablePath, executable, 0o755],
      ['SHA256SUMS', Buffer.from(`${sha(executable)}  ${executablePath}\n`), 0o644],
      ['ctg-runtime.json', Buffer.from(JSON.stringify(runtime)), 0o644],
      ['LICENSE', Buffer.from('fixture license\n'), 0o644],
    ]);
    manifest.assets[key].archiveSha256 = sha(archive);
    manifest.assets[key].executableSha256 = sha(executable);
    assets.set(`/releases/${manifest.releaseVersion}/${name}`, archive);
  }
  await writeFile(manifestPath, JSON.stringify(manifest));
  const server = createServer((request, response) => {
    const body = assets.get(new URL(request.url, 'http://127.0.0.1').pathname);
    if (!body) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-length': body.length }).end(body);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const assetsBaseUrl = `http://127.0.0.1:${server.address().port}/releases/${manifest.releaseVersion}`;

  await verifyOwnedRuntimeRelease({
    releaseVersion: manifest.releaseVersion,
    manifestPath,
    assetsBaseUrl,
    repoRoot: root,
    cacheRoot: path.join(root, 'acquirer-cache'),
  });
  assert.equal(assets.size, 5);
});

test('verifies five draft assets through API metadata and asset-id downloads with the production acquirer', async (t) => {
  const { root, manifestPath, manifest } = await fixture();
  const archiveByName = new Map();
  const assetsById = new Map();
  let nextId = 101;
  for (const [key, [platform, arch, name]] of Object.entries(REQUIRED_RUNTIME_TARGETS)) {
    const executable = Buffer.from(`draft fixture executable ${key}`);
    const executablePath = `cli-${key}/bin/${key.startsWith('windows-') ? 'opencode.exe' : 'opencode'}`;
    const runtime = {
      owner: 'Carthagent', sourceRepository: 'https://github.com/anomalyco/opencode',
      sourceRevision: manifest.sourceRevision, patchSha256: manifest.patchSha256,
      lockSha256: manifest.lockSha256, compatibilityVersion: manifest.compatibilityVersion,
      runtimeVersion: manifest.runtimeVersion, channel: `ctg.${manifest.compatibilityVersion}`,
      platform: `${platform}-${arch}`, webUI: false,
    };
    const archive = makeUstarArchive([
      [executablePath, executable, 0o755],
      ['SHA256SUMS', Buffer.from(`${sha(executable)}  ${executablePath}\n`), 0o644],
      ['ctg-runtime.json', Buffer.from(JSON.stringify(runtime)), 0o644],
      ['LICENSE', Buffer.from('fixture license\n'), 0o644],
    ]);
    manifest.assets[key].archiveSha256 = sha(archive);
    manifest.assets[key].executableSha256 = sha(executable);
    const id = nextId++;
    archiveByName.set(name, archive);
    assetsById.set(id, { name, archive });
  }
  await writeFile(manifestPath, JSON.stringify(manifest));
  const token = 'fixture-token-never-real';
  const requests = [];
  const fakeFetch = async (input, init = {}) => {
    const url = new URL(input);
    requests.push({ url, init });
    if (url.origin !== 'https://api.github.com') throw new Error('Unexpected external fixture request');
    if (url.pathname === '/repos/B-icy/Carthagent/releases') {
      return Response.json([{ id: 88, tag_name: `v${manifest.releaseVersion}` }]);
    }
    if (url.pathname === '/repos/B-icy/Carthagent/releases/88/assets') {
      return Response.json([...assetsById].map(([id, asset]) => ({
        id, name: asset.name, state: 'uploaded', size: asset.archive.length,
        url: `https://api.github.com/repos/B-icy/Carthagent/releases/assets/${id}`,
      })));
    }
    const assetId = Number(url.pathname.match(/\/releases\/assets\/(\d+)$/)?.[1]);
    if (assetId && assetsById.has(assetId)) return new Response(assetsById.get(assetId).archive);
    throw new Error(`Unexpected fixture API path ${url.pathname}`);
  };
  await verifyOwnedRuntimeRelease({
    releaseVersion: manifest.releaseVersion,
    manifestPath,
    assetsBaseUrl: `https://github.com/B-icy/Carthagent/releases/download/v${manifest.releaseVersion}`,
    repoRoot: root,
    cacheRoot: path.join(root, 'draft-acquirer-cache'),
    runtimeToken: token,
    fetchImpl: fakeFetch,
  });
  assert.equal(requests.filter(({ url }) => url.pathname.includes('/releases/assets/')).length, 5);
  assert.ok(requests.every(({ init }) => init.headers.authorization === `Bearer ${token}`));
  assert.equal(archiveByName.size, 5);
});

test('draft archive bytes with a wrong trusted digest fail before extraction or executable acceptance', async () => {
  const { root, manifestPath, manifest } = await fixture();
  const key = 'linux-x64';
  const [, , name] = REQUIRED_RUNTIME_TARGETS[key];
  const executable = Buffer.from('must not be accepted');
  const archive = makeUstarArchive([
    [`cli-${key}/bin/opencode`, executable, 0o755],
    ['SHA256SUMS', Buffer.from(`${sha(executable)}  cli-${key}/bin/opencode\n`), 0o644],
    ['ctg-runtime.json', Buffer.from('{}'), 0o644],
  ]);
  manifest.assets[key].archiveSha256 = 'f'.repeat(64);
  await writeFile(manifestPath, JSON.stringify(manifest));
  let assetRequested = false;
  const token = 'fixture-token-never-real';
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname === '/repos/B-icy/Carthagent/releases') return Response.json([{ id: 88, tag_name: `v${manifest.releaseVersion}` }]);
    if (url.pathname === '/repos/B-icy/Carthagent/releases/88/assets') return Response.json([{ id: 777, name, state: 'uploaded', size: archive.length, url: 'https://api.github.com/repos/B-icy/Carthagent/releases/assets/777' }]);
    if (url.pathname === '/repos/B-icy/Carthagent/releases/assets/777') { assetRequested = true; return new Response(archive); }
    assert.fail(`Unexpected API URL ${url.href}`);
  };
  const acquire = await import('../lib/opencode/runtime-artifact.mjs');
  await assert.rejects(acquire.acquireOwnedRuntime({
    releaseVersion: manifest.releaseVersion, platform: 'linux', arch: 'x64', assetName: name,
    baseUrl: `https://github.com/B-icy/Carthagent/releases/download/v${manifest.releaseVersion}`,
    expectedArchiveSha256: manifest.assets[key].archiveSha256,
    expectedExecutableSha256: sha(executable), expectedSourceRevision: manifest.sourceRevision,
    expectedPatchSha256: manifest.patchSha256, expectedLockSha256: manifest.lockSha256,
    expectedCompatibilityVersion: manifest.compatibilityVersion, expectedRuntimeVersion: manifest.runtimeVersion,
    expectedChannel: `ctg.${manifest.compatibilityVersion}`, cacheRoot: path.join(root, 'bad-draft-cache'),
    fetchImpl: createRuntimeGithubFetch({ token, fetchImpl }),
  }), /archive SHA-256 mismatch/);
  assert.equal(assetRequested, true);
  await assert.rejects(import('node:fs/promises').then(({ access }) => access(path.join(root, 'bad-draft-cache', manifest.releaseVersion, key))));
});

test('production acquisition rejects an embedded channel mismatch against the pinned compatibility version', async (t) => {
  const { root, manifestPath, manifest } = await fixture();
  const [key, [platform, arch]] = Object.entries(REQUIRED_RUNTIME_TARGETS)[0];
  const executable = Buffer.from('channel mismatch fixture executable');
  const executablePath = `cli-${key}/bin/opencode`;
  const runtime = {
    owner: 'Carthagent', sourceRepository: 'https://github.com/anomalyco/opencode',
    sourceRevision: manifest.sourceRevision, patchSha256: manifest.patchSha256,
    lockSha256: manifest.lockSha256, compatibilityVersion: manifest.compatibilityVersion,
    runtimeVersion: manifest.runtimeVersion, channel: 'ctg.wrong-version',
    platform: `${platform}-${arch}`, webUI: false,
  };
  const archive = makeUstarArchive([
    [executablePath, executable, 0o755],
    ['SHA256SUMS', Buffer.from(`${sha(executable)}  ${executablePath}\n`), 0o644],
    ['ctg-runtime.json', Buffer.from(JSON.stringify(runtime)), 0o644],
    ['LICENSE', Buffer.from('fixture license\n'), 0o644],
  ]);
  manifest.assets[key].archiveSha256 = sha(archive);
  manifest.assets[key].executableSha256 = sha(executable);
  await writeFile(manifestPath, JSON.stringify(manifest));
  const server = createServer((_request, response) => response.writeHead(200, { 'content-length': archive.length }).end(archive));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));

  await assert.rejects(verifyOwnedRuntimeRelease({
    releaseVersion: manifest.releaseVersion,
    manifestPath,
    assetsBaseUrl: `http://127.0.0.1:${server.address().port}/releases/${manifest.releaseVersion}`,
    repoRoot: root,
    cacheRoot: path.join(root, 'wrong-channel-cache'),
  }), /channel mismatch/);
});

test('verifier pins the recipe-selected combined patch rather than the preserved base patch', async () => {
  const { root, manifestPath, manifest } = await fixture();
  const calls = [];
  await verifyOwnedRuntimeRelease({
    releaseVersion: manifest.releaseVersion, manifestPath,
    assetsBaseUrl: 'https://example.test/release', repoRoot: root,
    acquireRuntime: async (options) => { calls.push(options); return '/verified'; },
  });
  assert.equal(calls.length, 5);
  assert.equal(calls[0].expectedPatchSha256, manifest.patchSha256);
});

test('verifier rejects missing or tampered recipe-selected patch before acquiring assets', async (t) => {
  await t.test('missing selected patch does not fall back to preserved base', async () => {
    const { root, manifestPath, manifest } = await fixture();
    await rm(path.join(root, 'docs/patches/opencode-v2.0.32-session-ui-combined-v1.patch'));
    let calls = 0;
    await assert.rejects(verifyOwnedRuntimeRelease({
      releaseVersion: manifest.releaseVersion, manifestPath,
      assetsBaseUrl: 'https://example.test/release', repoRoot: root,
      acquireRuntime: async () => { calls += 1; return '/verified'; },
    }), /ENOENT/);
    assert.equal(calls, 0);
  });
  await t.test('tampered selected patch fails its recipe digest', async () => {
    const { root, manifestPath, manifest } = await fixture();
    await writeFile(
      path.join(root, 'docs/patches/opencode-v2.0.32-session-ui-combined-v1.patch'),
      'tampered combined patch',
    );
    let calls = 0;
    await assert.rejects(verifyOwnedRuntimeRelease({
      releaseVersion: manifest.releaseVersion, manifestPath,
      assetsBaseUrl: 'https://example.test/release', repoRoot: root,
      acquireRuntime: async () => { calls += 1; return '/verified'; },
    }), /Pinned patch bytes do not match the build recipe/);
    assert.equal(calls, 0);
  });
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
    'patch_file="$ROOT/docs/patches/opencode-v2.0.32-session-ui-combined-v1.patch"',
  ].join('\n'));
  await writeFile(path.join(root, 'docs/patches/opencode-v2.0.32-session-ui-combined-v1.patch'), patch);
  await writeFile(path.join(root, 'docs/patches/opencode-v2.0.32-session-ui.patch'), Buffer.from('preserved base patch with different bytes'));
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

function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function octal(value, width) { return Buffer.from(`${value.toString(8).padStart(width - 1, '0')}\0`); }
function tarEntry(name, data, mode) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  octal(mode, 8).copy(header, 100);
  octal(0, 8).copy(header, 108);
  octal(0, 8).copy(header, 116);
  octal(data.length, 12).copy(header, 124);
  octal(0, 12).copy(header, 136);
  header.fill(32, 148, 156);
  header[156] = '0'.charCodeAt(0);
  header.write('ustar\0', 257, 6);
  header.write('00', 263, 2);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  octal(checksum, 8).copy(header, 148);
  return Buffer.concat([header, data, Buffer.alloc((512 - data.length % 512) % 512)]);
}
function makeUstarArchive(files) {
  const entries = files.map(([name, data, mode]) => tarEntry(name, data, mode));
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
}
