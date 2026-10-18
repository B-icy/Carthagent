import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

/** Read the pinned recipe constants and the exact patch selected by that recipe. */
export async function readPinnedOwnedRuntimeInputs(repoRoot) {
  const canonicalRoot = await realpath(path.resolve(repoRoot));
  const recipe = await readFile(path.join(canonicalRoot, 'script/ctg/build-owned-runtime.sh'), 'utf8');
  const constant = (name) => {
    const matches = [...recipe.matchAll(new RegExp(`^${name}="([^"\\r\\n]+)"$`, 'gm'))];
    if (matches.length !== 1) throw new Error(`Build recipe must contain exactly one literal ${name}`);
    return matches[0][1];
  };
  const patchAssignments = [...recipe.matchAll(/^\s*patch_file\s*=.*$/gm)];
  if (patchAssignments.length !== 1) throw new Error('Build recipe must contain exactly one literal ROOT-relative patch_file');
  const patchFileMatch = patchAssignments[0][0].match(/^\s*patch_file="\$ROOT\/([^"\r\n]+)"\s*$/);
  if (!patchFileMatch) throw new Error('Build recipe patch_file must be a literal ROOT-relative path');
  const patchFile = patchFileMatch[1];
  if (!patchFile.startsWith('docs/patches/')
    || patchFile.includes('\\')
    || path.posix.isAbsolute(patchFile)
    || path.posix.normalize(patchFile) !== patchFile
    || patchFile.split('/').some((part) => part === '.' || part === '..' || part === '')) {
    throw new Error('Build recipe patch_file must be a canonical docs/patches-relative path');
  }
  const patchPath = path.resolve(canonicalRoot, ...patchFile.split('/'));
  const relativePatchPath = path.relative(canonicalRoot, patchPath);
  if (relativePatchPath.startsWith(`..${path.sep}`) || relativePatchPath === '..' || path.isAbsolute(relativePatchPath)) {
    throw new Error('Build recipe patch_file escapes the repository root');
  }
  const canonicalPatchPath = await realpath(patchPath);
  const actualRelativePatchPath = path.relative(canonicalRoot, canonicalPatchPath);
  if (actualRelativePatchPath.startsWith(`..${path.sep}`) || actualRelativePatchPath === '..' || path.isAbsolute(actualRelativePatchPath)) {
    throw new Error('Build recipe patch_file resolves outside the repository root');
  }
  const patch = await readFile(canonicalPatchPath);
  const expectedPatchSha256 = constant('EXPECTED_PATCH').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedPatchSha256)) throw new Error('Build recipe EXPECTED_PATCH is not a SHA-256 digest');
  const patchSha256 = createHash('sha256').update(patch).digest('hex');
  if (patchSha256 !== expectedPatchSha256) throw new Error('Pinned patch bytes do not match the build recipe');
  return {
    sourceRevision: constant('EXPECTED_SOURCE'),
    patchSha256,
    lockSha256: constant('EXPECTED_LOCK').toLowerCase(),
  };
}
