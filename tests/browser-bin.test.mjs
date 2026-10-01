import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateRawSync } from 'node:zlib';
import { extractZip, findBrowser, bundledBinaryPath, ensureBundledBrowser, isSandboxFailure } from '../lib/browser-bin.mjs';

/** Build a minimal zip archive in memory: [{name, data, method}] → Buffer. */
function buildZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const { name, data, method } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.from(data);
    const stored = method === 8 ? deflateRawSync(raw) : raw;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(method, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(0, 14); lh.writeUInt32LE(stored.length, 18); lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    local.push(lh, nameBuf, stored);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(method, 10); ch.writeUInt32LE(stored.length, 20); ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([ch, nameBuf]));
    offset += 30 + nameBuf.length + stored.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, eocd]);
}

const tmp = mkdtempSync(join(tmpdir(), 'browser-bin-test-'));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

test('extractZip extracts stored and deflated entries', () => {
  const zip = join(tmp, 'ok.zip');
  writeFileSync(zip, buildZip([
    { name: 'pkg/a.txt', data: 'stored café', method: 0 },
    { name: 'pkg/deep/b.txt', data: 'deflated café '.repeat(50), method: 8 },
  ]));
  const out = join(tmp, 'out');
  const files = extractZip(zip, out);
  assert.equal(files.length, 2);
  assert.equal(readFileSync(join(out, 'pkg/a.txt'), 'utf8'), 'stored café');
  assert.equal(readFileSync(join(out, 'pkg/deep/b.txt'), 'utf8'), 'deflated café '.repeat(50));
});

test('extractZip rejects traversal and absolute entries', () => {
  for (const name of ['../escape', 'a/../../x', '/abs', 'C:/win']) {
    const zip = join(tmp, `bad-${name.length}.zip`);
    writeFileSync(zip, buildZip([{ name, data: 'x', method: 0 }]));
    assert.throws(() => extractZip(zip, join(tmp, 'badout')), /refusing entry/);
  }
});

test('findBrowser honors CARTHAGENT_BROWSER, bundled path, then system/firefox', () => {
  const custom = join(tmp, 'custom-shell');
  writeFileSync(custom, 'fake');
  assert.equal(findBrowser({ env: { CARTHAGENT_BROWSER: custom, PATH: '' } }), custom);
  const bundled = bundledBinaryPath();
  const env2 = { PATH: '' };
  if (existsSync(bundled)) assert.equal(findBrowser({ env: env2 }), bundled);
  else assert.equal(findBrowser({ env: env2 }), null);
  const found = findBrowser({ env: { PATH: '/nonexistent' } });
  assert.ok(found === null || /firefox|chrome|chromium/.test(found));
});

test('isSandboxFailure matches AppArmor/userns sandbox errors only', () => {
  assert.equal(isSandboxFailure('! If you are running on Ubuntu 23.10+ or another Linux distro that has disabled unprivileged user namespaces with AppArmor'), true);
  assert.equal(isSandboxFailure('cannot run as root without --no-sandbox'), true);
  assert.equal(isSandboxFailure('DevTools listening on ws://127.0.0.1'), false);
  assert.equal(isSandboxFailure(''), false);
});

test('ensureBundledBrowser short-circuits when binary exists and honors base', async () => {
  const base = join(tmp, 'custom-root');
  const bin = bundledBinaryPath({ base });
  mkdirSync(join(bin, '..'), { recursive: true });
  writeFileSync(bin, 'fake');
  const resolved = await ensureBundledBrowser({ base, fetchImpl: async () => { throw Error('must not fetch'); } });
  assert.equal(resolved, bin);
});
