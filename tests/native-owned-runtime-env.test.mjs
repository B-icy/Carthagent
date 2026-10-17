import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const helper = resolve(import.meta.dirname, '../tools/native-owned-runtime-env.sh');

test('fixture seeder receives owned-root and trusted-manifest selectors, not a binary override', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ctg-owned-env-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const owned = join(root, 'owned');
  const binary = join(owned, 'cli-linux-x64', 'bin', 'opencode');
  const manifest = join(root, 'runtime-release.json');
  await import('node:fs/promises').then(fs => fs.mkdir(join(owned, 'cli-linux-x64', 'bin'), { recursive: true }));
  await writeFile(binary, '#!/bin/sh\nexit 0\n');
  await chmod(binary, 0o755);
  await writeFile(manifest, '{}\n');
  const result = execFileSync('bash', ['-c', `
    source "$1"
    CTG_OPENCODE_BIN="$2" configure_native_owned_runtime "$2" "$3" "$4"
    test -z "\${CTG_OPENCODE_BIN+x}"
    printf '%s\\n%s\\n' "$CTG_OWNED_OPENCODE_RUNTIME" "$CTG_TEST_RUNTIME_RELEASE_MANIFEST"
  `, 'test', helper, binary, owned, manifest], { encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(result, [resolve(owned), resolve(manifest)]);
});

test('readiness and paired wrappers use the shared owned-runtime environment handoff', async () => {
  const readiness = await import('node:fs/promises').then(fs => fs.readFile(resolve(import.meta.dirname, '../tools/test-native-terminal-readiness.sh'), 'utf8'));
  const paired = await import('node:fs/promises').then(fs => fs.readFile(resolve(import.meta.dirname, '../tools/run-native-terminal-paired.sh'), 'utf8'));
  assert.match(readiness, /source "\$harness_worktree\/tools\/native-owned-runtime-env\.sh"/);
  assert.match(readiness, /configure_native_owned_runtime "\$binary" "\$owned_root" "\$release_manifest"/);
  assert.match(paired, /source "\$repo_root\/tools\/native-owned-runtime-env\.sh"/);
  assert.match(paired, /configure_native_owned_runtime "\$binary" "\$owned_root" "\$release_manifest"/);
});
