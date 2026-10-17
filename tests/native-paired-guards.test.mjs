import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { aggregateConditionExit, assertCompletePluginSource, assertDependencyPackageIdentity, assertPluginCondition, assertPluginImportDependencies, assertSnapshotProvenance, verifySnapshotIdentity } from '../tools/native-paired-guards.mjs';

test('paired CTG fixture fails closed unless inventory says active', () => {
  assert.deepEqual(assertPluginCondition([{ id: 'carthagent', state: { status: 'active' } }], true),
    { expected: 'active', observed: 'active', pluginId: 'carthagent' });
  assert.throws(() => assertPluginCondition([{ id: 'carthagent', state: { status: 'error', error: "Cannot find module '../../lib/ship-auth.mjs'" } }], true), /Expected native Carthagent plugin to be active.*Cannot find module/);
  assert.throws(() => assertPluginCondition([{ id: 'carthagent.runtime', state: { status: 'active' } }], true), /Expected native Carthagent plugin to be active/);
  assert.throws(() => assertPluginCondition([], true), /Expected native Carthagent plugin to be active/);
});

test('plugin source without the pinned native runtime import is rejected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-paired-missing-runtime-'));
  try {
    const entry = join(root, 'plugins/carthagent/src/index.ts');
    await mkdir(dirname(entry), { recursive: true });
    await writeFile(entry, "import { rpc } from './rpc';\nexport { rpc };\n");
    await writeFile(join(dirname(entry), 'rpc.ts'), 'export const rpc = {};\n');
    assert.throws(() => assertPluginImportDependencies(entry), /does not import the pinned @opencode\/plugin runtime/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('paired runner rejects the old partial plugin staging and accepts a complete source snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-paired-source-test-'));
  try {
    await mkdir(join(root, 'plugins/carthagent/src'), { recursive: true });
    await mkdir(join(root, 'node_modules/@opencode/plugin'), { recursive: true });
    await mkdir(join(root, 'plugins/carthagent/node_modules/@opencode'), { recursive: true });
    await writeFile(join(root, 'plugins/carthagent/index.ts'), "export { default } from './src/index';\n");
    await writeFile(join(root, 'plugins/carthagent/src/index.ts'), '');
    assert.throws(() => assertCompletePluginSource(root), /Incomplete native plugin source snapshot.*package-lock.json.*lib\/ship-auth.mjs/);
    for (const file of ['package-lock.json', 'lib/ship-auth.mjs', 'plugins/carthagent/src/rpc.ts', 'plugins/carthagent/package.json']) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), '');
    }
    for (const file of ['plugins/carthagent/src/server/session-controls.ts', 'plugins/carthagent/src/server/providers.ts', 'plugins/carthagent/src/server/device-auth.ts', 'plugins/carthagent/src/server/workspace-rpc.ts', 'plugins/carthagent/src/server/pull-request-rpc.ts', 'plugins/carthagent/src/server/archive-rpc.ts']) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), '');
    }
    await writeFile(join(root, 'plugins/carthagent/src/index.ts'), "import { Plugin } from '@opencode/plugin';\nexport const id = 'carthagent';\n");
    await symlink(join(root, 'node_modules/@opencode/plugin'), join(root, 'plugins/carthagent/node_modules/@opencode/plugin'));
    assert.equal(assertCompletePluginSource(root).sourceRoot, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('complete plugin staging resolves extensionless native TypeScript imports within the source snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-paired-plugin-import-test-'));
  try {
    const entry = join(root, 'plugins/carthagent/src/index.ts');
    await mkdir(dirname(entry), { recursive: true });
    await writeFile(entry, "import { Plugin } from '@opencode/plugin';\nimport { rpc } from './rpc';\n");
    await writeFile(join(dirname(entry), 'rpc.ts'), 'export const rpc = {};\n');
    assert.deepEqual(assertPluginImportDependencies(entry), { sourceImports: ['./rpc'], workspaceImports: ['@opencode/plugin'] });
    await rm(join(dirname(entry), 'rpc.ts'));
    assert.throws(() => assertPluginImportDependencies(entry), /Plugin source import is missing from immutable tree.*\.\/rpc/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('paired baseline condition requires Carthagent to be absent', () => {
  assert.deepEqual(assertPluginCondition([{ id: 'other', state: { status: 'active' } }], false),
    { expected: 'absent', observed: 'absent', pluginId: 'carthagent' });
  assert.throws(() => assertPluginCondition([{ id: 'carthagent', state: { status: 'active' } }], false), /Baseline must have no Carthagent plugin/);
});

test('ABBA exit aggregation fails if any condition fails or is missing', () => {
  assert.equal(aggregateConditionExit({ 'baseline-1': 0, 'ctg-1': 0, 'ctg-2': 0, 'baseline-2': 0 }), 0);
  assert.equal(aggregateConditionExit({ 'baseline-1': 0, 'ctg-1': 1, 'ctg-2': 0, 'baseline-2': 0 }), 1);
  assert.equal(aggregateConditionExit({ 'baseline-1': 0 }), 1);
  assert.equal(aggregateConditionExit({ 'baseline-1': 0, 'ctg-1': 0, 'ctg-2': 0, 'baseline-2': 0 }, true), 1);
  // A child process failure must survive aggregation, even if the other passes succeeded.
  assert.equal(aggregateConditionExit({ 'baseline-1': 0, 'ctg-1': 127, 'ctg-2': 0, 'baseline-2': 0 }), 1);
});

test('dependency identity comparison fails closed when the physical install changes', () => {
  const expected = { realpath: '/pinned/node_modules', treeSha256: 'a'.repeat(64) };
  assert.equal(assertDependencyPackageIdentity(expected, { ...expected }), true);
  assert.throws(() => assertDependencyPackageIdentity(expected, { ...expected, treeSha256: 'b'.repeat(64) }), /Dependency install identity mismatch/);
  assert.throws(() => assertDependencyPackageIdentity(expected, { ...expected, realpath: '/other/node_modules' }), /Dependency install identity mismatch/);
});

test('baseline absence rejects plugin-provided namespaces, not only exact id', () => {
  assert.throws(() => assertPluginCondition([{ id: 'carthagent.session', state: { status: 'active' } }], false), /Baseline must have no Carthagent plugin/);
});

test('paired provenance requires the immutable source snapshot and pinned binary identity', () => {
  const valid = { binarySha256: 'a'.repeat(64), binaryVersion: '2.0.32', sourceCommit: 'f'.repeat(40),
    sourceTree: 'e'.repeat(40), sourceDirty: false, sourceSnapshotSha256: 'b'.repeat(64),
    sourceCheckoutDirtyStatus: '', sourceCheckoutStatusSha256: createHash('sha256').update('').digest('hex'),
    sourceCheckoutDirty: false, harnessDirtyStatus: '', harnessDirty: false,
    packageLockSha256: 'c'.repeat(64), installedPackageLockSha256: 'c'.repeat(64), dependencyNodeModulesRealpath: '/pinned/node_modules',
    sourceComponentSha256: 'd'.repeat(64), harnessComponentSha256: 'e'.repeat(64),
    sourceArchiveSha256: 'f'.repeat(64),
    executionSnapshotTar: '/snapshot/execution.tar', executionSnapshotSha256: 'f'.repeat(64),
    sourceSnapshotTar: '/snapshot/source.tar', binary: '/pinned/opencode',
    dependencyInstallSha256: 'a'.repeat(64), dependencyInstallRealpath: '/pinned/node_modules',
    dependencyPackages: Object.fromEntries(['@opencode/cli', '@opencode/client', '@opencode/plugin'].map(name =>
      [name, { version: '2.0.32', realpath: `/pinned/node_modules/${name}`, packageJsonSha256: 'a'.repeat(64), treeSha256: 'b'.repeat(64) }])) };
  assert.equal(assertSnapshotProvenance(valid), true);
  assert.equal(verifySnapshotIdentity(valid, { ...valid }, { verifyArtifactFiles: false }), true);
  assert.throws(() => verifySnapshotIdentity(valid, { ...valid, sourceSnapshotSha256: 'd'.repeat(64) }, { verifyArtifactFiles: false }), /Snapshot identity mismatch for sourceSnapshotSha256/);
  assert.throws(() => assertSnapshotProvenance({ ...valid, sourceSnapshotSha256: undefined }), /Missing provenance field/);
  assert.throws(() => assertSnapshotProvenance({ ...valid, binaryVersion: 'latest' }), /provenance is invalid/);
  assert.throws(() => assertSnapshotProvenance({ ...valid, sourceDirty: 'false' }), /Checkout dirty-state provenance is invalid/);
  assert.throws(() => assertSnapshotProvenance({ ...valid, sourceDirty: true }), /Source snapshot must be created from a clean immutable commit/);
});

test('actual manifest generator emits valid typed JSON for clean and dirty quoted checkout metadata', () => {
  const dirtyStatus = ' M "quoted path\\name"\n?? file with newline\ninside\n';
  const fields = {
    createdAt: '2026-10-17T00:00:00.000Z', binary: '/pinned/opencode', binaryVersion: '2.0.32', binarySha256: 'a'.repeat(64),
    sourceCheckout: '/tmp/source "checkout"\nline', sourceCheckoutHead: '1'.repeat(40), sourceCheckoutDirtyStatus: '',
    sourceCheckoutStatusSha256: 'b'.repeat(64), sourceCommit: '2'.repeat(40), sourceTree: '3'.repeat(40),
    sourceSnapshotTar: '/tmp/source.tar', sourceArchiveSha256: 'c'.repeat(64), executionSnapshotTar: '/tmp/execution.tar',
    executionSnapshotSha256: 'd'.repeat(64), sourceSnapshotSha256: 'd'.repeat(64), packageLockSha256: 'e'.repeat(64),
    installedPackageLockSha256: 'e'.repeat(64), dependencyNodeModulesRealpath: '/pinned/node_modules',
    dependencyInstallSha256: 'f'.repeat(64), dependencyInstallRealpath: '/pinned/node_modules',
    dependencyPackages: Object.fromEntries(['@opencode/cli', '@opencode/client', '@opencode/plugin'].map(name =>
      [name, { version: '2.0.32', realpath: `/pinned/node_modules/${name}`, packageJsonSha256: 'a'.repeat(64), treeSha256: 'b'.repeat(64) }])),
    harnessWorktree: '/tmp/harness', harnessCommit: '4'.repeat(40), harnessDirtyStatus: dirtyStatus,
    harnessSourceManifestSha256: '5'.repeat(64), samplesPerRun: 30, sourceComponentSha256: '6'.repeat(64),
    harnessComponentSha256: '7'.repeat(64),
  };
  const generator = join(dirname(new URL(import.meta.url).pathname), '../tools/native-paired-manifest.mjs');
  for (const checkoutStatus of ['', dirtyStatus]) {
    const input = { ...fields, sourceCheckoutDirtyStatus: checkoutStatus };
    const generated = spawnSync(process.execPath, [generator], { input: JSON.stringify(input), encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    const manifest = JSON.parse(generated.stdout);
    assert.equal(manifest.sourceCheckoutDirtyStatus, checkoutStatus);
    assert.equal(manifest.sourceCheckoutDirty, checkoutStatus.length > 0);
    assert.equal(manifest.sourceCheckout, fields.sourceCheckout);
    assert.equal(manifest.sourceCheckoutHead, fields.sourceCheckoutHead);
    assert.equal(manifest.harnessDirtyStatus, dirtyStatus);
    assert.equal(manifest.harnessDirty, true);
    assert.equal(manifest.sourceDirty, false);
    assert.equal(manifest.sourceCheckoutStatusSha256, createHash('sha256').update(checkoutStatus).digest('hex'));
    assert.throws(() => assertSnapshotProvenance({ ...manifest, sourceCheckoutDirty: !manifest.sourceCheckoutDirty }), /Checkout dirty-state provenance is invalid/);
    assert.equal(assertSnapshotProvenance(manifest), true);
  }
});

test('artifact identity is tied to the archived selected git commit, not its mutable checkout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-paired-immutable-source-'));
  const archive = join(root, 'source.tar');
  try {
    execFileSync('git', ['init', '-q', root]);
    execFileSync('git', ['-C', root, 'config', 'user.email', 'offline@example.invalid']);
    execFileSync('git', ['-C', root, 'config', 'user.name', 'Offline Fixture']);
    for (const [file, contents] of Object.entries({
      'package.json': '{"dependencies":{"@opencode/cli":"2.0.32","@opencode/client":"2.0.32"},"workspaces":["plugins/carthagent"]}\n',
      'package-lock.json': '{"lockfileVersion":3}\n',
      'lib/ship-auth.mjs': 'export const shipAgentDir = () => "/tmp";\n',
      'plugins/carthagent/index.ts': "export { default } from './src/index';\n",
      'plugins/carthagent/src/index.ts': "import { Plugin } from '@opencode/plugin';\nexport const id = 'carthagent';\n",
      'plugins/carthagent/src/rpc.ts': 'export const rpc = {};\n',
      'plugins/carthagent/package.json': '{"name":"carthagent-plugin","dependencies":{"@opencode/plugin":"2.0.32"}}\n',
      'plugins/carthagent/src/server/session-controls.ts': 'export const sessionControls = {};\n',
      'plugins/carthagent/src/server/providers.ts': 'export const providers = {};\n',
      'plugins/carthagent/src/server/device-auth.ts': 'export const deviceAuth = {};\n',
      'plugins/carthagent/src/server/workspace-rpc.ts': 'export const workspaceRpc = {};\n',
      'plugins/carthagent/src/server/pull-request-rpc.ts': 'export const pullRequests = {};\n',
      'plugins/carthagent/src/server/archive-rpc.ts': 'export const archiveRpc = {};\n',
    })) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), contents);
    }
    await mkdir(join(root, 'node_modules/@opencode/plugin'), { recursive: true });
    await mkdir(join(root, 'plugins/carthagent/node_modules/@opencode'), { recursive: true });
    execFileSync('git', ['-C', root, 'add', '.']);
    execFileSync('git', ['-C', root, 'commit', '-qm', 'immutable source fixture']);
    const commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const tree = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
    const tar = execFileSync('git', ['-C', root, 'archive', '--format=tar', commit]);
    await writeFile(archive, tar);
    const snapshotHash = createHash('sha256').update(tar).digest('hex');
    const archived = await mkdtemp(join(tmpdir(), 'native-paired-archived-tree-'));
    try {
      execFileSync('tar', ['-xf', archive, '-C', archived]);
      await mkdir(join(archived, 'node_modules/@opencode/plugin'), { recursive: true });
      await mkdir(join(archived, 'plugins/carthagent/node_modules/@opencode'), { recursive: true });
      await symlink(join(archived, 'node_modules/@opencode/plugin'), join(archived, 'plugins/carthagent/node_modules/@opencode/plugin'));
      assert.equal(assertCompletePluginSource(archived).sourceRoot, archived);
      const provenance = {
        binarySha256: 'a'.repeat(64), binaryVersion: '2.0.32', sourceCommit: commit, sourceTree: tree,
        sourceDirty: false, sourceSnapshotSha256: snapshotHash,
        sourceCheckoutDirty: false, sourceCheckoutDirtyStatus: '',
        sourceCheckoutStatusSha256: createHash('sha256').update('').digest('hex'), harnessDirty: false, harnessDirtyStatus: '',
        sourceArchiveSha256: snapshotHash,
        executionSnapshotTar: archive, executionSnapshotSha256: snapshotHash,
        sourceSnapshotTar: archive, binary: '/offline/opencode',
        dependencyInstallSha256: 'a'.repeat(64), dependencyInstallRealpath: '/offline/node_modules',
        packageLockSha256: createHash('sha256').update(await (await import('node:fs/promises')).readFile(join(archived, 'package-lock.json'))).digest('hex'),
        installedPackageLockSha256: createHash('sha256').update(await (await import('node:fs/promises')).readFile(join(archived, 'package-lock.json'))).digest('hex'),
        dependencyNodeModulesRealpath: '/offline/node_modules', sourceComponentSha256: 'd'.repeat(64),
        harnessComponentSha256: 'e'.repeat(64),
        dependencyPackages: Object.fromEntries(['@opencode/cli', '@opencode/client', '@opencode/plugin'].map(name =>
          [name, { version: '2.0.32', realpath: `/offline/node_modules/${name}`, packageJsonSha256: 'a'.repeat(64), treeSha256: 'b'.repeat(64) }]))
      };
      assertSnapshotProvenance(provenance);
      await writeFile(join(root, 'lib/ship-auth.mjs'), 'export const shipAgentDir = () => "/changed";\n');
      const afterCheckoutMutation = execFileSync('git', ['-C', root, 'archive', '--format=tar', commit]);
      assert.equal(createHash('sha256').update(afterCheckoutMutation).digest('hex'), snapshotHash);
      assert.throws(() => verifySnapshotIdentity(provenance, { ...provenance, sourceSnapshotSha256: 'f'.repeat(64) }, { verifyArtifactFiles: false }), /Snapshot identity mismatch for sourceSnapshotSha256/);
    } finally {
      await rm(archived, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
