import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { after, before, test } from 'node:test';
import { generateOwnedRuntimeRelease, REQUIRED_RUNTIME_TARGETS } from '../tools/generate-owned-runtime-release.mjs';

const sourceRevision = '0123456789abcdef0123456789abcdef01234567';
const patchBytes = Buffer.from('fixture pinned recipe patch');
const patchSha256 = sha256(patchBytes);
const lockSha256 = 'b'.repeat(64);
const releaseVersion = '9.8.7';
const compatibilityVersion = '2.0.32';
const runtimeVersion = '0.0.0-ctg.2.0.32';
let temp;
let root;
let assetsDirectory;

before(async () => {
  temp = await mkdtemp(path.join(os.tmpdir(), 'ctg-owned-runtime-manifest-test-'));
  root = path.join(temp, 'repo');
  assetsDirectory = path.join(temp, 'assets');
  await mkdir(path.join(root, 'script/ctg'), { recursive: true });
  await mkdir(path.join(root, 'docs/patches'), { recursive: true });
  await mkdir(assetsDirectory, { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: releaseVersion }));
  await writeFile(path.join(root, 'script/ctg/build-owned-runtime.sh'), [
    `EXPECTED_SOURCE="${sourceRevision}"`,
    `EXPECTED_LOCK="${lockSha256}"`,
    `EXPECTED_PATCH="${patchSha256}"`,
    'patch_file="$ROOT/docs/patches/opencode-v2.0.32-session-ui-combined-v1.patch"',
    `OPENCODE_VERSION=${runtimeVersion} OPENCODE_CHANNEL=ctg.${compatibilityVersion}`,
    'bun run script/build.ts',
  ].join('\n'));
  await writeFile(path.join(root, 'docs/patches/opencode-v2.0.32-session-ui-combined-v1.patch'), patchBytes);
  await writeFile(path.join(root, 'docs/patches/opencode-v2.0.32-session-ui.patch'), Buffer.from('preserved base patch'));
  await createAllFixtures();
});

after(async () => rm(temp, { recursive: true, force: true }));

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function octal(value, width) { return Buffer.from(`${value.toString(8).padStart(width - 1, '0')}\0`); }
function tarEntry(name, data, type = '0', mode = 0o644) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  octal(mode, 8).copy(header, 100);
  octal(0, 8).copy(header, 108); octal(0, 8).copy(header, 116);
  octal(data.length, 12).copy(header, 124); octal(0, 12).copy(header, 136);
  header.fill(32, 148, 156); header[156] = type.charCodeAt(0);
  header.write('ustar\0', 257, 6); header.write('00', 263, 2);
  let checksum = 0; for (const byte of header) checksum += byte;
  octal(checksum, 8).copy(header, 148);
  return Buffer.concat([header, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}

async function createAllFixtures() {
  for (const [key, [platform, arch, archiveName, executablePath]] of Object.entries(REQUIRED_RUNTIME_TARGETS)) {
    const binary = Buffer.from(`fixture executable for ${key}\n`);
    const inner = Buffer.from(JSON.stringify({
      owner: 'Carthagent', sourceRepository: 'https://github.com/anomalyco/opencode',
      sourceRevision, lockSha256, patchSha256, compatibilityVersion, runtimeVersion,
      channel: `ctg.${compatibilityVersion}`, platform: `${platform}-${arch}`, webUI: false,
    }));
    const packageJson = Buffer.from(JSON.stringify({
      name: `@opencode/cli-${key}`, version: runtimeVersion, os: [platform === 'windows' ? 'win32' : platform], cpu: [arch],
    }));
    const license = Buffer.from('MIT License\n');
    const sums = Buffer.from(`${sha256(binary)}  ${executablePath}\n`);
    const parentDirectories = executablePath.split('/').slice(0, -1).reduce((all, _part, index, parts) => {
      const current = parts.slice(0, index + 1).join('/');
      all.push(tarEntry(`${current}/`, Buffer.alloc(0), '5'));
      return all;
    }, []);
    const archive = gzipSync(Buffer.concat([
      tarEntry('./', Buffer.alloc(0), '5'),
      ...parentDirectories,
      tarEntry(executablePath, binary, '0', 0o755),
      tarEntry(`cli-${key}/package.json`, packageJson),
      tarEntry('LICENSE', license),
      tarEntry('SHA256SUMS', sums),
      tarEntry('ctg-runtime.json', inner),
      Buffer.alloc(1024),
    ]));
    await writeFile(path.join(assetsDirectory, archiveName), archive);
    await writeFile(path.join(assetsDirectory, `${archiveName}.build.json`), JSON.stringify({
      version: 1, target: key, platform, arch, sourceRevision, lockSha256, patchSha256,
      compatibilityVersion, runtimeVersion, executableSha256: sha256(binary),
    }));
  }
}

test('generates exact five-platform manifest only after production USTAR acquisition verifies bytes and provenance', async () => {
  await rm(path.join(temp, 'runtime-release.json.candidate'), { force: true });
  const manifest = await generateOwnedRuntimeRelease({ releaseVersion, assetsDirectory, repoRoot: root });
  assert.deepEqual(JSON.parse(await readFile(path.join(temp, 'runtime-release.json.candidate'), 'utf8')), manifest);
  await assert.rejects(
    generateOwnedRuntimeRelease({ releaseVersion, assetsDirectory, repoRoot: root }),
    /EEXIST/,
    'a second run must not silently replace a reviewed candidate',
  );
  assert.deepEqual(Object.keys(manifest), [
    'version', 'releaseVersion', 'compatibilityVersion', 'runtimeVersion', 'sourceRevision', 'patchSha256', 'lockSha256', 'assets',
  ]);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.releaseVersion, releaseVersion);
  assert.equal(manifest.compatibilityVersion, compatibilityVersion);
  assert.equal(manifest.runtimeVersion, runtimeVersion);
  assert.equal(manifest.sourceRevision, sourceRevision);
  assert.equal(manifest.patchSha256, patchSha256);
  assert.equal(manifest.lockSha256, lockSha256);
  assert.deepEqual(Object.keys(manifest.assets).sort(), Object.keys(REQUIRED_RUNTIME_TARGETS).sort());
  for (const [key, [, , name]] of Object.entries(REQUIRED_RUNTIME_TARGETS)) {
    assert.deepEqual(Object.keys(manifest.assets[key]).sort(), ['archiveSha256', 'executableSha256', 'name']);
    assert.equal(manifest.assets[key].name, name);
    assert.match(manifest.assets[key].archiveSha256, /^[a-f0-9]{64}$/);
    assert.match(manifest.assets[key].executableSha256, /^[a-f0-9]{64}$/);
    assert.equal(manifest.assets[key].archiveSha256, sha256(await readFile(path.join(assetsDirectory, name))));
  }
});

