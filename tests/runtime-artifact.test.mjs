import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import { after, before, test } from 'node:test';
import { acquireOwnedRuntime } from '../lib/opencode/runtime-artifact.mjs';

const sourceRevision = '0123456789abcdef0123456789abcdef01234567';
const patchSha256 = 'a'.repeat(64);
const lockSha256 = 'b'.repeat(64);
const version = '9.8.7';
const targetKey = 'linux-x64';
const executableRelative = `cli-${targetKey}/bin/opencode`;
const executableBytes = Buffer.from('#!/bin/sh\necho opencode 9.8.7\n');
let temp;
let server;
let baseUrl;
let assets = new Map();
let gets = 0;
let truncateResponse = false;

before(async () => {
  temp = await mkdtemp(path.join(os.tmpdir(), 'ctg-runtime-artifact-test-'));
  server = createServer((request, response) => {
    gets++;
    if (request.url === `/releases/${version}/redirect/opencode-${targetKey}.tar.gz`) { response.writeHead(302, { location: `/releases/${version}/opencode-${targetKey}.tar.gz` }).end(); return; }
    const asset = assets.get(new URL(request.url, 'http://localhost').pathname);
    if (!asset) { response.writeHead(404).end('not found'); return; }
    response.writeHead(200, { 'content-length': asset.length });
    if (truncateResponse) { response.write(asset.subarray(0, Math.floor(asset.length / 2))); response.socket.destroy(); return; }
    response.end(asset);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}/releases/${version}`;
});
after(async () => {
  server?.close();
  await rm(temp, { recursive: true, force: true });
});

function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function octal(value, width) { return Buffer.from(`${value.toString(8).padStart(width - 1, '0')}\0`); }
function tarEntry(name, data, type = '0', mode = 0o644) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  octal(mode, 8).copy(header, 100);
  octal(0, 8).copy(header, 108); octal(0, 8).copy(header, 116);
  octal(data.length, 12).copy(header, 124); octal(0, 12).copy(header, 136);
  header.fill(32, 148, 156); header[156] = type.charCodeAt(0);
  header.write('ustar\0', 257, 6); header.write('00', 263, 2);
  let checksum = 0; for (const byte of header) checksum += byte;
  octal(checksum, 8).copy(header, 148);
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([header, data, padding]);
}
function makeArchive(entries = []) {
  const manifest = Buffer.from(JSON.stringify({
    owner: 'Carthagent', sourceRepository: 'https://github.com/anomalyco/opencode',
    sourceRevision, lockSha256, patchSha256,
    compatibilityVersion: '2.0.32', runtimeVersion: '0.0.0-ctg.2.0.32',
    channel: 'ctg.2.0.32', platform: 'linux-x64', webUI: false,
  }));
  const sums = Buffer.from(`${sha(executableBytes)}  ${executableRelative}\n`);
  const all = [
    tarEntry('./', Buffer.alloc(0), '5'),
    tarEntry(`./cli-${targetKey}/`, Buffer.alloc(0), '5'),
    tarEntry(`./cli-${targetKey}/bin/`, Buffer.alloc(0), '5'),
    tarEntry(`./${executableRelative}`, executableBytes, '0', 0o755),
    tarEntry('SHA256SUMS', sums),
    tarEntry('ctg-runtime.json', manifest),
    ...entries,
    Buffer.alloc(1024),
  ];
  return gzipSync(Buffer.concat(all));
}
function setArchive(archive) {
  assets = new Map([[`/releases/${version}/opencode-${targetKey}.tar.gz`, archive]]);
}
function args(extra = {}) {
  return {
    releaseVersion: version, platform: 'linux', arch: 'x64', expectedArchiveSha256: assets.size ? sha(assets.values().next().value) : 'd'.repeat(64),
    expectedSourceRevision: sourceRevision, expectedPatchSha256: patchSha256,
    expectedLockSha256: lockSha256, expectedCompatibilityVersion: '2.0.32',
    expectedRuntimeVersion: '0.0.0-ctg.2.0.32', expectedChannel: 'ctg.2.0.32',
    expectedExecutableSha256: sha(executableBytes),
    baseUrl, cacheRoot: path.join(temp, 'cache'), ...extra,
  };
}

test('downloads, verifies and installs the pinned archive, then uses the revalidated offline cache', async () => {
  const archive = makeArchive(); setArchive(archive); gets = 0;
  const destination = await acquireOwnedRuntime(args());
  assert.equal(path.basename(destination), targetKey);
  assert.deepEqual(await readFile(path.join(destination, 'cli-linux-x64', 'bin', 'opencode')), executableBytes);
  assert.deepEqual((await readdir(destination)).sort(), ['SHA256SUMS', 'cli-linux-x64', 'ctg-runtime.json']);
  assert.equal(gets, 1);
  assets.clear();
  assert.equal(await acquireOwnedRuntime(args()), destination);
  assert.equal(gets, 1);
});

test('follows a normal release-asset redirect while retaining the pinned digest check', async () => {
  setArchive(makeArchive());
  const redirectedUrl = `${baseUrl}/redirect`;
  const destination = await acquireOwnedRuntime(args({ baseUrl: redirectedUrl, cacheRoot: path.join(temp, 'redirect-cache') }));
  assert.equal(await readFile(path.join(destination, 'SHA256SUMS'), 'utf8'), `${sha(executableBytes)}  ${executableRelative}\n`);
});

test('rejects tampered cached executables and archive digest mismatches without publishing', async () => {
  const archive = makeArchive(); setArchive(archive);
  const destination = await acquireOwnedRuntime(args());
  await writeFile(path.join(destination, 'cli-linux-x64', 'bin', 'opencode'), 'altered');
  await writeFile(path.join(destination, 'SHA256SUMS'), `${sha(Buffer.from('altered'))}  ${executableRelative}\n`);
  assets.clear();
  await assert.rejects(acquireOwnedRuntime(args()), /no system OpenCode fallback was attempted/);
  setArchive(archive);
  await assert.rejects(acquireOwnedRuntime(args({ expectedArchiveSha256: 'c'.repeat(64), cacheRoot: path.join(temp, 'bad-digest-cache') })), /SHA-256 mismatch/);
  await acquireOwnedRuntime(args());
  assert.deepEqual(await readFile(path.join(destination, 'cli-linux-x64', 'bin', 'opencode')), executableBytes);
  assert.deepEqual(await readdir(path.join(temp, 'cache', '.staging')), []);
});

test('rejects traversal and symlink archive entries and cleans staging', async (t) => {
  for (const [label, badEntry] of [
    ['traversal', tarEntry('../escape', Buffer.from('escape'))],
    ['symlink', tarEntry('cli-linux-x64/bin/evil', Buffer.from('../escape'), '2')],
  ]) {
    await t.test(label, async () => {
      setArchive(makeArchive([badEntry]));
      await assert.rejects(acquireOwnedRuntime(args({ cacheRoot: path.join(temp, `${label}-cache`) })), /unsafe archive path|unsupported link or special entry/);
      assert.deepEqual(await readdir(path.join(temp, `${label}-cache`, '.staging')), []);
    });
  }
});

test('rejects malformed release coordinates before requesting any asset', async () => {
  gets = 0;
  await assert.rejects(acquireOwnedRuntime(args({ releaseVersion: '../latest' })), /exact semantic version/);
  await assert.rejects(acquireOwnedRuntime(args({ platform: 'plan9' })), /Unsupported/);
  assert.equal(gets, 0);
});

test('serializes concurrent acquisition and publishes a single verified cache entry', async () => {
  setArchive(makeArchive()); gets = 0;
  const sharedCache = path.join(temp, 'parallel-cache');
  const [first, second] = await Promise.all([
    acquireOwnedRuntime(args({ cacheRoot: sharedCache })),
    acquireOwnedRuntime(args({ cacheRoot: sharedCache })),
  ]);
  assert.equal(first, second);
  assert.equal(gets, 1);
  assert.deepEqual((await readdir(path.join(sharedCache, version, targetKey))).sort(), ['SHA256SUMS', 'cli-linux-x64', 'ctg-runtime.json']);
});

test('cleans staging after a failed HTTP request and reports no fallback', async () => {
  assets.clear();
  await assert.rejects(acquireOwnedRuntime(args({ cacheRoot: path.join(temp, 'http-fail-cache') })), /no system OpenCode fallback was attempted/);
  assert.deepEqual(await readdir(path.join(temp, 'http-fail-cache', '.staging')), []);
});

test('cleans staging after a truncated transfer', async () => {
  setArchive(makeArchive());
  truncateResponse = true;
  try {
    await assert.rejects(acquireOwnedRuntime(args({ cacheRoot: path.join(temp, 'truncated-cache') })), /no system OpenCode fallback was attempted/);
    assert.deepEqual(await readdir(path.join(temp, 'truncated-cache', '.staging')), []);
  } finally { truncateResponse = false; }
});
