#!/usr/bin/env node
/** Strictly identified owned-runtime paired glyph rendering proof. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolveOpenCode, runtimeIdentity } from '../lib/opencode/runtime.mjs';
import { loadNativeTestRuntime, preflightNativeTestRuntimeArtifact } from './native-runtime-identity.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const installedDefault = process.argv.includes('--installed-default');
assert.ok(!installedDefault || !process.env.CTG_TEST_RUNTIME_ARTIFACT_ROOT,
  'installed acceptance must use the package default runtime resolver, not CTG_TEST_RUNTIME_ARTIFACT_ROOT');
assert.ok(!installedDefault || !process.env.CTG_TEST_RUNTIME_RELEASE_MANIFEST,
  'installed acceptance must use its packaged trusted release manifest');
assert.ok(!installedDefault || !process.env.CTG_OWNED_OPENCODE_RUNTIME,
  'installed acceptance must not select a developer-owned runtime artifact');
const ownedRoot = process.env.CTG_TEST_RUNTIME_ARTIFACT_ROOT ?? process.env.CTG_OWNED_OPENCODE_RUNTIME;
const trustedManifestPath = process.env.CTG_TEST_RUNTIME_RELEASE_MANIFEST ?? join(root, 'lib/opencode/runtime-release.json');
assert.ok(!process.env.CTG_OPENCODE_BIN, 'Unset CTG_OPENCODE_BIN; this proof uses the production owned-runtime resolver');
assert.ok(!process.env.CTG_TEST_RUNTIME_SHA256, 'Do not override trusted executable digest in glyph acceptance');
if (process.env.CTG_TEST_RUNTIME_ARTIFACT_ROOT) {
  assert.ok(process.env.CTG_TEST_RUNTIME_RELEASE_MANIFEST,
    'Explicit test artifact requires a trusted CTG_TEST_RUNTIME_RELEASE_MANIFEST');
}

let preflight;
let runtimeOptions = { runtimeReleaseManifestPath: trustedManifestPath };
if (ownedRoot) {
  preflight = await preflightNativeTestRuntimeArtifact({ ownedRoot, expectedManifestPath: trustedManifestPath });
  runtimeOptions = { ...runtimeOptions, ownedRuntime: ownedRoot };
} else {
  // Packaged/default owned-runtime selection is made by the normal resolver.
}

const binary = await resolveOpenCode(runtimeOptions);
const productIdentity = await runtimeIdentity(binary, runtimeOptions);
assert.equal(productIdentity.kind, 'ctg-owned', 'glyph acceptance requires the production resolver to select CTG-owned runtime');
const resolvedOwnedRoot = ownedRoot ?? dirname(dirname(dirname(binary)));
const identity = await loadNativeTestRuntime({
  binary,
  ownedRoot: resolvedOwnedRoot,
  expectedManifest: preflight?.expectedManifest ?? JSON.parse(await readFile(trustedManifestPath, 'utf8')),
});
assert.equal(resolve(identity.binary), resolve(binary));
if (installedDefault) {
  assert.equal(productIdentity.kind, 'ctg-owned', 'installed glyph acceptance requires the default resolver to select CTG-owned runtime');
  assert.equal(identity.binarySha256, productIdentity.binarySha256, 'independent identity must match default resolver byte identity');
}
if (preflight) {
  assert.equal(identity.binarySha256, preflight.identity.binarySha256);
  assert.equal(productIdentity.binarySha256, preflight.identity.binarySha256);
}

const artifact = process.env.CTG_GLYPH_ARTIFACT;
const scratch = await mkdtemp(join(tmpdir(), 'ctg-glyph-proof-'));
const ptyArtifact = join(scratch, 'pty.json');
const pythonCandidates = [process.env.PYTHON,
  join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
  process.platform === 'win32' ? 'python.exe' : 'python3', 'python'].filter(Boolean);
const findExecutable = candidate => {
  if (existsSync(candidate)) return candidate;
  return (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':')
    .map(directory => join(directory, candidate)).find(existsSync) ?? null;
};
const python = pythonCandidates.map(findExecutable).find(Boolean);
if (!python) throw new Error('Python was not found; set PYTHON to an interpreter path');
const args = [join(root, 'tools/native-glyph-pty.py'), '--binary', binary];
args.push('--artifact', ptyArtifact);
const probeEnv = Object.fromEntries(['PATH', 'LANG', 'LC_ALL'].filter(key => process.env[key])
  .map(key => [key, process.env[key]]));
const probe = spawnSync(python, args, { cwd: root, encoding: 'utf8', timeout: 120_000, env: probeEnv });
if (probe.stderr) process.stderr.write(probe.stderr);
if (probe.status !== 0) {
  if (probe.stdout) process.stderr.write(probe.stdout);
  await rm(scratch, { recursive: true, force: true });
  assert.equal(probe.status, 0, `PTY glyph probe failed with status ${probe.status}`);
}
const binaryHash = createHash('sha256').update(await readFile(binary)).digest('hex');
const proof = {
  runtime: { binary, binarySha256: binaryHash, compatibilityVersion: identity.compatibilityVersion,
    runtimeVersion: identity.runtimeVersion, sourceRevision: identity.sourceRevision,
    patchSha256: identity.patchSha256, lockSha256: identity.lockSha256,
    productResolverKind: productIdentity.kind, productResolverVersion: productIdentity.version },
  glyphProof: JSON.parse(await readFile(ptyArtifact, 'utf8')),
};
const rendered = JSON.stringify(proof, null, 2) + '\n';
process.stdout.write(rendered);
if (artifact) await (await import('node:fs/promises')).writeFile(resolve(artifact), rendered, 'utf8');
await rm(scratch, { recursive: true, force: true });
