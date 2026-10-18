#!/usr/bin/env node
/** Run controlled-terminal semantics against the installed package's default owned runtime. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOpenCode, runtimeIdentity } from '../lib/opencode/runtime.mjs';
import { loadNativeTestRuntime } from './native-runtime-identity.mjs';
import { withoutRuntimeGithubToken } from './runtime-token-env.mjs';

assert.equal(process.platform, 'linux', 'installed terminal-semantics acceptance is currently a Linux controlled-PTY claim');
for (const key of Object.keys(process.env)) {
  assert.ok(!/^CTG_(?:OPENCODE_BIN|OWNED_OPENCODE_RUNTIME|TEST_RUNTIME_)/i.test(key),
    `${key} must not override installed default runtime acceptance`);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'lib/opencode/runtime-release.json');
const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(manifestPath, 'utf8'));
const binary = await resolveOpenCode({ runtimeReleaseManifestPath: manifestPath });
const identity = await runtimeIdentity(binary, { runtimeReleaseManifestPath: manifestPath });
assert.equal(identity.kind, 'ctg-owned', 'terminal semantics acceptance requires default installed CTG-owned runtime');
const verified = await loadNativeTestRuntime({
  binary, ownedRoot: dirname(dirname(dirname(binary))), expectedManifest: manifest,
});
assert.equal(verified.binary, binary);
assert.equal(verified.binarySha256, identity.binarySha256);

const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const env = withoutRuntimeGithubToken(process.env);
const result = spawnSync(python, [join(root, 'tools/native-terminal-semantics.py'), '--binary', binary], {
  cwd: root, encoding: 'utf8', timeout: 180_000, env,
});
if (result.error) throw result.error;
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
assert.equal(result.status, 0, `controlled terminal semantics failed with status ${result.status}`);
const proof = JSON.parse(result.stdout);
assert.equal(proof.status, 'PASS', 'controlled terminal harness must complete every configured terminal check');
assert.equal(resolve(proof.binaryResolvedPath), resolve(binary), 'PTY proof must identify the exact default-resolved runtime executable');
assert.equal(proof.binarySha256, identity.binarySha256, 'PTY proof executable digest must match the trusted owned identity');
assert.equal(proof.binaryVersion, `opencode v${manifest.runtimeVersion}`, 'PTY proof version must match the packaged runtime manifest');
assert.equal(proof.physicalOSClipboardVerified, false, 'controlled terminal model is not a physical OS clipboard claim');
assert.equal(proof.controlledHostClipboardModel, true);
