import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const helper = resolve(import.meta.dirname, '../tools/native-owned-runtime-env.sh');

async function makeOwnedRuntime(t) {
  const root = await mkdtemp(join(tmpdir(), 'ctg-owned-env-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const owned = join(root, 'owned');
  const binary = join(owned, 'cli-linux-x64', 'bin', 'opencode');
  const manifest = join(root, 'runtime-release.json');
  const marker = join(root, 'binary-executed');
  await import('node:fs/promises').then(fs => fs.mkdir(join(owned, 'cli-linux-x64', 'bin'), { recursive: true }));
  const sourceRevision = 'a'.repeat(40);
  const patchSha256 = 'b'.repeat(64);
  const lockSha256 = 'c'.repeat(64);
  const runtimeVersion = '0.0.0-ctg.2.0.32';
  await writeFile(binary, `#!/bin/sh\nif [ "$1" = "--version" ]; then printf 'opencode v${runtimeVersion}\\n'; printf ran > '${marker}'; fi\n`);
  await chmod(binary, 0o755);
  const digest = createHash('sha256').update(await readFile(binary)).digest('hex');
  const provenance = {
    owner: 'Carthagent', sourceRepository: 'https://github.com/anomalyco/opencode', sourceRevision,
    patchSha256, lockSha256, compatibilityVersion: '2.0.32', runtimeVersion,
    channel: 'ctg.2.0.32', platform: 'linux-x64', webUI: false,
  };
  await writeFile(join(owned, 'ctg-runtime.json'), JSON.stringify(provenance));
  await writeFile(manifest, JSON.stringify({
    version: 1, releaseVersion: '1.2.3', compatibilityVersion: '2.0.32', runtimeVersion,
    sourceRevision, patchSha256, lockSha256,
    assets: { 'linux-x64': { name: 'opencode-linux-x64.tar.gz', archiveSha256: 'd'.repeat(64), executableSha256: digest } },
  }));
  return { root, owned, binary, manifest, marker, digest };
}

test('shell child verifies owned runtime before passing trusted selectors to fixture seeder', async t => {
  const fixture = await makeOwnedRuntime(t);
  const result = execFileSync('bash', ['-c', `
    source "$1"
    CTG_OPENCODE_BIN="$2" configure_native_owned_runtime "$2" "$3" "$4"
    test -z "\${CTG_OPENCODE_BIN+x}"
    sh -c 'printf "selectors:%s\\n%s\\n" "$CTG_OWNED_OPENCODE_RUNTIME" "$CTG_TEST_RUNTIME_RELEASE_MANIFEST"'
  `, 'test', helper, fixture.binary, fixture.owned, fixture.manifest], { encoding: 'utf8' }).trim().split('\n');
  const selectors = result.find(line => line.startsWith('selectors:'));
  assert.equal(selectors?.slice('selectors:'.length), resolve(fixture.owned));
  assert.ok(result.includes(resolve(fixture.manifest)));
  assert.equal(await readFile(fixture.marker, 'utf8'), 'ran', 'identity helper checked exact --version after hashing');
});

test('wrong expected hash prevents version execution and seeder launch', async t => {
  const fixture = await makeOwnedRuntime(t);
  const seederMarker = join(fixture.root, 'seeder-launched');
  const child = await import('node:child_process').then(({ spawnSync }) => spawnSync('bash', ['-c', `
    source "$1"
    configure_native_owned_runtime "$2" "$3" "$4" && touch "$5"
  `, 'test', helper, fixture.binary, fixture.owned, fixture.manifest, seederMarker], {
    encoding: 'utf8', env: { ...process.env, CTG_TEST_RUNTIME_SHA256: 'e'.repeat(64) },
  }));
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /binary SHA-256 mismatch/);
  await assert.rejects(readFile(fixture.marker), { code: 'ENOENT' });
  await assert.rejects(readFile(seederMarker), { code: 'ENOENT' });
});

test('binary outside the declared owned root is rejected before version execution', async t => {
  const fixture = await makeOwnedRuntime(t);
  const outside = join(fixture.root, 'outside-opencode');
  await writeFile(outside, await readFile(fixture.binary));
  await chmod(outside, 0o755);
  const child = await import('node:child_process').then(({ spawnSync }) => spawnSync('bash', ['-c', `
    source "$1"
    configure_native_owned_runtime "$2" "$3" "$4"
  `, 'test', helper, outside, fixture.owned, fixture.manifest], { encoding: 'utf8' }));
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /must be/);
  await assert.rejects(readFile(fixture.marker), { code: 'ENOENT' });
});

test('readiness and paired wrappers use the shared owned-runtime environment handoff', async () => {
  const readiness = await import('node:fs/promises').then(fs => fs.readFile(resolve(import.meta.dirname, '../tools/test-native-terminal-readiness.sh'), 'utf8'));
  const paired = await import('node:fs/promises').then(fs => fs.readFile(resolve(import.meta.dirname, '../tools/run-native-terminal-paired.sh'), 'utf8'));
  assert.match(readiness, /source "\$harness_worktree\/tools\/native-owned-runtime-env\.sh"/);
  assert.match(readiness, /configure_native_owned_runtime "\$binary" "\$owned_root" "\$release_manifest"/);
  assert.match(paired, /source "\$repo_root\/tools\/native-owned-runtime-env\.sh"/);
  assert.match(paired, /configure_native_owned_runtime "\$binary" "\$owned_root" "\$release_manifest"/);
});
