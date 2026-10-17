import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, readFile, writeFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const helper = resolve(import.meta.dirname, '../tools/native-owned-runtime-env.sh');

function shellPath(path) {
  return process.platform === 'win32' ? execFileSync('cygpath', ['-u', path], { encoding: 'utf8' }).trim() : path;
}

function testBash() {
  if (process.env.CTG_TEST_BASH) return process.env.CTG_TEST_BASH;
  if (process.platform !== 'win32') return 'bash';
  return execFileSync('where.exe', ['bash.exe'], { encoding: 'utf8' }).split(/\r?\n/).find(Boolean);
}

function nativeNodePath(path) {
  return path.replaceAll('\\', '/');
}

async function writeSpawnMock(root) {
  const modulePath = nativeNodePath(join(root, 'spawn-mock.mjs'));
  const marker = nativeNodePath(join(root, 'version-spawned'));
  await writeFile(modulePath, `
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
childProcess.spawn = (binary, args) => {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => true;
  writeFileSync(${JSON.stringify(marker)}, String(binary));
  queueMicrotask(() => {
    child.stdout.end('opencode v0.0.0-ctg.2.0.32\\n');
    child.stderr.end();
    child.emit('close', 0);
  });
  return child;
};
syncBuiltinESMExports();
`);
  return { options: `--import=${pathToFileURL(modulePath).href}`, marker };
}

async function makeOwnedRuntime(t) {
  const root = await mkdtemp(join(tmpdir(), 'ctg-owned-env-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const targetPlatform = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
  const owned = join(root, 'owned');
  const binary = join(owned, `cli-${targetPlatform}`, 'bin', process.platform === 'win32' ? 'opencode.exe' : 'opencode');
  const manifest = join(root, 'runtime-release.json');
  await import('node:fs/promises').then(fs => fs.mkdir(join(owned, `cli-${targetPlatform}`, 'bin'), { recursive: true }));
  const sourceRevision = 'a'.repeat(40);
  const patchSha256 = 'b'.repeat(64);
  const lockSha256 = 'c'.repeat(64);
  const runtimeVersion = '0.0.0-ctg.2.0.32';
  await writeFile(binary, `unexecutable-mock-payload-${runtimeVersion}\n`);
  if (process.platform !== 'win32') await chmod(binary, 0o755);
  const digest = createHash('sha256').update(await readFile(binary)).digest('hex');
  const provenance = {
    owner: 'Carthagent', sourceRepository: 'https://github.com/anomalyco/opencode', sourceRevision,
    patchSha256, lockSha256, compatibilityVersion: '2.0.32', runtimeVersion,
    channel: 'ctg.2.0.32', platform: targetPlatform, webUI: false,
  };
  await writeFile(join(owned, 'ctg-runtime.json'), JSON.stringify(provenance));
  await writeFile(manifest, JSON.stringify({
    version: 1, releaseVersion: '1.2.3', compatibilityVersion: '2.0.32', runtimeVersion,
    sourceRevision, patchSha256, lockSha256,
    assets: { [targetPlatform]: { name: `opencode-${targetPlatform}.tar.gz`, archiveSha256: 'd'.repeat(64), executableSha256: digest } },
  }));
  return { root, owned, binary, manifest, digest };
}

test('shell child verifies owned runtime before passing trusted selectors to fixture seeder', async t => {
  const fixture = await makeOwnedRuntime(t);
  const spawnMock = await writeSpawnMock(fixture.root);
  const result = execFileSync(testBash(), ['-c', `
    source "$1"
    CTG_OPENCODE_BIN="$2" configure_native_owned_runtime "$2" "$3" "$4"
    test -z "\${CTG_OPENCODE_BIN+x}"
    printf 'selectors:%s\\n%s\\n' "$CTG_OWNED_OPENCODE_RUNTIME" "$CTG_TEST_RUNTIME_RELEASE_MANIFEST"
  `, 'test', shellPath(helper), shellPath(fixture.binary), shellPath(fixture.owned), shellPath(fixture.manifest)], {
    encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: spawnMock.options },
  }).trim().split('\n');
  assert.equal(result.length, 2, 'shell handoff emits only the owned-root and release-manifest selectors');
  const [selectors, reportedManifest] = result;
  assert.ok(selectors.startsWith('selectors:'), 'first output line identifies the owned-root selector');
  assert.equal(await realpath(selectors.slice('selectors:'.length)), await realpath(fixture.owned));
  assert.equal(await realpath(reportedManifest), await realpath(fixture.manifest));
  assert.equal(await realpath(await readFile(spawnMock.marker, 'utf8')), await realpath(fixture.binary), 'identity helper checked the exact owned executable with --version after hashing');
});

test('wrong expected hash prevents version execution and seeder launch', async t => {
  const fixture = await makeOwnedRuntime(t);
  const spawnMock = await writeSpawnMock(fixture.root);
  const seederMarker = join(fixture.root, 'seeder-launched');
  const child = spawnSync(testBash(), ['-c', `
    source "$1"
    configure_native_owned_runtime "$2" "$3" "$4" && touch "$5"
  `, 'test', shellPath(helper), shellPath(fixture.binary), shellPath(fixture.owned), shellPath(fixture.manifest), shellPath(seederMarker)], {
    encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: spawnMock.options, CTG_TEST_RUNTIME_SHA256: 'e'.repeat(64) },
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /binary SHA-256 mismatch/);
  await assert.rejects(readFile(spawnMock.marker), { code: 'ENOENT' });
  await assert.rejects(readFile(seederMarker), { code: 'ENOENT' });
});

test('binary outside the declared owned root is rejected before version execution', async t => {
  const fixture = await makeOwnedRuntime(t);
  const spawnMock = await writeSpawnMock(fixture.root);
  const outside = join(fixture.root, `outside-opencode${process.platform === 'win32' ? '.exe' : ''}`);
  await writeFile(outside, await readFile(fixture.binary));
  if (process.platform !== 'win32') await chmod(outside, 0o755);
  const child = spawnSync(testBash(), ['-c', `
    source "$1"
    configure_native_owned_runtime "$2" "$3" "$4"
  `, 'test', shellPath(helper), shellPath(outside), shellPath(fixture.owned), shellPath(fixture.manifest)], {
    encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: spawnMock.options },
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /must be/);
  await assert.rejects(readFile(spawnMock.marker), { code: 'ENOENT' });
});

test('readiness and paired wrappers use the shared owned-runtime environment handoff', async () => {
  const readiness = await import('node:fs/promises').then(fs => fs.readFile(resolve(import.meta.dirname, '../tools/test-native-terminal-readiness.sh'), 'utf8'));
  const paired = await import('node:fs/promises').then(fs => fs.readFile(resolve(import.meta.dirname, '../tools/run-native-terminal-paired.sh'), 'utf8'));
  assert.match(readiness, /source "\$harness_worktree\/tools\/native-owned-runtime-env\.sh"/);
  assert.match(readiness, /configure_native_owned_runtime "\$binary" "\$owned_root" "\$release_manifest"/);
  assert.match(paired, /source "\$repo_root\/tools\/native-owned-runtime-env\.sh"/);
  assert.match(paired, /configure_native_owned_runtime "\$binary" "\$owned_root" "\$release_manifest"/);
});
