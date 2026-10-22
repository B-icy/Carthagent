import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { CTG_RUNTIME_SOURCE, CTG_RUNTIME_PATCH_SHA256, CTG_RUNTIME_LOCK_SHA256 } from '../lib/opencode/runtime.mjs';
import { createManualProjects } from '../tools/native-manual-projects.mjs';
import { readManualRuntimeManifest } from '../tools/manual-runtime-manifest.mjs';
import { readRuntimeReleaseManifest } from '../lib/opencode/runtime.mjs';
import { prepareManualKit } from '../tools/prepare-native-manual.mjs';

test('manual fixtures have green baselines, red feature acceptance, clean git, and no dependencies', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'ctg-manual-projects-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const result = await createManualProjects(join(temp, 'projects'), {
    packages: 3,
  });
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  for (const name of ['tiny', 'product', 'scale']) {
    const cwd = join(result.root, name);
    const manifest = JSON.parse(
      await readFile(join(cwd, 'package.json'), 'utf8'),
    );
    assert.equal(manifest.dependencies, undefined);
    const baseline = spawnSync(
      process.execPath,
      ['--test', 'test/*.test.mjs'],
      { cwd, env, encoding: 'utf8' },
    );
    assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
    const acceptance = spawnSync(
      process.execPath,
      ['--test', 'acceptance/*.test.mjs'],
      { cwd, env, encoding: 'utf8' },
    );
    assert.equal(
      acceptance.status,
      1,
      'new-feature acceptance must fail against the baseline',
    );
    const status = spawnSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf8',
    });
    assert.equal(status.status, 0, status.stderr);
    assert.equal(status.stdout, '');
    assert.ok(result.projects[name].files > 3);
  }
  const sentinel = join(result.root, 'keep.txt');
  await writeFile(sentinel, 'keep');
  await assert.rejects(createManualProjects(result.root), { code: 'EEXIST' });
  assert.equal(await readFile(sentinel, 'utf8'), 'keep');
  await assert.rejects(
    createManualProjects(join(temp, 'invalid'), { packages: 0 }),
    /integer from 2 to 1024/,
  );
});

test('manual kit preparation refuses existing directories and removes only its own failed staging', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'ctg-manual-kit-safety-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const sentinel = join(temp, 'keep.txt');
  await writeFile(sentinel, 'keep');
  await assert.rejects(prepareManualKit(temp, { assetsDirectory: temp }), {
    code: 'EEXIST',
  });
  assert.equal(await readFile(sentinel, 'utf8'), 'keep');
  const runtimeManifest = join(temp, 'runtime-release.json');
  const manifest = JSON.parse(await readFile(new URL('../lib/opencode/runtime-release.json', import.meta.url), 'utf8'));
  manifest.releaseVersion = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
  Object.assign(manifest, { sourceRevision: CTG_RUNTIME_SOURCE, patchSha256: CTG_RUNTIME_PATCH_SHA256, lockSha256: CTG_RUNTIME_LOCK_SHA256 });
  const target = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
  manifest.assets = { [target]: manifest.assets[target] };
  const bytes = JSON.stringify(manifest);
  await writeFile(runtimeManifest, bytes);
  const manifestSha256 = createHash('sha256').update(bytes).digest('hex');
  const missing = join(temp, 'failed-kit');
  await assert.rejects(
    prepareManualKit(missing, { assetsDirectory: temp, runtimeManifest, manifestSha256 }),
    /Could not acquire/,
  );
  await assert.rejects(readFile(join(missing, 'manual-kit.json')), {
    code: 'ENOENT',
  });
  assert.equal(await readFile(sentinel, 'utf8'), 'keep');
  await assert.rejects(
    prepareManualKit(join(temp, 'invalid'), { packages: 0 }),
    /integer from 2 to 1024/,
  );
});


test('manual candidate overrides require an independent digest and reject altered or incompatible manifests', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'ctg-manual-kit-trust-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const runtimeManifest = join(temp, 'candidate.json');
  const destination = join(temp, 'kit');
  await writeFile(runtimeManifest, '{}');
  await assert.rejects(prepareManualKit(destination, { runtimeManifest }), /manifest.*SHA-256|digest/i);
  await assert.rejects(prepareManualKit(destination, { runtimeManifest, manifestSha256: '0'.repeat(64) }), /manifest.*SHA-256|checksum|digest/i);
  const manifestSha256 = createHash('sha256').update('{}').digest('hex');
  await assert.rejects(prepareManualKit(destination, { runtimeManifest, manifestSha256 }), /incompatible|invalid/i);
  await assert.rejects(readFile(join(destination, 'manual-kit.json')), { code: 'ENOENT' });
  await writeFile(runtimeManifest, '{"altered":true}');
  await assert.rejects(prepareManualKit(destination, { runtimeManifest, manifestSha256 }), /manifest.*SHA-256|checksum|digest/i);
  await assert.rejects(readFile(join(destination, 'manual-kit.json')), { code: 'ENOENT' });
});

test('single-platform manual candidates bind current recipe bytes without weakening complete release manifests', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'ctg-manual-candidate-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const runtimeManifest = join(temp, 'candidate.json');
  const manifest = JSON.parse(await readFile(new URL('../lib/opencode/runtime-release.json', import.meta.url), 'utf8'));
  manifest.releaseVersion = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
  Object.assign(manifest, { sourceRevision: CTG_RUNTIME_SOURCE, patchSha256: CTG_RUNTIME_PATCH_SHA256, lockSha256: CTG_RUNTIME_LOCK_SHA256 });
  const asset = manifest.assets['linux-x64'];
  manifest.assets = { 'linux-x64': asset };
  const save = async () => {
    const bytes = JSON.stringify(manifest);
    await writeFile(runtimeManifest, bytes);
    return { runtimeManifest, manifestSha256: createHash('sha256').update(bytes).digest('hex') };
  };
  const current = await readManualRuntimeManifest(await save());
  assert.deepEqual(Object.keys(current.manifest.assets), ['linux-x64']);
  await assert.rejects(readRuntimeReleaseManifest(runtimeManifest), /incompatible|invalid/i);
  for (const field of ['sourceRevision', 'patchSha256', 'lockSha256']) {
    const original = manifest[field];
    manifest[field] = '0'.repeat(original.length);
    await assert.rejects(readManualRuntimeManifest(await save()), /build recipe/i);
    manifest[field] = original;
  }
  const inherited = Object.fromEntries([['__proto__', { ...asset, name: undefined }]]);
  for (const assets of [{}, { unknown: asset }, { 'linux-x64': { ...asset, executableSha256: 'invalid' } }, inherited]) {
    manifest.assets = assets;
    await assert.rejects(readManualRuntimeManifest(await save()), /invalid|incompatible/i);
  }
});
