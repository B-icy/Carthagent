import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { selectNativePtyRuntime } from '../tools/native-pty-runtime.mjs';

test('injected owned artifact is independently preflighted before production runtime resolution', async () => {
  const calls = [];
  const runtime = {
    async resolveOpenCode(options) { calls.push(['resolve', options]); return '/fixture/owned/cli-linux-x64/bin/opencode'; },
    async runtimeIdentity() { calls.push(['identity']); return {}; },
  };
  const identityTools = {
    async preflightNativeTestRuntimeArtifact(options) {
      calls.push(['preflight', options]);
      throw new Error('trusted digest mismatch');
    },
    async loadNativeTestRuntime() { calls.push(['verify']); },
  };
  await assert.rejects(selectNativePtyRuntime({
    runtime,
    env: { CTG_TEST_RUNTIME_ARTIFACT_ROOT: '/fixture/owned', CTG_TEST_RUNTIME_RELEASE_MANIFEST: '/trusted/release.json' },
    identityTools,
  }), /trusted digest mismatch/);
  assert.deepEqual(calls.map(([operation]) => operation), ['preflight']);
  assert.equal(calls[0][1].ownedRoot, resolve('/fixture/owned'));
  assert.equal(calls[0][1].expectedManifestPath, '/trusted/release.json');
});

test('ambient owned-runtime selector is rejected as an untrusted acceptance root', async () => {
  let resolved = false;
  await assert.rejects(selectNativePtyRuntime({
    runtime: { async resolveOpenCode() { resolved = true; }, async runtimeIdentity() {} },
    env: { CTG_OWNED_OPENCODE_RUNTIME: '/ambient/staging/runtime' },
  }), /not an acceptance trust root/);
  assert.equal(resolved, false);
});

test('explicit developer binary requires an independently supplied digest before runtime resolution', async () => {
  let resolved = false;
  await assert.rejects(selectNativePtyRuntime({
    runtime: { async resolveOpenCode() { resolved = true; }, async runtimeIdentity() {} },
    env: { CTG_OPENCODE_BIN: '/missing/native/opencode' },
  }), /requires CTG_NATIVE_PTY_EXPECTED_SHA256/);
  assert.equal(resolved, false);
});
