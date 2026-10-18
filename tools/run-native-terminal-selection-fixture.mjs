#!/usr/bin/env node
/** Seed a completed response with nativeFixture, then attach only for selection. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflightNativeTestRuntimeArtifact } from './native-runtime-identity.mjs';
import { withoutRuntimeGithubToken } from './runtime-token-env.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.PYTHON ?? 'python3';
const candidateRoot = process.env.CTG_TEST_RUNTIME_ARTIFACT_ROOT;
const manifestPath = process.env.CTG_TEST_RUNTIME_RELEASE_MANIFEST;
const expectedDigest = process.env.CTG_TEST_RUNTIME_SHA256;
assert.ok(candidateRoot, 'CTG_TEST_RUNTIME_ARTIFACT_ROOT is required; no packaged/default fallback is allowed');
assert.ok(manifestPath, 'CTG_TEST_RUNTIME_RELEASE_MANIFEST is required; no packaged/default fallback is allowed');
assert.ok(expectedDigest && /^[a-f0-9]{64}$/.test(expectedDigest), 'CTG_TEST_RUNTIME_SHA256 must provide the expected binary SHA-256');

const proofEnv = withoutRuntimeGithubToken(process.env);
proofEnv.CTG_TEST_RUNTIME_ARTIFACT_ROOT = resolve(candidateRoot);
proofEnv.CTG_TEST_RUNTIME_RELEASE_MANIFEST = resolve(manifestPath);
proofEnv.CTG_TEST_RUNTIME_SHA256 = expectedDigest;
proofEnv.CTG_OWNED_OPENCODE_RUNTIME = proofEnv.CTG_TEST_RUNTIME_ARTIFACT_ROOT;
const preflight = await preflightNativeTestRuntimeArtifact({
  ownedRoot: proofEnv.CTG_TEST_RUNTIME_ARTIFACT_ROOT,
  expectedManifestPath: proofEnv.CTG_TEST_RUNTIME_RELEASE_MANIFEST,
  env: proofEnv,
});
assert.equal(preflight.identity.binarySha256, expectedDigest, 'preflight digest differs from mandatory expected digest');
const binary = preflight.identity.binary;
assert.equal(binary, resolve(candidateRoot, `cli-${preflight.identity.platform}`, 'bin', 'opencode'));
const binarySha256 = createHash('sha256').update(await readFile(binary)).digest('hex');
assert.equal(binarySha256, expectedDigest, 'independent binary byte digest mismatch');
const manifest = preflight.expectedManifest;
const probePath = join(root, 'tools/native-terminal-selection-session.py');
const probeSha256 = createHash('sha256').update(await readFile(probePath)).digest('hex');
// nativeFixture's resolver runs in this process. Explicitly provide the same
// trusted candidate selection there; its spawned host receives the same pins.
for (const key of ['CTG_TEST_RUNTIME_ARTIFACT_ROOT', 'CTG_TEST_RUNTIME_RELEASE_MANIFEST',
  'CTG_TEST_RUNTIME_SHA256', 'CTG_OWNED_OPENCODE_RUNTIME']) {
  process.env[key] = proofEnv[key];
}

let host;
try {
  const { nativeFixture } = await import('./native-fixture.mjs');
  host = await nativeFixture({
    plugin: null,
    verifyInventory: false,
    preserveTemp: false,
    env: {
      CTG_OWNED_OPENCODE_RUNTIME: proofEnv.CTG_TEST_RUNTIME_ARTIFACT_ROOT,
      CTG_TEST_RUNTIME_ARTIFACT_ROOT: proofEnv.CTG_TEST_RUNTIME_ARTIFACT_ROOT,
      CTG_TEST_RUNTIME_RELEASE_MANIFEST: proofEnv.CTG_TEST_RUNTIME_RELEASE_MANIFEST,
      CTG_TEST_RUNTIME_SHA256: expectedDigest,
    },
    runtimeResolver: {
      async resolveOpenCode() { return binary; },
      async runtimeIdentity() {
        return {
          kind: 'ctg-owned',
          binaryPath: binary,
          binarySha256: expectedDigest,
          version: preflight.identity.runtimeVersion,
          sourceRevision: preflight.identity.sourceRevision,
          patchSha256: preflight.identity.patchSha256,
          lockSha256: preflight.identity.lockSha256,
        };
      },
    },
    respond(_body, res) {
      res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' });
      const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
        id: 'selection-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture',
        choices: [{ index: 0, delta, finish_reason }],
      })}\n\n`;
      res.end(chunk({ role: 'assistant', content: 'FINAL[SNIP]END' }) + chunk({}, 'stop'));
    },
  });
  const session = await host.client.session.create({
    location: host.location,
    model: host.model,
    title: 'selection response fixture',
  }, host.request());
  await host.client.session.prompt({
    sessionID: session.id,
    text: 'Render the exact selection fixture now.',
  }, host.request());
  await host.outcome(session.id);
  assert.ok(host.requests.length > 0, 'fixture provider request is required before attachment');

  const args = [probePath,
    '--binary', binary,
    '--expected-sha256', expectedDigest,
    '--expected-version', `opencode v${manifest.runtimeVersion}`,
    '--expected-probe-sha256', probeSha256,
    '--server', host.baseUrl,
    '--server-password', host.password,
    '--session', session.id,
    '--cwd', host.cwd,
    '--expected-provider-ready'];
  if (process.argv.includes('--retain-state')) args.push('--retain-state');
  const result = spawnSync(python, args, {
    cwd: host.cwd,
    encoding: 'utf8',
    timeout: 60_000,
    env: withoutRuntimeGithubToken(process.env),
  });
  if (result.error) throw result.error;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `existing-session selection probe failed with status ${result.status}`);
  const proof = JSON.parse(result.stdout);
  assert.equal(proof.binaryResolvedPath, binary);
  assert.equal(proof.binarySha256, expectedDigest);
  assert.equal(proof.binaryVersion, `opencode v${manifest.runtimeVersion}`);
  assert.equal(proof.probeSha256, probeSha256);
  assert.equal(proof.status, 'PASS');
  assert.equal(proof.physicalOSClipboardVerified, false);
  assert.equal(proof.controlledHostClipboardModel, true);
} finally {
  // nativeFixture owns the detached service group. Never signal a broad process
  // pattern or infer ownership from a PID not returned by this fixture.
  if (host) await host.close({ preserveTemp: process.argv.includes('--retain-state') });
}
