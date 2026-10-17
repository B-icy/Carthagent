import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveFixtureRuntime } from '../tools/native-fixture.mjs';

test('owned staging hash mismatch is rejected before product resolver can execute --version', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ctg-fixture-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const platform = `${process.platform}-${process.arch}`;
  const ownedRoot = join(root, 'owned');
  const binary = join(ownedRoot, `cli-${platform}`, 'bin', process.platform === 'win32' ? 'opencode.exe' : 'opencode');
  const marker = join(root, 'version-executed');
  await mkdir(join(ownedRoot, `cli-${platform}`, 'bin'), { recursive: true });
  await writeFile(binary, `#!/bin/sh\nprintf 'opencode v0.0.0-ctg.2.0.32\\n'\nprintf ran > '${marker}'\n`);
  await chmod(binary, 0o755);
  const digest = createHash('sha256').update(await (await import('node:fs/promises')).readFile(binary)).digest('hex');
  const releasePath = join(root, 'lib/opencode/runtime-release.json');
  await mkdir(join(root, 'lib/opencode'), { recursive: true });
  await writeFile(releasePath, JSON.stringify({
    version: 1,
    releaseVersion: '1.2.3',
    compatibilityVersion: '2.0.32',
    runtimeVersion: '0.0.0-ctg.2.0.32',
    sourceRevision: '843a6c514e606b436a7fe713422ace0a93ad3d61',
    patchSha256: 'b'.repeat(64),
    lockSha256: 'c'.repeat(64),
    assets: { [platform]: {
      name: `opencode-${platform}.tar.gz`, archiveSha256: 'd'.repeat(64),
      executableSha256: digest === 'a'.repeat(64) ? 'b'.repeat(64) : 'a'.repeat(64),
    } },
  }));
  let productResolverCalled = false;
  await assert.rejects(resolveFixtureRuntime({
    packageRoot: root,
    env: { CTG_OWNED_OPENCODE_RUNTIME: ownedRoot },
    productRuntime: {
      async resolveOpenCode() { productResolverCalled = true; throw Error('resolver should not be reached'); },
      async runtimeIdentity() { throw Error('identity should not be reached'); },
    },
  }), /binary SHA-256 mismatch/);
  assert.equal(productResolverCalled, false);
  await assert.rejects(import('node:fs/promises').then(fs => fs.access(marker)), { code: 'ENOENT' });
});

test('product runtime selection is reverified by the trusted helper and preserves separate versions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ctg-fixture-runtime-selected-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const platform = `${process.platform}-${process.arch}`;
  const ownedRoot = join(root, 'owned');
  const binary = join(ownedRoot, `cli-${platform}`, 'bin', process.platform === 'win32' ? 'opencode.exe' : 'opencode');
  await mkdir(join(ownedRoot, `cli-${platform}`, 'bin'), { recursive: true });
  await writeFile(binary, 'already resolver-verified fixture bytes');
  const expectedManifest = { trusted: true };
  const releasePath = join(root, 'release.json');
  await writeFile(releasePath, JSON.stringify(expectedManifest));
  const options = { sentinel: Symbol('same-options-object') };
  const calls = [];
  const env = {
    CTG_OWNED_OPENCODE_RUNTIME: ownedRoot,
    CTG_TEST_RUNTIME_RELEASE_MANIFEST: releasePath,
    CTG_TEST_RUNTIME_SHA256: 'e'.repeat(64),
  };
  const verified = {
    binary,
    compatibilityVersion: '2.0.32',
    runtimeVersion: '0.0.0-ctg.2.0.32',
    binarySha256: 'f'.repeat(64),
    sourceRevision: '843a6c514e606b436a7fe713422ace0a93ad3d61',
    patchSha256: 'b'.repeat(64),
    lockSha256: 'c'.repeat(64),
    platform,
  };
  let resolverCalled = false;
  const result = await resolveFixtureRuntime({
    packageRoot: root,
    env,
    options,
    productRuntime: {
      async resolveOpenCode(received) {
        resolverCalled = true;
        assert.equal(received, options);
        return binary;
      },
      async runtimeIdentity(receivedBinary, received) {
        assert.equal(receivedBinary, binary);
        assert.equal(received, options);
        return {
          kind: 'ctg-owned', binaryPath: binary, binarySha256: verified.binarySha256,
          version: verified.runtimeVersion, sourceRevision: verified.sourceRevision,
          patchSha256: verified.patchSha256, lockSha256: verified.lockSha256,
        };
      },
    },
    testRuntimeLoader: async input => {
      calls.push(input);
      return verified;
    },
  });
  assert.equal(resolverCalled, true);
  assert.equal(calls.length, 2, 'preflight selected staging bytes and reverify selected product identity');
  assert.equal(calls[0].env.CTG_TEST_RUNTIME_SHA256, 'e'.repeat(64));
  assert.deepEqual(calls[0].expectedManifest, expectedManifest);
  assert.equal(result.binary, binary);
  assert.equal(result.runtimeIdentity.compatibilityVersion, '2.0.32');
  assert.equal(result.runtimeIdentity.runtimeVersion, '0.0.0-ctg.2.0.32');
  assert.equal(result.runtimeIdentity.binarySha256, verified.binarySha256);
  assert.equal(result.runtimeIdentity.kind, 'ctg-owned');
});
