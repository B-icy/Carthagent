import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, access, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { selectNativePtyRuntime } from '../tools/native-pty-runtime.mjs';
import { nativePtySmokeArgs } from '../tools/native-pty-invocation.mjs';

test('installed PTY invocation carries an independently resolved upstream digest to Python', async () => {
  const binary = process.execPath;
  const digest = createHash('sha256').update(await readFile(binary)).digest('hex');
  const selection = await selectNativePtyRuntime({
    runtime: {
      async resolveOpenCode() { return binary; },
      async runtimeIdentity() { return { kind: 'upstream-compatible', binaryPath: binary, binarySha256: digest, version: '2.0.32' }; },
    },
    identityTools: {
      async loadNativeTestRuntime() { return { runtimeVersion: '2.0.32' }; },
    },
    env: {},
  });
  const args = nativePtySmokeArgs({
    root: '/package', binary, plugin: '/package/plugins/carthagent',
    selection,
    probe: { command: '/ctg-status', expect: 'OpenCode 2.0.32', initialTheme: 'carthage', color: '213,175,102', dismissCompletion: true, postSubmitMarker: 'restart' },
  });
  const digestArg = args.indexOf('--expected-sha256');
  assert.notEqual(digestArg, -1, 'upstream-compatible binaries must receive the digest argument too');
  assert.equal(args[digestArg + 1], digest);
  assert.ok(args.includes('--initial-theme') && args.includes('carthage'));
  assert.ok(args.includes('--expect-color') && args.includes('213,175,102'));
  assert.ok(args.includes('--dismiss-completion') && args.includes('--post-submit-marker') && args.includes('restart'));
  const actual = createHash('sha256').update(await readFile(args[args.indexOf('--binary') + 1])).digest('hex');
  assert.equal(actual, args[digestArg + 1], 'Python entrypoint is given the exact digest verified by runtime selection');
});

test('owned runtime selection exposes its independently verified digest to the required Python argument', async () => {
  const binary = '/fixture/owned/cli-linux-x64/bin/opencode';
  const digest = 'b'.repeat(64);
  const selection = await selectNativePtyRuntime({
    runtime: {
      async resolveOpenCode() { return binary; },
      async runtimeIdentity() { return { kind: 'ctg-owned', binaryPath: binary, binarySha256: digest, sourceRevision: 'a'.repeat(40), patchSha256: 'c'.repeat(64), lockSha256: 'd'.repeat(64), platform: 'linux-x64' }; },
    },
    env: { CTG_TEST_RUNTIME_ARTIFACT_ROOT: '/fixture/owned', CTG_TEST_RUNTIME_RELEASE_MANIFEST: '/trusted/release.json' },
    identityTools: {
      async preflightNativeTestRuntimeArtifact() { return { expectedManifest: { pinned: true } }; },
      async loadNativeTestRuntime() { return { binarySha256: digest, sourceRevision: 'a'.repeat(40), patchSha256: 'c'.repeat(64), lockSha256: 'd'.repeat(64) }; },
    },
  });
  assert.equal(selection.binarySha256, digest);
  const args = nativePtySmokeArgs({ root: '/package', binary, plugin: '/package/plugins/carthagent', selection, probe: { command: '/ctg-status', expect: 'OpenCode 2.0.32', secondEnter: true, initialTheme: 'carthage' } });
  assert.equal(args[args.indexOf('--expected-sha256') + 1], digest);
  assert.ok(args.includes('--second-enter') && args.includes('--initial-theme') && args.includes('carthage'));
});

test('invocation helper fails closed if the selected runtime omitted the digest', () => {
  assert.throws(() => nativePtySmokeArgs({ root: '/package', binary: '/bin/opencode', plugin: '/plugin', selection: {}, probe: { command: '/ctg-status', expect: 'OpenCode' } }), /missing its independently verified/);
});

test('Python digest preflight rejects changed bytes before executing the selected binary', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ctg-pty-preflight-'));
  const binary = join(directory, 'binary');
  const marker = join(directory, 'launched');
  const python = join(process.cwd(), 'tools/native-pty-smoke.py');
  try {
    await writeFile(binary, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`);
    await chmod(binary, 0o755);
    const result = spawnSync('python3', [python, '--binary', binary, '--expected-sha256', '0'.repeat(64)], { encoding: 'utf8' });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /SHA-256 changed before PTY execution/);
    await assert.rejects(access(marker), { code: 'ENOENT' }, 'digest mismatch must be rejected before native binary launch');
  } finally {
    await import('node:fs/promises').then(({ rm }) => rm(directory, { recursive: true, force: true }));
  }
});

test('explicit upstream digest mismatch fails before building a PTY invocation', async () => {
  const binary = process.execPath;
  const digest = createHash('sha256').update(await readFile(binary)).digest('hex');
  await assert.rejects(selectNativePtyRuntime({
    runtime: {
      async resolveOpenCode() { return binary; },
      async runtimeIdentity() { return { kind: 'upstream-compatible', binaryPath: binary, binarySha256: digest, version: '2.0.32' }; },
    },
    identityTools: {
      async loadNativeTestRuntime() { return { runtimeVersion: '2.0.32' }; },
    },
    env: { CTG_NATIVE_PTY_EXPECTED_SHA256: '0'.repeat(64) },
  }), /SHA-256 mismatch/);
});