test('rejects missing, extra, malformed, and wrong-target build outputs', async (t) => {
  await t.test('missing platform output', async () => {
    const missing = path.join(temp, 'missing');
    await mkdir(missing);
    for (const name of await readdir(assetsDirectory)) {
      if (name.startsWith('opencode-linux-x64')) continue;
      await writeFile(path.join(missing, name), await readFile(path.join(assetsDirectory, name)));
    }
    await assert.rejects(generateOwnedRuntimeRelease({ releaseVersion, assetsDirectory: missing, repoRoot: root }), /contain exactly/);
  });
  await t.test('extra asset', async () => {
    const extra = path.join(temp, 'extra');
    await mkdir(extra);
    for (const name of await readdir(assetsDirectory)) {
      await writeFile(path.join(extra, name), await readFile(path.join(assetsDirectory, name)));
    }
    await writeFile(path.join(extra, 'unexpected.tar.gz'), 'extra');
    await assert.rejects(generateOwnedRuntimeRelease({ releaseVersion, assetsDirectory: extra, repoRoot: root }), /contain exactly/);
  });
  await t.test('record with changed target provenance', async () => {
    const recordPath = path.join(assetsDirectory, 'opencode-linux-x64.tar.gz.build.json');
    const original = await readFile(recordPath);
    const changed = JSON.parse(original);
    changed.sourceRevision = 'f'.repeat(40);
    await writeFile(recordPath, JSON.stringify(changed));
    try {
      await assert.rejects(generateOwnedRuntimeRelease({ releaseVersion, assetsDirectory, repoRoot: root }), /Build record for linux-x64/);
    } finally { await writeFile(recordPath, original); }
  });
});

test('rejects record executable digest that does not describe archived executable bytes', async () => {
  const recordPath = path.join(assetsDirectory, 'opencode-windows-x64.tar.gz.build.json');
  const original = await readFile(recordPath);
  const changed = JSON.parse(original);
  changed.executableSha256 = 'e'.repeat(64);
  await writeFile(recordPath, JSON.stringify(changed));
  try {
    await assert.rejects(generateOwnedRuntimeRelease({ releaseVersion, assetsDirectory, repoRoot: root }), /SHA256SUMS executable hash does not match pinned release metadata/);
  } finally { await writeFile(recordPath, original); }
});

