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
    platform: 'linux',
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
  writeFileSync(join(clone, 'tracked.txt'), 'user modification\n');
  writeFileSync(join(clone, 'untracked-user-data.txt'), 'user data\n');
  let commands = 0;
  await assert.rejects(runNativeUpdate({
    io: noopIo, root: clone, currentVersion: '1.0.0', fetchLatestRelease: async () => ({ release }),
    detectInstallMethod: () => 'clone', runCommand: async (...args) => { commands++; return (await import('../lib/opencode/update.mjs')).runUpdateCommand(...args); },
  }), /uncommitted changes/);
  assert.equal(commands, 1);
  assert.equal(readFileSync(join(clone, 'tracked.txt'), 'utf8'), 'user modification\n');
  assert.equal(readFileSync(join(clone, 'untracked-user-data.txt'), 'utf8'), 'user data\n');
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
  assert.equal(calls.every(argv => argv[0] === 'git'), true);
}));

test('clone update still removes its private ref after fetch cancellation', async () => {
  const controller = new AbortController();
  const calls = [];
  await assert.rejects(runNativeUpdate({
    io: noopIo, root: '/fixture/clone', currentVersion: '1.0.0', signal: controller.signal,
    fetchLatestRelease: async () => ({ release }), detectInstallMethod: () => 'clone',
    runCommand: async (argv, options) => {
      calls.push({ argv, options });
      if (argv[1] === 'fetch') {
        controller.abort(new Error('cancelled during fetch'));
        return { code: 1, output: '', cancelled: true };
      }
      if (argv[1] === 'status') return { code: 0, output: '' };
      if (argv[1] === 'update-ref') return { code: 0, output: '' };
      throw new Error(`unexpected command ${argv.join(' ')}`);
    },
  }), /git fetch v1\.2\.0 failed \(cancelled\)/);
  const cleanup = calls.find(call => call.argv[1] === 'update-ref');
  assert.ok(cleanup, 'best-effort cleanup is attempted after cancelled fetch');
  assert.equal(cleanup.options.signal, undefined, 'cleanup is not suppressed by the aborted lifecycle signal');

  await assert.rejects(runNativeUpdate({
    io: noopIo, root: '/fixture/clone', currentVersion: '1.0.0',
    fetchLatestRelease: async () => ({ release }), detectInstallMethod: () => 'clone',
    runCommand: async argv => {
      if (argv[1] === 'status') return { code: 0, output: '' };
      if (argv[1] === 'fetch') throw new Error('fetch fixture failure');
      if (argv[1] === 'update-ref') throw new Error('cleanup fixture failure');
      throw new Error(`unexpected command ${argv.join(' ')}`);
    },
  }), /fetch fixture failure/);
});

test('clone update removes a real fetched private ref after cancellation', () => tempDir(async base => {
  const remote = join(base, 'remote.git');
  const seed = join(base, 'seed');
  const clone = join(base, 'clone');
  mkdirSync(seed);
  git(['init', '--bare', remote], base);
  git(['init', '-b', 'main'], seed);
  git(['config', 'user.email', 'test@example.invalid'], seed);
  git(['config', 'user.name', 'Test'], seed);
  writeFileSync(join(seed, 'tracked.txt'), 'release\n');
  git(['add', 'tracked.txt'], seed);
  git(['commit', '-m', 'release'], seed);
  git(['tag', 'v1.2.0'], seed);
  git(['remote', 'add', 'origin', remote], seed);
  git(['push', 'origin', 'main', '--tags'], seed);
  git(['symbolic-ref', 'HEAD', 'refs/heads/main'], remote);
  git(['clone', remote, clone], base);

  const controller = new AbortController();
  const commands = [];
  await assert.rejects(runNativeUpdate({
    io: noopIo, root: clone, currentVersion: '1.0.0', signal: controller.signal,
    fetchLatestRelease: async () => ({ release }), detectInstallMethod: () => 'clone',
    runCommand: async (argv, options) => {
      commands.push({ argv, options });
      const result = await (await import('../lib/opencode/update.mjs')).runUpdateCommand(argv, options);
      if (argv[1] === 'fetch') {
        assert.equal(result.code, 0, result.output);
        assert.match(argv[4], /^refs\/tags\/v1\.2\.0:refs\/opencode-update\/[a-f0-9-]+$/);
        controller.abort(new Error('cancelled immediately after fetch'));
        return { ...result, code: 1, cancelled: true };
      }
      return result;
    },
  }), /git fetch v1\.2\.0 failed \(cancelled\)/);

  const fetch = commands.find(command => command.argv[1] === 'fetch');
  const cleanup = commands.find(command => command.argv[1] === 'update-ref');
  assert.ok(fetch);
  assert.ok(cleanup);
  assert.equal(cleanup.options.signal, undefined);
  assert.equal(cleanup.options.timeoutSeconds, 30);
  assert.equal(cleanup.argv[2], '-d');
  assert.equal(cleanup.argv[3], fetch.argv[4].split(':')[1]);
  assert.equal(git(['for-each-ref', '--format=%(refname)', 'refs/opencode-update/'], clone), '');
}));

