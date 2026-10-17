import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, join, relative, sep } from 'node:path';

export const NATIVE_TEST_COMPATIBILITY_VERSION = '2.0.32';

const SHA256 = /^[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40,64}$/;
const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Resolve and verify the executable used by native acceptance tests.
 *
 * `expectedManifest` is the caller's trusted, package-pinned runtime-release
 * record (not the adjacent ctg-runtime.json). Its `assets[platform]` entry
 * pins the executable digest. Developers may override that digest with
 * CTG_TEST_RUNTIME_SHA256 while retaining the expected source, patch, lock,
 * compatibility, and runtime identity from the trusted release record.
 *
 * Upstream runtimes are accepted only when --version is exactly
 * `opencode v2.0.32`. The owned CTG build is accepted only when its exact
 * runtime version, provenance manifest, platform path, and independently
 * expected binary digest all match. Provenance and bytes are checked before
 * executing the binary. No version normalization or substring matching is
 * used.
 */
export async function loadNativeTestRuntime({
  binary = process.env.CTG_OPENCODE_BIN,
  ownedRoot,
  expectedManifest,
  platform = nativePlatform(),
  env = process.env,
  spawnImpl = spawn,
} = {}) {
  if (typeof binary !== 'string' || !binary.trim()) {
    throw new Error('Pass the native test executable as `binary` or CTG_OPENCODE_BIN');
  }
  const executable = resolve(binary);
  if (!ownedRoot) {
    const versionOutput = await captureVersion(executable, spawnImpl);
    if (versionOutput !== `opencode v${NATIVE_TEST_COMPATIBILITY_VERSION}`) {
      throw new Error(`Unsupported native test runtime version: ${JSON.stringify(versionOutput)}`);
    }
    return Object.freeze({
      binary: executable,
      compatibilityVersion: NATIVE_TEST_COMPATIBILITY_VERSION,
      runtimeVersion: NATIVE_TEST_COMPATIBILITY_VERSION,
    });
  }

  if (typeof ownedRoot !== 'string' || !ownedRoot.trim()) throw new Error('ownedRoot must be a non-empty path');
  const root = resolve(ownedRoot);
  const trusted = validateTrustedRelease(expectedManifest, platform);
  const target = trusted.assets[platform];
  const executableName = platform.startsWith('windows-') ? 'opencode.exe' : 'opencode';
  const expectedBinary = resolve(root, `cli-${platform}`, 'bin', executableName);
  if (executable !== expectedBinary) throw new Error(`Owned runtime executable must be ${expectedBinary}`);

  const actualSha256 = createHash('sha256').update(await readFile(executable)).digest('hex');
  const expectedSha256 = env.CTG_TEST_RUNTIME_SHA256 ?? target.executableSha256;
  if (!SHA256.test(expectedSha256)) throw new Error('Expected owned runtime executable SHA-256 is invalid');
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Owned runtime binary SHA-256 mismatch: expected ${expectedSha256}, got ${actualSha256}`);
  }

  const manifestPath = join(root, 'ctg-runtime.json');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read owned runtime manifest at ${manifestPath}: ${error.message}`, { cause: error });
  }
  const expectedInner = {
    owner: 'Carthagent',
    sourceRepository: 'https://github.com/anomalyco/opencode',
    sourceRevision: trusted.sourceRevision,
    patchSha256: trusted.patchSha256,
    lockSha256: trusted.lockSha256,
    compatibilityVersion: trusted.compatibilityVersion,
    runtimeVersion: trusted.runtimeVersion,
    channel: `ctg.${trusted.compatibilityVersion}`,
    platform,
    webUI: false,
  };
  for (const [key, expected] of Object.entries(expectedInner)) {
    if (manifest?.[key] !== expected) throw new Error(`Owned runtime ${key} mismatch: expected ${String(expected)}, got ${String(manifest?.[key])}`);
  }

  const versionOutput = await captureVersion(executable, spawnImpl);
  if (versionOutput !== `opencode v${trusted.runtimeVersion}`) {
    throw new Error(`Unsupported owned native test runtime version: expected opencode v${trusted.runtimeVersion}, got ${JSON.stringify(versionOutput)}`);
  }
  return Object.freeze({
    binary: executable,
    compatibilityVersion: trusted.compatibilityVersion,
    runtimeVersion: trusted.runtimeVersion,
    binarySha256: actualSha256,
    sourceRevision: manifest.sourceRevision,
    patchSha256: manifest.patchSha256,
    lockSha256: manifest.lockSha256,
    platform,
  });
}

function validateTrustedRelease(release, platform) {
  const invalid = reason => { throw new Error(`Invalid trusted native runtime release manifest: ${reason}`); };
  if (!release || release.version !== 1 || !RELEASE_VERSION.test(release.releaseVersion ?? '')
    || release.compatibilityVersion !== NATIVE_TEST_COMPATIBILITY_VERSION
    || typeof release.runtimeVersion !== 'string' || !release.runtimeVersion.startsWith('0.0.0-ctg.')
    || !REVISION.test(release.sourceRevision ?? '')
    || !SHA256.test(release.patchSha256 ?? '') || !SHA256.test(release.lockSha256 ?? '')
    || !release.assets || typeof release.assets !== 'object' || Array.isArray(release.assets)) invalid('required pinned identity fields are missing or invalid');
  const asset = release.assets[platform];
  if (!asset || asset.name !== `opencode-${platform}.tar.gz` || !SHA256.test(asset.executableSha256 ?? '') || !SHA256.test(asset.archiveSha256 ?? '')) {
    invalid(`no exact asset digest is pinned for ${platform}`);
  }
  return release;
}

function nativePlatform() {
  const os = process.platform === 'win32' ? 'windows' : process.platform;
  return `${os}-${process.arch}`;
}

function captureVersion(binary, spawnImpl) {
  return new Promise((resolveOutput, reject) => {
    let child;
    try {
      child = spawnImpl(binary, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = callback => value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const onOutput = (target, chunk) => {
      if (settled) return;
      target.value += chunk;
      if (target.value.length > 64 * 1024) {
        child.kill?.('SIGKILL');
        finish(reject)(new Error('Native test runtime --version output exceeded 64 KiB'));
      }
    };
    const stdoutBuffer = { value: stdout };
    const stderrBuffer = { value: stderr };
    const timer = setTimeout(() => {
      child.kill?.('SIGKILL');
      finish(reject)(new Error('Native test runtime --version timed out after 5 seconds'));
    }, 5000);
    child.stdout?.setEncoding?.('utf8');
    child.stderr?.setEncoding?.('utf8');
    child.stdout?.on('data', chunk => onOutput(stdoutBuffer, chunk));
    child.stderr?.on('data', chunk => onOutput(stderrBuffer, chunk));
    child.once('error', finish(reject));
    child.once('close', code => {
      stdout = stdoutBuffer.value;
      stderr = stderrBuffer.value;
      if (code !== 0) {
        finish(reject)(new Error(`Native test runtime --version exited ${code}: ${stderr.trim()}`));
        return;
      }
      finish(resolveOutput)(stdout.trim());
    });
  });
}
