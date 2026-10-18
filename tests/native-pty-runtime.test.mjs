import assert from 'node:assert/strict';
import test from 'node:test';
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
  assert.equal(calls[0][1].ownedRoot, '/fixture/owned');
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

test('PTY command submit path types command and arguments before one natural Enter', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../tools/native-pty-smoke.py', import.meta.url), 'utf8');
  assert.match(source, /command = args\.command \+ \(f' \{args\.command_args\}' if args\.command_args else ''\)/);
  assert.match(source, /os\.write\(master, command\.encode\(\)\)[\s\S]{0,400}os\.write\(master, b'\\r'\)/);
  const submit = source.match(/if sent and not submitted and after_index == 0[\s\S]*?(?=confirmation_prompt)/)?.[0] ?? '';
  assert.match(submit, /submitted = True/);
  assert.doesNotMatch(submit, /sent = False|selected_at/);
});
