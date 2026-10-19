#!/usr/bin/env node
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireOwnedRuntime } from '../lib/opencode/runtime-artifact.mjs';
import { readRuntimeReleaseManifest } from '../lib/opencode/runtime.mjs';
import { validateRuntimeBuildInputs } from './verify-owned-runtime-release.mjs';
import { preflightNativeTestRuntimeArtifact } from './native-runtime-identity.mjs';
import { createManualProjects } from './native-manual-projects.mjs';

const root = resolve(import.meta.dirname, '..');
export const MANUAL_RUNTIME_RUN = '39339973598';
const manifestSha256 =
  'cf885e8a63ef925a732b08d1dcfebda20d9b43fc7b0fd58d69b4ac483c905d42';

export async function prepareManualKit(
  directory,
  { assetsDirectory, packages = 128 } = {},
) {
  if (!Number.isInteger(packages) || packages < 2 || packages > 1024)
    throw Error('packages must be an integer from 2 to 1024');
  const kit = resolve(directory);
  const manifestPath = join(root, 'lib/opencode/runtime-release.json');
  const manifestBytes = await readFile(manifestPath);
  if (
    createHash('sha256').update(manifestBytes).digest('hex') !== manifestSha256
  )
    throw Error(
      'Manual candidate manifest differs from the reviewed CI candidate',
    );
  const manifest = await readRuntimeReleaseManifest(manifestPath);
  await validateRuntimeBuildInputs(manifest, root);
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const target = `${platform}-${process.arch}`;
  const asset = manifest.assets[target];
  if (!asset)
    throw Error(
      `The reviewed candidate does not support ${target}; Windows arm64 needs an x64 Node installation or WSL`,
    );
  await mkdir(kit, { mode: 0o700 });
  try {
    let assets = assetsDirectory && resolve(assetsDirectory);
    if (!assets) {
      assets = join(kit, 'download');
      const run = (...args) => {
        const result = spawnSync('gh', args, {
          encoding: 'utf8',
          timeout: 300_000,
          maxBuffer: 4_000_000,
        });
        if (result.error || result.status !== 0)
          throw Error(
            `GitHub artifact retrieval failed. Install/authenticate gh, or pass --assets <downloaded archive directory>. ${result.error?.message ?? result.stderr}`,
          );
        return result.stdout;
      };
      const info = JSON.parse(
        run('api', `repos/B-icy/Carthagent/actions/runs/${MANUAL_RUNTIME_RUN}`),
      );
      if (
        String(info.id) !== MANUAL_RUNTIME_RUN ||
        info.conclusion !== 'success' ||
        info.head_sha !== 'b7ca498f51ee6473f9d33ae59d2568e95a76f9bf' ||
        info.path !== '.github/workflows/publish-owned-opencode-runtime.yml'
      )
        throw Error('Unexpected CI runtime provenance');
      run(
        'run',
        'download',
        MANUAL_RUNTIME_RUN,
        '--repo',
        'B-icy/Carthagent',
        '--name',
        `ctg-runtime-prebuild-${target}`,
        '--dir',
        assets,
      );
    }
    const ownedRoot = await acquireOwnedRuntime({
      releaseVersion: manifest.releaseVersion,
      platform,
      arch: process.arch,
      expectedArchiveSha256: asset.archiveSha256,
      expectedExecutableSha256: asset.executableSha256,
      expectedSourceRevision: manifest.sourceRevision,
      expectedPatchSha256: manifest.patchSha256,
      expectedLockSha256: manifest.lockSha256,
      expectedCompatibilityVersion: manifest.compatibilityVersion,
      expectedRuntimeVersion: manifest.runtimeVersion,
      expectedChannel: `ctg.${manifest.compatibilityVersion}`,
      baseUrl: `https://github.com/B-icy/Carthagent/releases/download/v${manifest.releaseVersion}`,
      cacheRoot: join(kit, 'runtimes'),
      fetchImpl: async (url) => {
        if (
          decodeURIComponent(new URL(url).pathname.split('/').at(-1)) !==
          asset.name
        )
          throw Error('Unexpected runtime asset requested');
        return new Response(
          Readable.toWeb(createReadStream(join(assets, asset.name))),
        );
      },
    });
    const { identity } = await preflightNativeTestRuntimeArtifact({
      ownedRoot,
      expectedManifestPath: manifestPath,
      env: {},
    });
    const projects = await createManualProjects(join(kit, 'projects'), {
      packages,
    });
    const source = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    });
    const status = spawnSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
    });
    const record = {
      version: 1,
      createdAt: new Date().toISOString(),
      runtimeRun: MANUAL_RUNTIME_RUN,
      sourceCommit:
        source.status === 0 ? source.stdout.trim() : 'source-tarball',
      sourceDirty: status.status === 0 ? Boolean(status.stdout.trim()) : null,
      target,
      runtime: `runtimes/${manifest.releaseVersion}/${target}`,
      binarySha256: identity.binarySha256,
      manifestSha256,
      projects: projects.projects,
      packages,
    };
    await writeFile(
      join(kit, 'manual-kit.json'),
      JSON.stringify(record, null, 2) + '\n',
    );
    await writeFile(join(kit, '.gitignore'), '*\n');
    console.log(
      `Manual kit ready: ${kit}\nVerified ${target}: ${identity.binarySha256}\nOffline UI: node tools/native-manual.mjs ${JSON.stringify(kit)} tiny\nRead docs/native-manual-testing.md before --live. This is not a released/default install.`,
    );
    return record;
  } catch (error) {
    await rm(kit, { recursive: true, force: true });
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [directory, ...args] = process.argv.slice(2);
  if (!directory || args.includes('--help'))
    throw Error(
      'Usage: node tools/prepare-native-manual.mjs <new-directory> [--assets <directory>] [--packages 128]',
    );
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1];
    if (!value || !['--assets', '--packages'].includes(args[i]))
      throw Error(`Invalid option ${args[i]}`);
    if (args[i] === '--assets') options.assetsDirectory = value;
    else options.packages = Number(value);
  }
  await prepareManualKit(directory, options);
}
