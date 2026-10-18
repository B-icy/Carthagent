import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { link, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const REQUIRED_RUNTIME_TARGETS = Object.freeze({
  'linux-x64': ['linux', 'x64', 'opencode-linux-x64.tar.gz', 'cli-linux-x64/bin/opencode'],
  'linux-arm64': ['linux', 'arm64', 'opencode-linux-arm64.tar.gz', 'cli-linux-arm64/bin/opencode'],
  'darwin-x64': ['darwin', 'x64', 'opencode-darwin-x64.tar.gz', 'cli-darwin-x64/bin/opencode'],
  'darwin-arm64': ['darwin', 'arm64', 'opencode-darwin-arm64.tar.gz', 'cli-darwin-arm64/bin/opencode'],
  'windows-x64': ['windows', 'x64', 'opencode-windows-x64.tar.gz', 'cli-windows-x64/bin/opencode.exe'],
});

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [releaseVersion, assetsDirectory, repoRoot = process.cwd()] = process.argv.slice(2);
  if (!releaseVersion || !assetsDirectory) {
    console.error('Usage: node tools/generate-owned-runtime-release.mjs <release-version> <assets-directory> [repo-root]');
    process.exit(2);
  }
  const manifest = await generateOwnedRuntimeRelease({ releaseVersion, assetsDirectory, repoRoot });
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Verify five build outputs through the production USTAR acquisition parser,
 * then emit a candidate outer trust manifest. Pinned build records must be
 * made by the native build job from its binary before it is archived; records
 * are claims until the acquisition module verifies them against archive bytes.
 */
export async function generateOwnedRuntimeRelease({
  releaseVersion,
  assetsDirectory,
  repoRoot,
  outputPath = path.join(path.dirname(path.resolve(assetsDirectory)), 'runtime-release.json.candidate'),
  acquireRuntime,
}) {
  validateReleaseVersion(releaseVersion);
  const directory = path.resolve(assetsDirectory);
  const root = path.resolve(repoRoot ?? process.cwd());
  const provenance = await readPinnedBuildInputs(root);
  const acquireOwnedRuntime = acquireRuntime ?? (await import('../lib/opencode/runtime-artifact.mjs')).acquireOwnedRuntime;

  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile())) {
    throw new Error('Assets directory may contain only regular archive and build-record files');
  }
  const files = entries.map((entry) => entry.name).sort();
  const expectedFiles = Object.values(REQUIRED_RUNTIME_TARGETS)
    .flatMap(([, , archiveName]) => [archiveName, `${archiveName}.build.json`])
    .sort();
  if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
    throw new Error(`Assets directory must contain exactly the five runtime archives and their build records: ${expectedFiles.join(', ')}`);
  }

  const cacheRoot = await mkdtemp(path.join(os.tmpdir(), 'ctg-runtime-manifest-'));
  const assets = {};
  try {
    for (const [key, [platform, arch, name, executablePath]] of Object.entries(REQUIRED_RUNTIME_TARGETS)) {
      const archivePath = path.join(directory, name);
      const archiveBytes = await readFile(archivePath);
      if (!archiveBytes.length) throw new Error(`${name} is empty`);
      const archiveSha256 = sha256(archiveBytes);
      const record = JSON.parse(await readFile(path.join(directory, `${name}.build.json`), 'utf8'));
      validateBuildRecord(record, { key, platform, arch, provenance });
      const expectedExecutableSha256 = record.executableSha256.toLowerCase();

      // The fetch shim exposes only the exact local archive requested by the
      // approved acquisition API. No network request or release upload occurs.
      const fetchImpl = async (url) => {
        const requestedName = decodeURIComponent(new URL(url).pathname.split('/').at(-1) ?? '');
        if (requestedName !== name) return new Response('not found', { status: 404 });
        return new Response(archiveBytes, { status: 200, headers: { 'content-length': String(archiveBytes.length) } });
      };
      const verifiedRoot = await acquireOwnedRuntime({
        releaseVersion,
        platform,
        arch,
        assetName: name,
        baseUrl: 'https://runtime-manifest-fixture.invalid/assets',
        fetchImpl,
        cacheRoot,
        expectedArchiveSha256: archiveSha256,
        expectedExecutableSha256,
        expectedSourceRevision: provenance.sourceRevision,
        expectedPatchSha256: provenance.patchSha256,
        expectedLockSha256: provenance.lockSha256,
        expectedCompatibilityVersion: provenance.compatibilityVersion,
        expectedRuntimeVersion: provenance.runtimeVersion,
        expectedChannel: `ctg.${provenance.compatibilityVersion}`,
      });
      const verifiedExecutable = await readFile(path.join(verifiedRoot, executablePath));
      if (sha256(verifiedExecutable) !== expectedExecutableSha256) {
        throw new Error(`Acquisition returned an unexpected executable for ${key}`);
      }
      await validateRuntimeTree(verifiedRoot, { key, executablePath, runtimeVersion: provenance.runtimeVersion });
      assets[key] = { name, archiveSha256, executableSha256: expectedExecutableSha256 };
    }
  } finally {
    await rm(cacheRoot, { recursive: true, force: true });
  }

  const manifest = {
    version: 1,
    releaseVersion,
    compatibilityVersion: provenance.compatibilityVersion,
    runtimeVersion: provenance.runtimeVersion,
    sourceRevision: provenance.sourceRevision,
    patchSha256: provenance.patchSha256,
    lockSha256: provenance.lockSha256,
    assets,
  };
  const destination = path.resolve(outputPath);
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    // Link is atomic and fails if the candidate already exists; the generator
    // never silently replaces a previously reviewed candidate.
    await link(temporary, destination);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
  return manifest;
}

