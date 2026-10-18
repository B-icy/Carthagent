import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
    probe: { command: '/ctg-status', expect: 'OpenCode 2.0.32' },
  });
  const digestArg = args.indexOf('--expected-sha256');
  assert.notEqual(digestArg, -1, 'upstream-compatible binaries must receive the digest argument too');
  assert.equal(args[digestArg + 1], digest);
  const actual = createHash('sha256').update(await readFile(args[args.indexOf('--binary') + 1])).digest('hex');
  assert.equal(actual, args[digestArg + 1], 'Python entrypoint is given the exact digest verified by runtime selection');
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
