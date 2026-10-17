import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const PLATFORMS = Object.freeze({
  'linux-x64': 'opencode-linux-x64.tar.gz',
  'linux-arm64': 'opencode-linux-arm64.tar.gz',
  'darwin-x64': 'opencode-darwin-x64.tar.gz',
  'darwin-arm64': 'opencode-darwin-arm64.tar.gz',
  'windows-x64': 'opencode-windows-x64.tar.gz',
});
const HEX_40 = /^[a-f0-9]{40}$/i;
const HEX_64 = /^[a-f0-9]{64}$/i;

const [versionArg, manifestPath, assetsDir, repoRootArg] = process.argv.slice(2);
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!versionArg || !manifestPath || !assetsDir) {
    console.error('Usage: node tools/verify-owned-runtime-release.mjs <version> <trusted-manifest.json> <downloaded-assets-dir> [tagged-repo-root]');
    process.exit(2);
  }
  await verifyOwnedRuntimeRelease({ version: versionArg, manifestPath, assetsDir, repoRoot: repoRootArg });
}

export async function verifyOwnedRuntimeRelease({ version, manifestPath, assetsDir, repoRoot: rootArg }) {
const release = JSON.parse(await readFile(manifestPath, 'utf8'));
validateManifest(release, version);
await validateBuildInputs(release, path.resolve(rootArg ?? path.join(import.meta.dirname, '..')));

const downloaded = await readdir(assetsDir);
const expectedNames = Object.values(PLATFORMS).sort();
const actualNames = downloaded.filter((name) => name.startsWith('opencode-') && name.endsWith('.tar.gz') && !name.endsWith('-source.tar.gz')).sort();
if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
  throw new Error(`Downloaded runtime assets must include all five: ${expectedNames.join(', ')}`);
}

