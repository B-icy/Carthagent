import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNativeTestRuntime, preflightNativeTestRuntimeArtifact } from './native-runtime-identity.mjs';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Select the production runtime, binding every owned path to trusted release metadata. */
export async function selectNativePtyRuntime({ runtime, env = process.env, root = PACKAGE_ROOT, identityTools = { loadNativeTestRuntime, preflightNativeTestRuntimeArtifact } }) {
  if (env.CTG_TEST_RUNTIME_ARTIFACT_ROOT && (env.CTG_OPENCODE_BIN || env.OPENCODE_BIN)) {
    throw new Error('Do not combine an injected owned artifact root with an explicit binary override.');
  }

  let options = {};
  let expectedManifest;
  let ownedRoot;
  if (env.CTG_TEST_RUNTIME_ARTIFACT_ROOT) {
    ownedRoot = resolve(env.CTG_TEST_RUNTIME_ARTIFACT_ROOT);
    const expectedManifestPath = env.CTG_TEST_RUNTIME_RELEASE_MANIFEST;
    // This verifies pinned source/patch/lock/platform provenance and the
    // executable digest before resolveOpenCode is allowed to execute it.
    const preflight = await identityTools.preflightNativeTestRuntimeArtifact({
      ownedRoot,
      expectedManifestPath,
      env,
    });
    expectedManifest = preflight.expectedManifest;
    options = { ownedRuntime: ownedRoot };
  } else if (env.CTG_OWNED_OPENCODE_RUNTIME) {
    throw new Error('CTG_OWNED_OPENCODE_RUNTIME is a developer selector, not an acceptance trust root; use CTG_TEST_RUNTIME_ARTIFACT_ROOT and CTG_TEST_RUNTIME_RELEASE_MANIFEST.');
  } else if (env.CTG_OPENCODE_BIN || env.OPENCODE_BIN) {
    const binary = env.CTG_OPENCODE_BIN ?? env.OPENCODE_BIN;
    if (!binary.includes('/') && !binary.includes('\\')) throw new Error('Explicit native PTY binary must be a filesystem path.');
    const expectedHash = env.CTG_NATIVE_PTY_EXPECTED_SHA256;
    if (!/^[a-f0-9]{64}$/i.test(expectedHash ?? '')) throw new Error('Explicit native PTY binary requires CTG_NATIVE_PTY_EXPECTED_SHA256.');
    const actualHash = createHash('sha256').update(await readFile(resolve(binary))).digest('hex');
    if (actualHash !== expectedHash.toLowerCase()) throw new Error(`Explicit native PTY binary SHA-256 mismatch before runtime selection: ${actualHash}`);
    options = { binary };
  }

  if (typeof runtime.resolveOpenCode !== 'function' || typeof runtime.runtimeIdentity !== 'function') {
    throw new Error('Native PTY acceptance requires resolveOpenCode(options) and runtimeIdentity(binary, options) from the production runtime selector.');
  }
  const binary = await runtime.resolveOpenCode(options);
  const identity = await runtime.runtimeIdentity(binary, options);
  if (!identity.binaryPath || resolve(identity.binaryPath) !== resolve(binary)) {
    throw new Error(`Runtime identity does not bind the selected executable: selected ${binary}, identity ${identity.binaryPath ?? 'missing'}.`);
  }

  if (identity.kind === 'ctg-owned') {
    if (!ownedRoot) {
      const executableName = process.platform === 'win32' ? 'opencode.exe' : 'opencode';
      ownedRoot = resolve(dirname(dirname(dirname(binary))));
      const expectedBinary = resolve(ownedRoot, `cli-${identity.platform}`, 'bin', executableName);
      if (resolve(binary) !== expectedBinary) throw new Error(`Selected owned runtime is outside its canonical artifact layout: ${binary}`);
      const manifestPath = resolve(root, 'lib/opencode/runtime-release.json');
      try { expectedManifest = JSON.parse(await readFile(manifestPath, 'utf8')); }
      catch (error) { throw new Error(`Default owned runtime has no independently pinned package release manifest at ${manifestPath}: ${error.message}`); }
    }
    const verified = await identityTools.loadNativeTestRuntime({ binary, ownedRoot, expectedManifest, env });
    if (verified.binarySha256 !== identity.binarySha256
      || verified.sourceRevision !== identity.sourceRevision
      || verified.patchSha256 !== identity.patchSha256
      || verified.lockSha256 !== identity.lockSha256) {
      throw new Error('Independent owned runtime verification does not match the production runtime identity.');
    }
    return Object.freeze({ binary, identity, verified });
  }

  if (identity.kind !== 'upstream-compatible') throw new Error(`Unrecognized selected native runtime kind: ${identity.kind}`);
  if (env.CTG_TEST_RUNTIME_ARTIFACT_ROOT) throw new Error('Injected owned artifact resolved as upstream-compatible; refusing the selected runtime.');
  const verified = await identityTools.loadNativeTestRuntime({ binary, env });
  if (verified.runtimeVersion !== identity.version || verified.runtimeVersion !== '2.0.32') {
    throw new Error('Selected upstream-compatible runtime does not match the pinned compatibility version.');
  }
  if (env.CTG_NATIVE_PTY_EXPECTED_SHA256) {
    const actual = createHash('sha256').update(await readFile(binary)).digest('hex');
    if (actual !== env.CTG_NATIVE_PTY_EXPECTED_SHA256.toLowerCase()) throw new Error(`Explicit native PTY binary changed during runtime selection: ${actual}`);
  }
  return Object.freeze({ binary, identity, verified });
}
