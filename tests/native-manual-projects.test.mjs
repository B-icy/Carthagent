import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createManualProjects } from '../tools/native-manual-projects.mjs';
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
  const missing = join(temp, 'failed-kit');
  await assert.rejects(
    prepareManualKit(missing, { assetsDirectory: temp }),
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