for (const [platform, name] of Object.entries(PLATFORMS)) {
  const entry = release.assets[platform];
  const archivePath = path.join(assetsDir, name);
  const info = await lstat(archivePath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${name} must be a regular downloaded file`);
  if (info.size > 512 * 1024 * 1024) throw new Error(`${name} exceeds the 512 MiB archive limit`);
  const bytes = await readFile(archivePath);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== entry.archiveSha256.toLowerCase()) throw new Error(`${name} SHA-256 does not match the packaged trusted manifest`);
  inspectArchive(bytes, release, platform, entry.executableSha256.toLowerCase());
  console.log(`Verified ${platform}: ${name} (${digest})`);
}
}

function validateManifest(value, version) {
  if (value?.version !== 1 || value.releaseVersion !== version) throw new Error('Trusted runtime release manifest version does not match the release tag');
  for (const field of ['compatibilityVersion', 'runtimeVersion']) {
    if (typeof value[field] !== 'string' || !value[field].trim()) throw new Error(`Runtime ${field} is required`);
  }
  if (typeof value.sourceRevision !== 'string' || !HEX_40.test(value.sourceRevision)) throw new Error('Runtime sourceRevision must be a 40-character commit SHA');
  for (const field of ['patchSha256', 'lockSha256']) {
    if (typeof value[field] !== 'string' || !HEX_64.test(value[field])) throw new Error(`Runtime ${field} must be a 64-character SHA-256 digest`);
  }
  if (!value.assets || typeof value.assets !== 'object' || Array.isArray(value.assets)) throw new Error('Runtime assets must be a platform map');
  const got = Object.keys(value.assets).sort();
  const expected = Object.keys(PLATFORMS).sort();
  if (JSON.stringify(got) !== JSON.stringify(expected)) throw new Error(`Trusted runtime manifest must contain exactly: ${expected.join(', ')}`);
  for (const [platform, name] of Object.entries(PLATFORMS)) {
    const entry = value.assets[platform];
    if (entry?.name !== name) throw new Error(`Runtime manifest asset name for ${platform} must be ${name}`);
    for (const field of ['archiveSha256', 'executableSha256']) {
      if (typeof entry[field] !== 'string' || !HEX_64.test(entry[field])) throw new Error(`${platform}.${field} must be a 64-character SHA-256 digest`);
    }
  }
}

async function validateBuildInputs(value, root) {
  const recipe = await readFile(path.join(root, 'script/ctg/build-owned-runtime.sh'), 'utf8');
  for (const [field, recipeKey] of [['sourceRevision', 'EXPECTED_SOURCE'], ['patchSha256', 'EXPECTED_PATCH'], ['lockSha256', 'EXPECTED_LOCK']]) {
    if (!recipe.includes(`${recipeKey}="${value[field]}"`)) throw new Error(`Runtime ${field} does not match the tagged build recipe`);
  }
  const patch = await readFile(path.join(root, 'docs/patches/opencode-v2.0.32-session-ui.patch'));
  if (createHash('sha256').update(patch).digest('hex') !== value.patchSha256.toLowerCase()) {
    throw new Error('Runtime patch SHA-256 does not match the tagged patch');
  }
}

function inspectArchive(bytes, release, platform, expectedExecutableSha) {
  const result = spawnSync('python3', ['-c', PYTHON_INSPECTOR], { input: bytes, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Could not inspect ${platform} runtime archive: ${result.stderr || result.error?.message || 'unknown error'}`);
  const inner = JSON.parse(result.stdout);
  const [os, arch] = platform.split('-');
  const executablePath = `cli-${platform}/bin/${os === 'windows' ? 'opencode.exe' : 'opencode'}`;
  const expected = {
    owner: 'Carthagent',
    sourceRepository: 'https://github.com/anomalyco/opencode',
    sourceRevision: release.sourceRevision,
    lockSha256: release.lockSha256,
    patchSha256: release.patchSha256,
    compatibilityVersion: release.compatibilityVersion,
    runtimeVersion: release.runtimeVersion,
    channel: 'ctg.2.0.32',
    platform: `${os}-${arch}`,
    webUI: false,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (inner.manifest?.[key] !== value) throw new Error(`${platform} inner runtime manifest ${key} mismatch`);
  }
  if (inner.executablePath !== executablePath || inner.executableSha256 !== expectedExecutableSha) {
    throw new Error(`${platform} executable identity does not match trusted release metadata`);
  }
  if (typeof inner.sums !== 'string' || !inner.sums.split(/\r?\n/).some((line) => {
    const [hash, file] = line.trim().split(/\s+/, 2);
    return file?.replace(/^\*?/, '') === executablePath && hash?.toLowerCase() === expectedExecutableSha;
  })) throw new Error(`${platform} SHA256SUMS does not bind the expected executable`);
}

const PYTHON_INSPECTOR = String.raw`
import hashlib, io, json, sys, tarfile
raw = sys.stdin.buffer.read(512 * 1024 * 1024 + 1)
if len(raw) > 512 * 1024 * 1024: raise ValueError('archive exceeds compressed size limit')
t = tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz')
files = {}
members = t.getmembers()
if len(members) > 20000: raise ValueError('archive contains too many entries')
expanded = 0
for m in members:
    if not m.isfile():
        if not m.isdir(): raise ValueError('archive contains links or special entries')
        continue
    if m.name.startswith('/') or '..' in m.name.split('/') or '\\' in m.name: raise ValueError('unsafe archive path')
    if m.name in files: raise ValueError('archive contains duplicate file paths')
    expanded += m.size
    if expanded > 1024 * 1024 * 1024: raise ValueError('archive exceeds expanded size limit')
    files[m.name] = t.extractfile(m).read()
manifest = json.loads(files['ctg-runtime.json'])
platform = manifest['platform']
os_name, arch = platform.split('-', 1)
exe_path = 'cli-' + platform + '/bin/' + ('opencode.exe' if os_name == 'windows' else 'opencode')
exe = files[exe_path]
print(json.dumps({'manifest': manifest, 'sums': files['SHA256SUMS'].decode('utf-8'),
                  'executablePath': exe_path, 'executableSha256': hashlib.sha256(exe).hexdigest()}))
`;
