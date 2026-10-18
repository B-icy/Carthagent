#!/usr/bin/env node
/** Run approved visual-clear PTY proof with the installed package default owned runtime. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOpenCode, runtimeIdentity } from '../lib/opencode/runtime.mjs';
import { loadNativeTestRuntime } from './native-runtime-identity.mjs';
import { withoutRuntimeGithubToken } from './runtime-token-env.mjs';
import { resolveInstalledRuntime } from './installed-runtime-contract.mjs';

assert.equal(process.platform, 'linux', 'installed visual-clear acceptance is a Linux POSIX PTY claim');
for (const key of Object.keys(process.env)) {
  assert.ok(!/^CTG_(?:OPENCODE_BIN|OWNED_OPENCODE_RUNTIME|TEST_RUNTIME_)/i.test(key),
    `${key} must not override installed default runtime acceptance`);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'lib/opencode/runtime-release.json');
const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(manifestPath, 'utf8'));
const { binary, identity } = await resolveInstalledRuntime(resolveOpenCode, runtimeIdentity, manifestPath);
assert.equal(identity.kind, 'ctg-owned', 'installed visual-clear acceptance requires default CTG-owned runtime selection');
const ownedRoot = dirname(dirname(dirname(binary)));
const verified = await loadNativeTestRuntime({ binary, ownedRoot, expectedManifest: manifest });
assert.equal(verified.binarySha256, identity.binarySha256, 'independent verifier must match default-resolved runtime bytes');

const python = process.env.PYTHON ?? 'python3';
const artifact = join(root, `.ctg-visual-clear-${process.pid}.json`);
try {
  const result = spawnSync(python, [join(root, 'tools/test-owned-visual-clear.py'),
    '--binary', binary, '--owned-root', ownedRoot, '--release-manifest', manifestPath,
    '--artifact', artifact], {
    cwd: root, encoding: 'utf8', timeout: 240_000,
    // The clear runner uses its own strict allowlists and does not need the
    // acquisition token; keep it away from Python, fixture, host, and PTY.
    env: withoutRuntimeGithubToken(process.env),
  });
  if (result.error) throw result.error;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `visual-clear PTY proof failed with status ${result.status}`);
  const proof = JSON.parse(await (await import('node:fs/promises')).readFile(artifact, 'utf8'));
  assert.equal(proof.status, 'PASS');
  assert.equal(proof.binarySha256, identity.binarySha256, 'visual-clear proof must identify the installed default-resolved executable bytes');
  assert.equal(proof.runtimeIdentity?.runtimeVersion, manifest.runtimeVersion);
  assert.equal(proof.scope, 'Linux POSIX PTY; explicit trusted-preflighted owned staging artifact; offline loopback provider');
} finally {
  await (await import('node:fs/promises')).rm(artifact, { force: true });
}