test('rejects a safe but unexpected archive member while retaining the actual build output files', async () => {
  const archiveName = 'opencode-linux-x64.tar.gz';
  const archivePath = path.join(assetsDirectory, archiveName);
  const original = await readFile(archivePath);
  const key = 'linux-x64';
  const executablePath = `cli-${key}/bin/opencode`;
  const binary = Buffer.from(`fixture executable for ${key}\n`);
  const packageJson = Buffer.from(JSON.stringify({
    name: '@opencode/cli-linux-x64', version: runtimeVersion, os: ['linux'], cpu: ['x64'],
  }));
  const inner = Buffer.from(JSON.stringify({
    owner: 'Carthagent', sourceRepository: 'https://github.com/anomalyco/opencode',
    sourceRevision, lockSha256, patchSha256, compatibilityVersion, runtimeVersion,
    channel: `ctg.${compatibilityVersion}`, platform: 'linux-x64', webUI: false,
  }));
  const makeEntry = (extra = []) => gzipSync(Buffer.concat([
    tarEntry('./', Buffer.alloc(0), '5'),
    tarEntry('./cli-linux-x64/', Buffer.alloc(0), '5'),
    tarEntry('./cli-linux-x64/bin/', Buffer.alloc(0), '5'),
    tarEntry(executablePath, binary, '0', 0o755),
    tarEntry('cli-linux-x64/package.json', packageJson),
    tarEntry('LICENSE', Buffer.from('MIT License\n')),
    tarEntry('SHA256SUMS', Buffer.from(`${sha256(binary)}  ${executablePath}\n`)),
    tarEntry('ctg-runtime.json', inner),
    ...extra,
    Buffer.alloc(1024),
  ]));
  await writeFile(archivePath, makeEntry([tarEntry('extra/payload', Buffer.from('unexpected'))]));
  try {
    await assert.rejects(
      generateOwnedRuntimeRelease({ releaseVersion, assetsDirectory, repoRoot: root }),
      /unexpected directory: extra/,
    );
  } finally { await writeFile(archivePath, original); }
  // Restored valid input includes the genuine runtime LICENSE and target package metadata.
  const manifest = await generateOwnedRuntimeRelease({
    releaseVersion, assetsDirectory, repoRoot: root,
    outputPath: path.join(temp, 'allowed-members.candidate'),
  });
  assert.equal(manifest.assets['linux-x64'].name, archiveName);
});

test('matches pinned OpenCode build.ts Windows package metadata (win32 OS, windows target name)', async () => {
  const archivePath = path.join(assetsDirectory, 'opencode-windows-x64.tar.gz');
  const original = await readFile(archivePath);
  const expectedExecutablePath = 'cli-windows-x64/bin/opencode.exe';
  const binary = Buffer.from('fixture executable for windows-x64\n');
  const entries = [
    tarEntry('./', Buffer.alloc(0), '5'),
    tarEntry('./cli-windows-x64/', Buffer.alloc(0), '5'),
    tarEntry('./cli-windows-x64/bin/', Buffer.alloc(0), '5'),
    tarEntry(expectedExecutablePath, binary, '0', 0o755),
    tarEntry('cli-windows-x64/package.json', Buffer.from(JSON.stringify({
      name: '@opencode/cli-windows-x64', version: runtimeVersion, os: ['win32'], cpu: ['x64'],
    }))),
    tarEntry('LICENSE', Buffer.from('MIT License\n')),
    tarEntry('SHA256SUMS', Buffer.from(`${sha256(binary)}  ${expectedExecutablePath}\n`)),
    tarEntry('ctg-runtime.json', Buffer.from(JSON.stringify({
      owner: 'Carthagent', sourceRepository: 'https://github.com/anomalyco/opencode',
      sourceRevision, lockSha256, patchSha256, compatibilityVersion, runtimeVersion,
      channel: `ctg.${compatibilityVersion}`, platform: 'windows-x64', webUI: false,
    }))),
    Buffer.alloc(1024),
  ];
  await writeFile(archivePath, gzipSync(Buffer.concat(entries)));
  try {
    const manifest = await generateOwnedRuntimeRelease({
      releaseVersion, assetsDirectory, repoRoot: root,
      outputPath: path.join(temp, 'windows-metadata.candidate'),
    });
    assert.equal(manifest.assets['windows-x64'].executableSha256, sha256(binary));
  } finally { await writeFile(archivePath, original); }
});

