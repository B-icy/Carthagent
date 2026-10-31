import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { OPENCODE_VERSION, CTG_RUNTIME_VERSION, readRuntimeReleaseManifest } from '../lib/opencode/runtime.mjs';
import { REQUIRED_RUNTIME_TARGETS, validateRuntimeBuildInputs } from './verify-owned-runtime-release.mjs';

const root = resolve(import.meta.dirname, '..');

export async function readManualRuntimeManifest({ runtimeManifest, manifestSha256: expectedDigest } = {}) {
  if (runtimeManifest && !/^[a-f0-9]{64}$/.test(expectedDigest ?? ''))
    throw Error('An explicit runtime manifest requires its independently supplied SHA-256 digest');
  const manifestPath = runtimeManifest ? resolve(runtimeManifest) : join(root, 'lib/opencode/runtime-release.json');
  const bytes = await readFile(manifestPath);
  const manifestSha256 = createHash('sha256').update(bytes).digest('hex');
  if (expectedDigest && manifestSha256 !== expectedDigest)
    throw Error('Runtime manifest SHA-256 checksum mismatch');
  let manifest;
  if (!runtimeManifest) manifest = await readRuntimeReleaseManifest(manifestPath);
  else {
    manifest = JSON.parse(bytes);
    const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    if (manifest?.version !== 1 || manifest.releaseVersion !== version
      || manifest.compatibilityVersion !== OPENCODE_VERSION || manifest.runtimeVersion !== CTG_RUNTIME_VERSION
      || !manifest.assets || typeof manifest.assets !== 'object' || Array.isArray(manifest.assets)
      || !Object.keys(manifest.assets).length)
      throw Error('Invalid or incompatible manual candidate manifest');
    // Explicit candidates can contain only platforms actually built, never invented release digests.
    for (const [target, asset] of Object.entries(manifest.assets)) {
      if (!Object.hasOwn(REQUIRED_RUNTIME_TARGETS, target) || asset?.name !== REQUIRED_RUNTIME_TARGETS[target][2]
        || !/^[a-f0-9]{64}$/.test(asset.archiveSha256 ?? '') || !/^[a-f0-9]{64}$/.test(asset.executableSha256 ?? ''))
        throw Error(`Invalid manual candidate asset: ${target}`);
    }
  }
  if (!manifest) throw Error('Runtime release manifest is missing');
  // Published kits keep their immutable release trust root when development
  // advances the recipe. Explicit candidates must still match that recipe.
  if (runtimeManifest) await validateRuntimeBuildInputs(manifest, root);
  return { manifest, manifestPath, manifestSha256 };
}
