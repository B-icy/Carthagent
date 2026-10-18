import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRuntimeGithubFetch } from '../lib/opencode/runtime-github-transport.mjs';
import { readPinnedOwnedRuntimeInputs } from './pinned-owned-runtime-inputs.mjs';

export const REQUIRED_RUNTIME_TARGETS = Object.freeze({
  'linux-x64': ['linux', 'x64', 'opencode-linux-x64.tar.gz'],
  'linux-arm64': ['linux', 'arm64', 'opencode-linux-arm64.tar.gz'],
  'darwin-x64': ['darwin', 'x64', 'opencode-darwin-x64.tar.gz'],
  'darwin-arm64': ['darwin', 'arm64', 'opencode-darwin-arm64.tar.gz'],
  'windows-x64': ['windows', 'x64', 'opencode-windows-x64.tar.gz'],
});

const HEX_40 = /^[a-f0-9]{40}$/i;
const HEX_64 = /^[a-f0-9]{64}$/i;

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [releaseVersion, manifestPath, assetsBaseUrl] = process.argv.slice(2);
  if (!releaseVersion || !manifestPath || !assetsBaseUrl) {
    console.error('Usage: node tools/verify-owned-runtime-release.mjs <version> <trusted-manifest.json> <release-assets-base-url>');
    process.exit(2);
  }
  await verifyOwnedRuntimeRelease({ releaseVersion, manifestPath, assetsBaseUrl, repoRoot: process.cwd() });
}

/** Validate the packaged trusted outer manifest and acquire/verify each exact asset. */
export async function verifyOwnedRuntimeRelease({
  releaseVersion,
  manifestPath,
  assetsBaseUrl,
  repoRoot,
  acquireRuntime,
  cacheRoot,
  fetchImpl,
  runtimeToken = process.env.CTG_RUNTIME_GITHUB_TOKEN,
}) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  validateRuntimeReleaseManifest(manifest, releaseVersion);
  await validateRuntimeBuildInputs(manifest, path.resolve(repoRoot ?? process.cwd()));
  const acquireOwnedRuntime = acquireRuntime ?? (await import('../lib/opencode/runtime-artifact.mjs')).acquireOwnedRuntime;
  const runtimeFetch = runtimeToken
    ? createRuntimeGithubFetch({ token: runtimeToken, fetchImpl: fetchImpl ?? globalThis.fetch })
    : fetchImpl;

  for (const [key, [platform, arch, name]] of Object.entries(REQUIRED_RUNTIME_TARGETS)) {
    const asset = manifest.assets[key];
    const installed = await acquireOwnedRuntime({
      releaseVersion,
      platform,
      arch,
      baseUrl: assetsBaseUrl,
      expectedArchiveSha256: asset.archiveSha256,
      expectedExecutableSha256: asset.executableSha256,
      expectedSourceRevision: manifest.sourceRevision,
      expectedPatchSha256: manifest.patchSha256,
      expectedLockSha256: manifest.lockSha256,
      expectedCompatibilityVersion: manifest.compatibilityVersion,
      expectedRuntimeVersion: manifest.runtimeVersion,
      expectedChannel: `ctg.${manifest.compatibilityVersion}`,
      ...(cacheRoot ? { cacheRoot } : {}),
      ...(runtimeFetch ? { fetchImpl: runtimeFetch } : {}),
    });
    if (typeof installed !== 'string' || !installed) throw new Error(`Acquisition did not verify ${name}`);
  }
  return manifest;
}

export function validateRuntimeReleaseManifest(value, releaseVersion) {
  if (value?.version !== 1 || value.releaseVersion !== releaseVersion) {
    throw new Error('Trusted runtime release manifest version does not match the release tag');
  }
  if (typeof value.compatibilityVersion !== 'string' || !value.compatibilityVersion.trim()) {
    throw new Error('Runtime compatibilityVersion is required');
  }
  if (typeof value.runtimeVersion !== 'string' || !value.runtimeVersion.trim()) {
    throw new Error('Runtime runtimeVersion is required');
  }
  if (typeof value.sourceRevision !== 'string' || !HEX_40.test(value.sourceRevision)) {
    throw new Error('Runtime sourceRevision must be a 40-character commit SHA');
  }
  for (const field of ['patchSha256', 'lockSha256']) {
    if (typeof value[field] !== 'string' || !HEX_64.test(value[field])) {
      throw new Error(`Runtime ${field} must be a 64-character SHA-256 digest`);
    }
  }
  if (!value.assets || typeof value.assets !== 'object' || Array.isArray(value.assets)) {
    throw new Error('Runtime assets must be a platform map');
  }
  const actual = Object.keys(value.assets).sort();
  const required = Object.keys(REQUIRED_RUNTIME_TARGETS).sort();
  if (JSON.stringify(actual) !== JSON.stringify(required)) {
    throw new Error(`Trusted runtime manifest must contain exactly: ${required.join(', ')}`);
  }
  for (const [key, [, , name]] of Object.entries(REQUIRED_RUNTIME_TARGETS)) {
    const asset = value.assets[key];
    if (asset?.name !== name) throw new Error(`Runtime manifest asset name for ${key} must be ${name}`);
    for (const field of ['archiveSha256', 'executableSha256']) {
      if (typeof asset[field] !== 'string' || !HEX_64.test(asset[field])) {
        throw new Error(`${key}.${field} must be a 64-character SHA-256 digest`);
      }
    }
  }
}

/** Bind trusted artifact provenance to the exact recipe and patch in the tagged tree. */
export async function validateRuntimeBuildInputs(value, repoRoot) {
  const pinnedInputs = await readPinnedOwnedRuntimeInputs(repoRoot);
  for (const field of ['sourceRevision', 'patchSha256', 'lockSha256']) {
    if (pinnedInputs[field] !== value[field].toLowerCase()) {
      throw new Error(`Runtime ${field} does not match the tagged build recipe`);
    }
  }
}