test('failed update command stops later steps and includes bounded failure output', async () => {
  const calls = [];
  await assert.rejects(runNativeUpdate({
    io: noopIo, currentVersion: '1.0.0', fetchLatestRelease: async () => ({ release }),
    detectInstallMethod: () => 'npm', runCommand: async argv => { calls.push(argv); return { code: 2, output: 'npm failure' }; },
  }), /npm install .* failed:\nnpm failure/);
  assert.equal(calls.length, 1);
});

test('runUpdateCommand strips runtime download tokens from child env case-insensitively without mutating caller env', async () => {
  const env = {
    ...process.env,
    CTG_RUNTIME_GITHUB_TOKEN: 'fake-uppercase-token',
    ctg_runtime_github_token: 'fake-lowercase-token',
    Ctg_Runtime_Github_Token: 'fake-mixedcase-token',
    CTG_RUNTIME_OTHER: 'preserve-this-value',
  };
  const result = await (await import('../lib/opencode/update.mjs')).runUpdateCommand(
    [process.execPath, '-e', 'process.stdout.write(JSON.stringify({env: process.env.CTG_RUNTIME_OTHER, tokenKeys: Object.keys(process.env).filter(key => key.toUpperCase() === "CTG_RUNTIME_GITHUB_TOKEN")}))'],
    { cwd: process.cwd(), env, timeoutSeconds: 10 },
  );
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.output), { env: 'preserve-this-value', tokenKeys: [] });
  assert.equal(env.ctg_runtime_github_token, 'fake-lowercase-token');
});

test('Windows cancellation sanitizes taskkill environment and handles taskkill spawn errors', async () => {
  const { EventEmitter } = await import('node:events');
  const controller = new AbortController();
  const calls = [];
  const env = {
    PATH: process.env.PATH,
    CTG_RUNTIME_GITHUB_TOKEN: 'fake-uppercase-token',
    ctg_runtime_github_token: 'fake-lowercase-token',
    Ctg_Runtime_Github_Token: 'fake-mixedcase-token',
    CTG_RUNTIME_OTHER: 'preserve-this-value',
  };
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = command === 'taskkill' ? 9999 : 4242;
    child.kill = () => { if (command !== 'taskkill') queueMicrotask(() => child.emit('close', 1)); };
    child.unref = () => {};
    if (command === 'taskkill') queueMicrotask(() => child.emit('error', new Error('taskkill unavailable')));
    return child;
  };
  const pending = (await import('../lib/opencode/update.mjs')).runUpdateCommand(
    ['fixture-updater'], { cwd: process.cwd(), env, signal: controller.signal, platform: 'win32', spawnImpl, timeoutSeconds: 10 },
  );
  controller.abort(new Error('cancel test'));
  const result = await pending;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.cancelled, true);
  assert.deepEqual(calls.map(call => call.command), ['fixture-updater', 'taskkill']);
  assert.equal(calls[0].options.detached, false);
  assert.equal(calls[1].options.env.CTG_RUNTIME_GITHUB_TOKEN, undefined);
  assert.equal(calls[1].options.env.ctg_runtime_github_token, undefined);
  assert.equal(calls[1].options.env.Ctg_Runtime_Github_Token, undefined);
  assert.equal(calls[1].options.env.CTG_RUNTIME_OTHER, 'preserve-this-value');
  assert.equal(env.Ctg_Runtime_Github_Token, 'fake-mixedcase-token');
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

test('an already-aborted lifecycle never checks releases or starts an installer', async () => {
  const controller = new AbortController();
  controller.abort(new Error('plugin disposed'));
  let fetched = false;
  let installed = false;
  await assert.rejects(runNativeUpdate({
    signal: controller.signal,
    fetchLatestRelease: async () => { fetched = true; return { release }; },
    detectInstallMethod: () => 'npm',
    runCommand: async () => { installed = true; return { code: 0, output: '' }; },
  }), /plugin disposed/);
  assert.equal(fetched, false);
  assert.equal(installed, false);
});

test('runUpdateCommand kills the updater process tree when its host lifecycle aborts', async () => {
  const controller = new AbortController();
  const pending = (await import('../lib/opencode/update.mjs')).runUpdateCommand(
    [process.execPath, '-e', 'setTimeout(() => {}, 30000)'],
    { cwd: process.cwd(), timeoutSeconds: 60, signal: controller.signal },
  );
  setTimeout(() => controller.abort(new Error('plugin disposed')), 40).unref?.();
  const result = await pending;
  assert.equal(result.cancelled, true);
  assert.notEqual(result.code, 0);
});

test('a successful code with a timed-out global-install retry remains a failure', async () => {
  const calls = [];
  let attempt = 0;
  await assert.rejects(runNativeUpdate({
    io: noopIo, currentVersion: '1.0.0', fetchLatestRelease: async () => ({ release }),
    detectInstallMethod: () => 'npm', cleanStaleInstall: () => ['/temporary/stale'],
    platform: 'linux',
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

test('runNativeUpdate passes npm operations through the Windows cmd shim', async () => {
  const calls = [];
  await runNativeUpdate({
    io: noopIo, currentVersion: '1.0.0', fetchLatestRelease: async () => ({ release }),
    detectInstallMethod: () => 'npm', platform: 'win32',
    runCommand: async (argv, options) => { calls.push({ argv, options }); return { code: 0, output: '' }; },
  });
  assert.deepEqual(calls[0].argv, [
    'cmd.exe', '/d', '/s', '/c', 'npm', 'install', '-g', '--install-links=true', release.installSpec,
  ]);
});