test('rejects npm Windows OS metadata that does not match pinned build.ts', async () => {
  const archivePath = path.join(assetsDirectory, 'opencode-windows-x64.tar.gz');
  const original = await readFile(archivePath);
  const expectedExecutablePath = 'cli-windows-x64/bin/opencode.exe';
  const binary = Buffer.from('fixture executable for windows-x64\n');
  await writeFile(archivePath, gzipSync(Buffer.concat([
    tarEntry('./', Buffer.alloc(0), '5'),
    tarEntry('./cli-windows-x64/', Buffer.alloc(0), '5'),
    tarEntry('./cli-windows-x64/bin/', Buffer.alloc(0), '5'),
    tarEntry(expectedExecutablePath, binary, '0', 0o755),
    tarEntry('cli-windows-x64/package.json', Buffer.from(JSON.stringify({
      name: '@opencode/cli-windows-x64', version: runtimeVersion, os: ['windows'], cpu: ['x64'],
    }))),
    tarEntry('LICENSE', Buffer.from('MIT License\n')),
    tarEntry('SHA256SUMS', Buffer.from(`${sha256(binary)}  ${expectedExecutablePath}\n`)),
    tarEntry('ctg-runtime.json', Buffer.from(JSON.stringify({
      owner: 'Carthagent', sourceRepository: 'https://github.com/anomalyco/opencode',
      sourceRevision, lockSha256, patchSha256, compatibilityVersion, runtimeVersion,
      channel: `ctg.${compatibilityVersion}`, platform: 'windows-x64', webUI: false,
    }))),
    Buffer.alloc(1024),
  ])));
  try {
    await assert.rejects(
      generateOwnedRuntimeRelease({
        releaseVersion, assetsDirectory, repoRoot: root,
        outputPath: path.join(temp, 'windows-wrong-os.candidate'),
      }),
      /package metadata does not match windows-x64/,
    );
  } finally { await writeFile(archivePath, original); }
});

test('rejects a noncanonical release version and a recipe/patch mismatch', async (t) => {
  await t.test('v-prefixed release version', async () => {
    await assert.rejects(generateOwnedRuntimeRelease({ releaseVersion: 'v9.8.7', assetsDirectory, repoRoot: root }), /without a v prefix/);
  });
  await t.test('patch bytes changed after recipe pin', async () => {
    const patchPath = path.join(root, 'docs/patches/opencode-v2.0.32-session-ui-combined-v1.patch');
    const original = await readFile(patchPath);
    await writeFile(patchPath, Buffer.concat([original, Buffer.from('changed')]));
    try {
      await assert.rejects(generateOwnedRuntimeRelease({ releaseVersion, assetsDirectory, repoRoot: root }), /patch bytes do not match/);
    } finally { await writeFile(patchPath, original); }
  });
  await t.test('missing recipe-selected combined patch fails rather than falling back to preserved base patch', async () => {
    const selectedPath = path.join(root, 'docs/patches/opencode-v2.0.32-session-ui-combined-v1.patch');
    const original = await readFile(selectedPath);
    await rm(selectedPath);
    try {
      await assert.rejects(generateOwnedRuntimeRelease({
        releaseVersion, assetsDirectory, repoRoot: root,
        outputPath: path.join(temp, 'missing-selected-patch.candidate'),
      }), /ENOENT/);
    } finally { await writeFile(selectedPath, original); }
  });
  await t.test('legacy recipe patch literal remains supported', async () => {
    const recipePath = path.join(root, 'script/ctg/build-owned-runtime.sh');
    const original = await readFile(recipePath, 'utf8');
    await writeFile(recipePath, original.replace(
      'opencode-v2.0.32-session-ui-combined-v1.patch',
      'opencode-v2.0.32-session-ui.patch',
    ));
    // Keep the legacy selected patch authoritative and digest-pinned.
    const legacyPatchPath = path.join(root, 'docs/patches/opencode-v2.0.32-session-ui.patch');
    const legacyOriginal = await readFile(legacyPatchPath);
    await writeFile(legacyPatchPath, patchBytes);
    try {
      const manifest = await generateOwnedRuntimeRelease({
        releaseVersion, assetsDirectory, repoRoot: root,
        outputPath: path.join(temp, 'legacy-recipe.candidate'),
      });
      assert.equal(manifest.patchSha256, patchSha256);
    } finally {
      await writeFile(recipePath, original);
      await writeFile(legacyPatchPath, legacyOriginal);
    }
  });
  await t.test('rejects noncanonical or escaping patch paths without evaluating recipe text', async () => {
    const recipePath = path.join(root, 'script/ctg/build-owned-runtime.sh');
    const original = await readFile(recipePath, 'utf8');
    await writeFile(recipePath, original.replace(
      'patch_file="$ROOT/docs/patches/opencode-v2.0.32-session-ui-combined-v1.patch"',
      'patch_file="$ROOT/docs/patches/../patches/opencode-v2.0.32-session-ui.patch"',
    ));
    try {
      await assert.rejects(generateOwnedRuntimeRelease({
        releaseVersion, assetsDirectory, repoRoot: root,
        outputPath: path.join(temp, 'escaping-patch.candidate'),
      }), /canonical docs\/patches-relative path/);
    } finally { await writeFile(recipePath, original); }
  });
});
