import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { npmUpdateArgv, runNativeUpdate } from '../lib/opencode/update.mjs';

const release = { version: '1.2.0', tag: 'v1.2.0', installSpec: 'github:B-icy/Carthagent#v1.2.0', minNode: '22.19.0' };
const noopIo = { log() {}, error() {} };

function tempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ctg-native-update-'));
  return Promise.resolve().then(() => fn(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

test('check-only resolves availability but does not inspect or install anything', async () => {
  let commands = 0;
  const result = await runNativeUpdate({
    args: ['--check'], io: noopIo, root: '/does/not/matter', currentVersion: '1.0.0',
    fetchLatestRelease: async () => ({ release }),
    detectInstallMethod: () => { throw new Error('should not inspect install'); },
    runCommand: async () => { commands++; },
  });
  assert.equal(result.status, 'available');
  assert.equal(commands, 0);
});

test('rejects an invalid canonical tag before invoking an installer', async () => {
  let calls = 0;
  await assert.rejects(runNativeUpdate({
    io: noopIo, currentVersion: '1.0.0', fetchLatestRelease: async () => ({ release: { ...release, tag: 'v1.2.0; npm evil' } }),
    detectInstallMethod: () => 'npm', runCommand: async () => { calls++; },
  }), /invalid or mismatched/);
  assert.equal(calls, 0);
});

test('force remains bound to the validated version and command', async () => {
  const calls = [];
  await runNativeUpdate({
    args: ['--force'], io: noopIo, currentVersion: '1.3.0',
    fetchLatestRelease: async () => ({ release }), detectInstallMethod: () => 'npm',
    runCommand: async (argv, options) => { calls.push({ argv, options }); return { code: 0, output: '' }; },
  });
  assert.deepEqual(calls[0].argv, ['npm', 'install', '-g', '--install-links=true', release.installSpec]);
});

test('clone update refuses dirty changes and preserves the dirty file', () => tempDir(async base => {
  const remote = join(base, 'remote.git');
  const seed = join(base, 'seed');
  const clone = join(base, 'clone');
  mkdirSync(seed);
  git(['init', '--bare', remote], base);
  git(['init', '-b', 'main'], seed);
  git(['config', 'user.email', 'test@example.invalid'], seed);
  git(['config', 'user.name', 'Test'], seed);
  writeFileSync(join(seed, 'tracked.txt'), 'base\n');
  git(['add', 'tracked.txt'], seed);
  git(['commit', '-m', 'base'], seed);
  git(['tag', 'v1.2.0'], seed);
  git(['remote', 'add', 'origin', remote], seed);
  git(['push', 'origin', 'main', '--tags'], seed);
  git(['symbolic-ref', 'HEAD', 'refs/heads/main'], remote);
  git(['clone', remote, clone], base);
  git(['config', 'user.email', 'test@example.invalid'], clone);
  git(['config', 'user.name', 'Test'], clone);
  writeFileSync(join(clone, 'untracked-user-data.txt'), 'user work\n');
  let commands = 0;
  await assert.rejects(runNativeUpdate({
    io: noopIo, root: clone, currentVersion: '1.0.0', fetchLatestRelease: async () => ({ release }),
    detectInstallMethod: () => 'clone', runCommand: async (...args) => { commands++; return (await import('../lib/opencode/update.mjs')).runUpdateCommand(...args); },
  }), /uncommitted changes/);
  assert.equal(commands, 1);
  assert.equal(readFileSync(join(clone, 'untracked-user-data.txt'), 'utf8'), 'user work\n');
}));

test('clone update fetches without force and checks out the exact release tag', () => tempDir(async base => {
  const remote = join(base, 'remote.git');
  const seed = join(base, 'seed');
  const clone = join(base, 'clone');
  mkdirSync(seed);
  git(['init', '--bare', remote], base);
  git(['init', '-b', 'main'], seed);
  git(['config', 'user.email', 'test@example.invalid'], seed);
  git(['config', 'user.name', 'Test'], seed);
  writeFileSync(join(seed, 'tracked.txt'), 'base\n');
  git(['add', 'tracked.txt'], seed);
  git(['commit', '-m', 'base'], seed);
  git(['tag', 'v1.2.0'], seed);
  git(['remote', 'add', 'origin', remote], seed);
  git(['push', 'origin', 'main', '--tags'], seed);
  git(['clone', remote, clone], base);
  const commands = [];
  const result = await runNativeUpdate({
    io: noopIo, root: clone, currentVersion: '1.0.0', fetchLatestRelease: async () => ({ release }),
    detectInstallMethod: () => 'clone', runCommand: async (argv, options) => {
      commands.push(argv);
      if (argv[0] === 'git') return (await import('../lib/opencode/update.mjs')).runUpdateCommand(argv, options);
      return { code: 0, output: '' };
    },
  });
  assert.equal(result.status, 'updated');
  assert.deepEqual(commands[0], ['git', 'status', '--porcelain']);
  assert.deepEqual(commands[1].slice(0, 4), ['git', 'fetch', '--no-tags', 'origin']);
  assert.equal(commands[1][4].startsWith('refs/tags/v1.2.0:'), true);
  assert.deepEqual(commands[2].slice(0, 3), ['git', 'rev-parse', '--verify']);
  assert.deepEqual(commands[3].slice(0, 3), ['git', 'checkout', '--detach']);
  assert.equal(git(['describe', '--tags', '--exact-match'], clone), 'v1.2.0');
  assert.equal(git(['status', '--porcelain'], clone), '');
}));

test('clone update uses the origin tag commit when a conflicting local tag exists and preserves that tag', () => tempDir(async base => {
  const remote = join(base, 'remote.git');
  const seed = join(base, 'seed');
  const clone = join(base, 'clone');
  mkdirSync(seed);
  git(['init', '--bare', remote], base);
  git(['init', '-b', 'main'], seed);
  git(['config', 'user.email', 'test@example.invalid'], seed);
  git(['config', 'user.name', 'Test'], seed);
  writeFileSync(join(seed, 'tracked.txt'), 'remote release\n');
  git(['add', 'tracked.txt'], seed);
  git(['commit', '-m', 'release'], seed);
  const remoteCommit = git(['rev-parse', 'HEAD'], seed);
  git(['tag', 'v1.2.0'], seed);
  git(['remote', 'add', 'origin', remote], seed);
  git(['push', 'origin', 'main', '--tags'], seed);
  git(['symbolic-ref', 'HEAD', 'refs/heads/main'], remote);
  git(['clone', remote, clone], base);
  git(['config', 'user.email', 'test@example.invalid'], clone);
  git(['config', 'user.name', 'Test'], clone);
  writeFileSync(join(clone, 'other.txt'), 'local tag target\n');
  git(['add', 'other.txt'], clone);
  git(['commit', '-m', 'local tag target'], clone);
  const localTagCommit = git(['rev-parse', 'HEAD'], clone);
  git(['tag', '-f', 'v1.2.0', localTagCommit], clone);
  const calls = [];
  await runNativeUpdate({
    io: noopIo, root: clone, currentVersion: '1.0.0', fetchLatestRelease: async () => ({ release }),
    detectInstallMethod: () => 'clone', runCommand: async (argv, options) => {
      calls.push(argv);
      return argv[0] === 'git' ? (await import('../lib/opencode/update.mjs')).runUpdateCommand(argv, options) : { code: 0, output: '' };
    },
  });
  assert.equal(git(['rev-parse', 'HEAD'], clone), remoteCommit);
  assert.equal(git(['rev-parse', 'refs/tags/v1.2.0^{commit}'], clone), localTagCommit);
  assert.equal(calls.some(argv => argv[0] === 'git' && argv[1] === 'fetch' && argv.includes('--force')), false);
  assert.equal(calls.some(argv => argv[0] === 'git' && argv.some(arg => arg.startsWith('refs/tags/v1.2.0:'))), true);
}));

test('clone update rejects an origin-missing release tag without checking out a local tag', () => tempDir(async base => {
  const remote = join(base, 'remote.git');
  const seed = join(base, 'seed');
  const clone = join(base, 'clone');
  mkdirSync(seed);
  git(['init', '--bare', remote], base);
  git(['init', '-b', 'main'], seed);
  git(['config', 'user.email', 'test@example.invalid'], seed);
  git(['config', 'user.name', 'Test'], seed);
  writeFileSync(join(seed, 'tracked.txt'), 'remote main\n');
  git(['add', 'tracked.txt'], seed);
  git(['commit', '-m', 'main'], seed);
  git(['remote', 'add', 'origin', remote], seed);
  git(['push', 'origin', 'main'], seed);
  git(['symbolic-ref', 'HEAD', 'refs/heads/main'], remote);
  git(['clone', remote, clone], base);
  git(['tag', 'v1.2.0'], clone);
  const head = git(['rev-parse', 'HEAD'], clone);
  const calls = [];
  await assert.rejects(runNativeUpdate({
    io: noopIo, root: clone, currentVersion: '1.0.0', fetchLatestRelease: async () => ({ release }),
    detectInstallMethod: () => 'clone', runCommand: async (argv, options) => {
      calls.push(argv);
      return argv[0] === 'git' ? (await import('../lib/opencode/update.mjs')).runUpdateCommand(argv, options) : { code: 0, output: '' };
    },
  }), /git fetch v1\.2\.0 failed/);
  assert.equal(git(['rev-parse', 'HEAD'], clone), head);
  assert.equal(calls.some(argv => argv[0] === 'npm'), false);
}));

test('failed update command stops later steps and includes bounded failure output', async () => {
  const calls = [];
  await assert.rejects(runNativeUpdate({
    io: noopIo, currentVersion: '1.0.0', fetchLatestRelease: async () => ({ release }),
    detectInstallMethod: () => 'npm', runCommand: async argv => { calls.push(argv); return { code: 2, output: 'npm failure' }; },
  }), /npm install .* failed:\nnpm failure/);
  assert.equal(calls.length, 1);
});

test('zero exit code with timeout or cancellation is failure and prevents later steps', async () => {
  for (const result of [{ code: 0, output: '', timedOut: true }, { code: 0, output: '', cancelled: true }]) {
    const calls = [];
    await assert.rejects(runNativeUpdate({
      io: noopIo, currentVersion: '1.0.0', fetchLatestRelease: async () => ({ release }),
      detectInstallMethod: () => 'npm', runCommand: async argv => { calls.push(argv); return result; },
    }), result.timedOut ? /timed out/ : /cancelled/);
    assert.equal(calls.length, 1);
  }
});

test('a successful code with a timed-out global-install retry remains a failure', async () => {
  const calls = [];
  let attempt = 0;
  await assert.rejects(runNativeUpdate({
    io: noopIo, currentVersion: '1.0.0', fetchLatestRelease: async () => ({ release }),
    detectInstallMethod: () => 'npm', cleanStaleInstall: () => ['/temporary/stale'],
    runCommand: async argv => {
      calls.push(argv);
      if (argv[0] === 'npm' && argv[1] === 'install') return ++attempt === 1
        ? { code: 1, output: 'EEXIST' }
        : { code: 0, output: '', timedOut: true };
      return { code: 0, output: '/global/node_modules' };
    },
  }), /timed out/);
  assert.equal(attempt, 2);
});

test('Windows npm command uses cmd.exe argv without a shell string', () => {
  assert.deepEqual(npmUpdateArgv(['install', '-g', 'github:B-icy/Carthagent#v1.2.0'], 'win32'), [
    'cmd.exe', '/d', '/s', '/c', 'npm', 'install', '-g', 'github:B-icy/Carthagent#v1.2.0',
  ]);
});
