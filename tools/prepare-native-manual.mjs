#!/usr/bin/env node
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireOwnedRuntime } from '../lib/opencode/runtime-artifact.mjs';
import { readManualRuntimeManifest } from './manual-runtime-manifest.mjs';
import { preflightNativeTestRuntimeArtifact } from './native-runtime-identity.mjs';
import { createManualProjects } from './native-manual-projects.mjs';

const root = resolve(import.meta.dirname, '..');

export async function prepareManualKit(
  directory,
  { assetsDirectory, packages = 128, runtimeManifest, manifestSha256: expectedManifestSha256 } = {},
) {
  if (!Number.isInteger(packages) || packages < 2 || packages > 1024)
    throw Error('packages must be an integer from 2 to 1024');
  const kit = resolve(directory);
  await mkdir(kit, { mode: 0o700 });
  try {
    const { manifest, manifestPath, manifestSha256 } = await readManualRuntimeManifest({ runtimeManifest, manifestSha256: expectedManifestSha256 });
    const platform = process.platform === 'win32' ? 'windows' : process.platform;
    const target = `${platform}-${process.arch}`;
    const asset = manifest.assets[target];
    if (!asset) throw Error(`The candidate does not support ${target}`);
    const assets = assetsDirectory && resolve(assetsDirectory);
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
      ...(assets ? { fetchImpl: async (url) => {
        if (
          decodeURIComponent(new URL(url).pathname.split('/').at(-1)) !==
          asset.name
        )
          throw Error('Unexpected runtime asset requested');
        return new Response(
          Readable.toWeb(createReadStream(join(assets, asset.name))),
        );
      } } : {}),
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
      releaseVersion: manifest.releaseVersion,
      manifestSource: runtimeManifest ? 'explicit-pinned-candidate' : 'packaged-release',
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
    const manifestArgs = runtimeManifest ? ` --manifest ${JSON.stringify(manifestPath)} --manifest-sha256 ${manifestSha256}` : '';
    console.log(
      `Manual kit ready: ${kit}\nVerified ${target}: ${identity.binarySha256}\nOffline UI: node tools/native-manual.mjs ${JSON.stringify(kit)} tiny${manifestArgs}\nRead docs/native-manual-testing.md before --live. This is not a released/default install.`,
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
      'Usage: node tools/prepare-native-manual.mjs <new-directory> [--assets <directory>] [--packages 128] [--manifest <file> --manifest-sha256 <digest>]',
    );
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1];
    if (!value || !['--assets', '--packages', '--manifest', '--manifest-sha256'].includes(args[i]))
      throw Error(`Invalid option ${args[i]}`);
    if (args[i] === '--assets') options.assetsDirectory = value;
    else if (args[i] === '--packages') options.packages = Number(value);
    else if (args[i] === '--manifest') options.runtimeManifest = value;
    else options.manifestSha256 = value;
  }
  await prepareManualKit(directory, options);
}
