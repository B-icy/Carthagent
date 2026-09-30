import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  cleanStaleGlobalInstall,
  compareVersions,
  detectInstallMethod,
  latestReleaseCached,
  normalizeRelease,
  staleGlobalInstallPaths,
  updateCheckEnabled,
} from '../lib/update.mjs';

const manifest = { version: '0.3.0', tag: 'v0.3.0', installSpec: 'github:B-icy/Carthagent#v0.3.0', minNode: '22.19.0' };

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ctg-update-'));
  return Promise.resolve().then(() => fn(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

// ---- compareVersions

test('compareVersions orders numeric triples', () => {
  assert.equal(compareVersions('0.2.0', '0.3.0') < 0, true);
  assert.equal(compareVersions('1.0.0', '0.9.9') > 0, true);
  assert.equal(compareVersions('0.3.0', '0.3.0'), 0);
});

test('compareVersions strips a leading v and ignores build metadata', () => {
  assert.equal(compareVersions('v0.3.0', '0.3.0+build7'), 0);
});

test('compareVersions ranks a release above its prereleases', () => {
  assert.equal(compareVersions('0.3.0-rc.1', '0.3.0') < 0, true);
  assert.equal(compareVersions('0.3.0-beta', '0.3.0-rc.1') < 0, true);
  assert.equal(compareVersions('0.3.0-alpha.2', '0.3.0-alpha.10') < 0, true);
});

test('compareVersions rejects non-semver input', () => {
  assert.throws(() => compareVersions('latest', '0.3.0'), /cannot compare/);
});

// ---- normalizeRelease

test('normalizeRelease accepts the control-plane manifest shape', () => {
  const rel = normalizeRelease({ ...manifest, publishedAt: '2026-01-01T00:00:00Z' });
  assert.equal(rel.version, '0.3.0');
  assert.equal(rel.tag, 'v0.3.0');
  assert.equal(rel.installSpec, 'github:B-icy/Carthagent#v0.3.0');
  assert.equal(rel.publishedAt, '2026-01-01T00:00:00Z');
});

test('normalizeRelease maps a GitHub release payload', () => {
  const rel = normalizeRelease({
    tag_name: 'v0.4.0',
    published_at: '2026-02-01T00:00:00Z',
    name: 'Carthagent 0.4.0',
  });
  assert.equal(rel.version, '0.4.0');
  assert.equal(rel.tag, 'v0.4.0');
  assert.equal(rel.installSpec, 'github:B-icy/Carthagent#v0.4.0');
  assert.equal(rel.note, 'Carthagent 0.4.0');
});

test('normalizeRelease fills defaults and returns null on unusable payloads', () => {
  assert.equal(normalizeRelease(null), null);
  assert.equal(normalizeRelease({ tag_name: 'release-2' }), null);
  const filled = normalizeRelease({ version: '0.5.0' });
  assert.equal(filled.tag, 'v0.5.0');
  assert.equal(filled.installSpec, 'github:B-icy/Carthagent#v0.5.0');
});

// ---- latestReleaseCached

test('latestReleaseCached fetches once, then serves the cache', () => withTempDir(async dir => {
  const cachePath = join(dir, 'update-check.json');
  let calls = 0;
  const fetchImpl = async () => { calls++; return { status: 200, json: async () => manifest }; };
  const first = await latestReleaseCached({ cachePath, intervalMs: 1000, fetchImpl });
  assert.equal(first.release.version, '0.3.0');
  assert.equal(first.fresh, false);
  assert.equal(calls, 1);
  const second = await latestReleaseCached({ cachePath, intervalMs: 1000, fetchImpl });
  assert.equal(second.release.version, '0.3.0');
  assert.equal(second.fresh, true);
  assert.equal(calls, 1);
}));

test('latestReleaseCached returns stale data when refresh fails', () => withTempDir(async dir => {
  const cachePath = join(dir, 'update-check.json');
  writeFileSync(cachePath, JSON.stringify({ checkedAt: Date.now() - 60_000, release: manifest }));
  const result = await latestReleaseCached({ cachePath, intervalMs: 1000, fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(result.release.version, '0.3.0');
  assert.equal(result.fresh, false);
}));

test('latestReleaseCached swallows a cold-cache failure', () => withTempDir(async dir => {
  const result = await latestReleaseCached({ cachePath: join(dir, 'update-check.json'), intervalMs: 1000, fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(result.release, null);
}));

// ---- updateCheckEnabled / detectInstallMethod

test('updateCheckEnabled honours opt-out env vars', () => {
  assert.equal(updateCheckEnabled({}), true);
  assert.equal(updateCheckEnabled({ CARTHAGENT_NO_UPDATE_CHECK: '1' }), false);
  assert.equal(updateCheckEnabled({ CARTHAGENT_UPDATE_CHECK: '0' }), false);
  assert.equal(updateCheckEnabled({ CARTHAGENT_UPDATE_CHECK: 'false' }), false);
  assert.equal(updateCheckEnabled({ CARTHAGENT_UPDATE_CHECK: '1' }), true);
});

test('detectInstallMethod distinguishes clones from packed installs', () => withTempDir(dir => {
  assert.equal(detectInstallMethod(dir), 'npm');
  mkdirSync(join(dir, '.git'));
  assert.equal(detectInstallMethod(dir), 'clone');
}));

// ---- staleGlobalInstallPaths / cleanStaleGlobalInstall

test('staleGlobalInstallPaths flags non-directory carthagent and stash leftovers', () => withTempDir(dir => {
  writeFileSync(join(dir, 'carthagent'), 'stray file');
  mkdirSync(join(dir, '.carthagent-WHcGBFBt'));
  mkdirSync(join(dir, 'other-pkg'));
  const stale = staleGlobalInstallPaths(dir).map(p => basename(p));
  assert.deepEqual(stale.sort(), ['.carthagent-WHcGBFBt', 'carthagent']);
}));

test('staleGlobalInstallPaths leaves a real carthagent install alone', () => withTempDir(dir => {
  mkdirSync(join(dir, 'carthagent'));
  assert.deepEqual(staleGlobalInstallPaths(dir), []);
}));

test('staleGlobalInstallPaths ignores a missing npm root', () => {
  assert.deepEqual(staleGlobalInstallPaths(join(tmpdir(), 'ctg-no-such-dir')), []);
});

test('cleanStaleGlobalInstall removes flagged entries and reports them', () => withTempDir(dir => {
  writeFileSync(join(dir, 'carthagent'), 'stray file');
  writeFileSync(join(dir, '.carthagent-abandoned'), 'stash leftover');
  const removed = cleanStaleGlobalInstall(dir);
  assert.equal(removed.length, 2);
  assert.deepEqual(staleGlobalInstallPaths(dir), []);
}));
