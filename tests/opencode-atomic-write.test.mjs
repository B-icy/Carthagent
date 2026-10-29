import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupAtomicWriteStaging, withFileLock } from '../lib/opencode/runtime.mjs';

const UUID = '12345678-1234-1234-1234-123456789abc';

test('atomicWrite cleanup matches only exact basename/PID/UUID staging files and unlinks links, not targets or directories', async t => {
  const root = await mkdtemp(join(tmpdir(), 'atomic-staging-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'record.[private].json');
  const target = join(root, 'target');
  await writeFile(file, 'main remains');
  await writeFile(target, 'target remains');
  const staged = `${file}.${process.pid}.${UUID}.tmp`;
  const link = `${file}.123.${UUID.toUpperCase()}.tmp`;
  await writeFile(staged, Buffer.from([0xff, 0x00, 0x80]));
  await symlink(target, link);
  const kept = [
    `${file}.0.${UUID}.tmp`, `${file}.01.${UUID}.tmp`, `${file}.-1.${UUID}.tmp`,
    `${file}.123.not-uuid.tmp`, `${file}.123.${UUID}.tmp.backup`,
    `${file}.backup.123.${UUID}.tmp`, join(root, `other.json.123.${UUID}.tmp`),
  ];
  for (const path of kept) await writeFile(path, 'unrelated remains');
  const directory = `${file}.456.${UUID}.tmp`;
  await mkdir(directory);
  await writeFile(join(directory, 'child'), 'child remains');
  await withFileLock(`${file}.lock`, () => cleanupAtomicWriteStaging(file));
  for (const path of [staged, link]) await assert.rejects(lstat(path), { code: 'ENOENT' });
  assert.equal(await readFile(file, 'utf8'), 'main remains');
  assert.equal(await readFile(target, 'utf8'), 'target remains');
  for (const path of kept) assert.equal(await readFile(path, 'utf8'), 'unrelated remains');
  assert.equal(await readFile(join(directory, 'child'), 'utf8'), 'child remains');
});

test('atomicWrite cleanup rejects missing, non-directory and linked parent directories without touching targets', async t => {
  const root = await mkdtemp(join(tmpdir(), 'atomic-staging-parent-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'real');
  await mkdir(directory);
  const staged = join(directory, `record.json.123.${UUID}.tmp`);
  await writeFile(staged, 'must remain');
  const linked = join(root, 'linked');
  await symlink(directory, linked, 'junction');
  const nonDirectory = join(root, 'not-a-directory');
  await writeFile(nonDirectory, 'must remain');
  for (const parent of [join(root, 'missing'), nonDirectory, linked]) {
    await assert.rejects(cleanupAtomicWriteStaging(join(parent, 'record.json')));
    assert.equal(await readFile(staged, 'utf8'), 'must remain');
  }
  assert.deepEqual(await readdir(directory), [`record.json.123.${UUID}.tmp`]);
  assert.equal(await readFile(nonDirectory, 'utf8'), 'must remain');
});