function validateReleaseVersion(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.test(value)) {
    throw new TypeError('releaseVersion must be a canonical semantic version without a v prefix');
  }
}

async function readPinnedBuildInputs(repoRoot) {
  const recipePath = path.join(repoRoot, 'script/ctg/build-owned-runtime.sh');
  const recipe = await readFile(recipePath, 'utf8');
  const constant = (name) => {
    const match = recipe.match(new RegExp(`^${name}="([^"]+)"$`, 'm'));
    if (!match) throw new Error(`Build recipe is missing pinned ${name}`);
    return match[1];
  };
  // Read the reviewed literal selected by the build recipe, not a separately
  // hard-coded patch name. Accept only a canonical docs/patches-relative path;
  // the recipe is data here and is never evaluated as shell code.
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
  const canonicalRoot = await realpath(path.resolve(repoRoot));
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
  const runtime = recipe.match(/OPENCODE_VERSION=([^\s]+)\s+OPENCODE_CHANNEL=ctg\.([^\s]+)/);
  if (!runtime || runtime[2] !== runtime[1].replace(/^0\.0\.0-ctg\./, '')) {
    throw new Error('Build recipe must pin a matching CTG compatibility/runtime version');
  }
  const provenance = {
    sourceRevision: constant('EXPECTED_SOURCE'),
    lockSha256: constant('EXPECTED_LOCK').toLowerCase(),
    patchSha256: constant('EXPECTED_PATCH').toLowerCase(),
    compatibilityVersion: runtime[2],
    runtimeVersion: runtime[1],
  };
  if (!/^[a-f0-9]{40}$/i.test(provenance.sourceRevision)) throw new Error('Build recipe source revision is not a commit SHA');
  for (const field of ['lockSha256', 'patchSha256']) {
    if (!/^[a-f0-9]{64}$/.test(provenance[field])) throw new Error(`Build recipe ${field} is not a SHA-256 digest`);
  }
  if (sha256(patch) !== provenance.patchSha256) throw new Error('Pinned patch bytes do not match the build recipe');
  return provenance;
}

function validateBuildRecord(record, { key, platform, arch, provenance }) {
  if (!record || record.version !== 1 || record.target !== key
    || record.platform !== platform || record.arch !== arch
    || record.sourceRevision !== provenance.sourceRevision
    || record.patchSha256?.toLowerCase() !== provenance.patchSha256
    || record.lockSha256?.toLowerCase() !== provenance.lockSha256
    || record.compatibilityVersion !== provenance.compatibilityVersion
    || record.runtimeVersion !== provenance.runtimeVersion
    || typeof record.executableSha256 !== 'string'
    || !/^[a-f0-9]{64}$/i.test(record.executableSha256)) {
    throw new Error(`Build record for ${key} does not match the pinned recipe and target`);
  }
}

async function validateRuntimeTree(root, { key, executablePath, runtimeVersion }) {
  const expectedDirectories = new Set(['', `cli-${key}`, `cli-${key}/bin`]);
  const expectedFiles = new Set([
    'LICENSE',
    'SHA256SUMS',
    'ctg-runtime.json',
    executablePath,
    `cli-${key}/package.json`,
  ]);
  const actualDirectories = new Set();
  const actualFiles = new Set();
  const visit = async (directory, relative) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Runtime archive contains a symlink: ${childRelative}`);
      if (entry.isDirectory()) {
        actualDirectories.add(childRelative);
        await visit(path.join(directory, entry.name), childRelative);
      } else if (entry.isFile()) actualFiles.add(childRelative);
      else throw new Error(`Runtime archive contains a non-regular member: ${childRelative}`);
    }
  };
  await visit(root, '');
  for (const member of actualDirectories) {
    if (!expectedDirectories.has(member)) throw new Error(`Runtime archive contains an unexpected directory: ${member}`);
  }
  for (const member of actualFiles) {
    if (!expectedFiles.has(member)) throw new Error(`Runtime archive contains an unexpected file: ${member}`);
  }
  for (const member of expectedDirectories) {
    if (member && !actualDirectories.has(member)) throw new Error(`Runtime archive is missing directory: ${member}`);
  }
  for (const member of expectedFiles) {
    if (!actualFiles.has(member)) throw new Error(`Runtime archive is missing file: ${member}`);
  }
  const packageMetadata = JSON.parse(await readFile(path.join(root, `cli-${key}/package.json`), 'utf8'));
  const [, platform, arch] = key.match(/^(linux|darwin|windows)-(x64|arm64)$/) ?? [];
  const packageOs = platform === 'windows' ? 'win32' : platform;
  if (packageMetadata.name !== `@opencode/cli-${key}`
    || packageMetadata.version !== runtimeVersion
    || packageMetadata.os?.length !== 1 || packageMetadata.os[0] !== packageOs
    || packageMetadata.cpu?.length !== 1 || packageMetadata.cpu[0] !== arch) {
    throw new Error(`Runtime archive package metadata does not match ${key} and ${runtimeVersion}`);
  }
}

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
