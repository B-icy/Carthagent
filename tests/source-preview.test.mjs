import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const launcher = join(root, 'script/ctg/source-preview.sh');
const plugin = join(root, 'plugins/carthagent');

function fixture(t, { bunVersion = '1.4.2' } = {}) {
  // Reach the fixture through a symlinked parent, like macOS /var -> /private/var, so explicit
  // alias spellings and physical cwd resolution stay distinguishable on every POSIX host.
  const physicalParent = mkdtempSync(join(tmpdir(), 'ctg preview physical '));
  const aliasParent = mkdtempSync(join(tmpdir(), 'ctg preview alias '));
  t.after(() => {
    rmSync(aliasParent, { recursive: true, force: true });
    rmSync(physicalParent, { recursive: true, force: true });
  });
  symlinkSync(physicalParent, join(aliasParent, 'var'));
  const base = join(aliasParent, 'var');
  assert.notEqual(realpathSync(base), base, 'fixture base must be reached through an alias');
  const source = join(base, 'native source');
  mkdirSync(join(source, 'packages/cli/src'), { recursive: true });
  mkdirSync(join(source, 'node_modules'));
  writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'opencode', packageManager: 'bun@1.4.2' }));
  writeFileSync(join(source, 'packages/cli/src/index.ts'), '');
  const tools = join(base, 'tool dir');
  mkdirSync(tools);
  const record = join(base, 'record.json');
  const bun = join(tools, 'bun');
  // Test double: reports version, or records invocation cwd/args/env instead of running OpenCode.
  writeFileSync(bun, `#!/bin/sh
if [ "$1" = "--version" ]; then echo ${bunVersion}; exit 0; fi
exec "${process.execPath}" -e 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), env: process.env }))' "${record}" "$@"
`);
  chmodSync(bun, 0o755);
  const profile = join(base, 'private profile');
  const workspace = join(base, 'empty workspace');
  mkdirSync(workspace);
  const outside = join(base, 'outside cwd');
  mkdirSync(outside);
  return { base, source, bun, profile, workspace, outside, record };
}

// The launcher is a POSIX /bin/sh script; native Windows has no /bin/sh and is not a supported platform.
const posixOnly = process.platform === 'win32' ? 'POSIX /bin/sh launcher is not supported on native Windows' : false;
const posixTest = (name, fn) => test(name, { skip: posixOnly }, fn);

function sh(script, args, options) {
  const result = spawnSync('/bin/sh', [script, ...args], { encoding: 'utf8', ...options });
  if (result.error) throw new Error(`could not run /bin/sh ${script}: ${result.error.message}`, { cause: result.error });
  return result;
}

function run(f, args, { env = {}, cwd = f.outside } = {}) {
  const result = sh(launcher, args, { cwd, env: { PATH: '/usr/bin:/bin', TERM: 'xterm-256color', ...env } });
  const recorded = existsSync(f.record) ? JSON.parse(readFileSync(f.record, 'utf8')) : undefined;
  return { ...result, recorded };
}

const required = f => ['--source', f.source, '--profile', f.profile, '--bun', f.bun];

posixTest('launches source CLI from packages/cli with explicit space-containing paths outside the repository', t => {
  const f = fixture(t);
  const result = run(f, [...required(f), '--workspace', f.workspace]);
  assert.equal(result.status, 0, result.stderr);
  // process.cwd() always reports the physical directory, even when entered through an alias.
  assert.equal(result.recorded.cwd, join(realpathSync(f.source), 'packages/cli'));
  assert.deepEqual(result.recorded.args, ['--no-env-file', 'run', 'src/index.ts', '--standalone', f.workspace]);
  assert.equal(result.recorded.env.HOME, join(f.profile, 'home'));
});

posixTest('defaults the workspace to the caller directory and resolves relative paths against it', t => {
  const f = fixture(t);
  // The spawned caller has no inherited PWD, so its shell resolves the default and relative paths from the physical cwd.
  let result = run(f, required(f), { cwd: f.workspace });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.recorded.args.slice(-2), ['--standalone', realpathSync(f.workspace)]);
  rmSync(f.record);
  const callerBase = realpathSync(f.base);
  result = run(f, ['--source', 'native source', '--profile', 'private profile', '--bun', 'tool dir/bun', '--workspace', 'empty workspace'], { cwd: f.base });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.recorded.cwd, join(callerBase, 'native source/packages/cli'));
  assert.deepEqual(result.recorded.args.slice(-2), ['--standalone', join(callerBase, 'empty workspace')]);
  assert.equal(result.recorded.env.HOME, join(callerBase, 'private profile/home'));
});

posixTest('passes only the isolated allowlist and never inherits credentials', t => {
  const f = fixture(t);
  const result = run(f, [...required(f), '--workspace', f.workspace], {
    env: { OPENAI_API_KEY: 'synthetic-not-a-secret', ANTHROPIC_API_KEY: 'synthetic', OPENCODE_CONFIG: '/elsewhere', HOME: '/home/ordinary', XDG_CONFIG_HOME: '/home/ordinary/.config', COLORTERM: 'truecolor' },
  });
  assert.equal(result.status, 0, result.stderr);
  const env = result.recorded.env;
  for (const name of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENCODE_CONFIG']) assert.equal(env[name], undefined, name);
  assert.equal(env.HOME, join(f.profile, 'home'));
  assert.equal(env.TMPDIR, join(f.profile, 'tmp'));
  assert.equal(env.XDG_CONFIG_HOME, join(f.profile, 'config'));
  assert.equal(env.XDG_DATA_HOME, join(f.profile, 'data'));
  assert.equal(env.XDG_CACHE_HOME, join(f.profile, 'cache'));
  assert.equal(env.XDG_STATE_HOME, join(f.profile, 'state'));
  assert.equal(env.OPENCODE_CONFIG_DIR, join(f.profile, 'config/opencode'));
  assert.equal(env.OPENCODE_TEST_HOME, join(f.profile, 'home'));
  assert.equal(env.OPENCODE_DISABLE_PROJECT_CONFIG, '1');
  assert.equal(env.OPENCODE_DISABLE_AUTOUPDATE, '1');
  assert.equal(env.BUN_RUNTIME_TRANSPILER_CACHE_PATH, '0');
  assert.equal(env.TERM, 'xterm-256color');
  assert.equal(env.COLORTERM, 'truecolor');
  assert.equal(env.PATH.split(':')[0], join(f.base, 'tool dir'));
});

posixTest('creates a private profile with plugin, theme and CLI configuration on first launch', t => {
  const f = fixture(t);
  const result = run(f, [...required(f), '--workspace', f.workspace]);
  assert.equal(result.status, 0, result.stderr);
  const config = join(f.profile, 'config/opencode');
  assert.deepEqual(JSON.parse(readFileSync(join(config, 'opencode.json'), 'utf8')).plugins, [plugin]);
  assert.equal(JSON.parse(readFileSync(join(config, 'cli.json'), 'utf8')).theme.name, 'carthage');
  assert.equal(readFileSync(join(config, 'themes/carthage.json'), 'utf8'), readFileSync(join(plugin, 'themes/carthage.json'), 'utf8'));
  assert.equal(statSync(f.profile).mode & 0o777, 0o700);
  assert.equal(statSync(join(config, 'opencode.json')).mode & 0o777, 0o600);
  for (const dir of ['home', 'tmp', 'data', 'cache', 'state']) assert.ok(statSync(join(f.profile, dir)).isDirectory(), dir);
});

posixTest('creates the private profile with BSD chmod argument parsing and a dash-leading relative path', t => {
  const f = fixture(t);
  const shims = join(f.base, 'bsd shims');
  mkdirSync(shims);
  // BSD chmod stops option parsing at the mode, so a later `--` is a missing file operand.
  writeFileSync(join(shims, 'chmod'), `#!/bin/sh
mode=$1; shift
for operand in "$@"; do
  case "$operand" in --|-*) echo "chmod: $operand: No such file or directory" >&2; exit 1 ;; esac
done
exec /bin/chmod "$mode" "$@"
`);
  chmodSync(join(shims, 'chmod'), 0o755);
  const result = run(f, ['--source', f.source, '--profile', '-dash profile', '--bun', f.bun, '--workspace', f.workspace], {
    cwd: f.base, env: { PATH: `${shims}:/usr/bin:/bin` },
  });
  assert.equal(result.status, 0, result.stderr);
  const profile = join(f.base, '-dash profile');
  assert.equal(statSync(profile).mode & 0o777, 0o700);
  assert.equal(result.recorded.env.HOME, join(realpathSync(f.base), '-dash profile/home'));
  assert.ok(existsSync(join(profile, 'config/opencode/opencode.json')));
});

posixTest('preserves existing profile configuration and authentication on repeat launches', t => {
  const f = fixture(t);
  const config = join(f.profile, 'config/opencode');
  mkdirSync(join(config, 'themes'), { recursive: true });
  mkdirSync(join(f.profile, 'data/opencode'), { recursive: true });
  const files = {
    [join(config, 'opencode.json')]: JSON.stringify({ plugins: [plugin], provider: { synthetic: { options: { baseURL: 'http://127.0.0.1:1' } } } }),
    [join(config, 'cli.json')]: JSON.stringify({ theme: { name: 'nord', mode: 'light' } }),
    [join(config, 'themes/carthage.json')]: '{"synthetic":"user theme"}',
    [join(f.profile, 'data/opencode/auth.json')]: '{"synthetic":"fixture, not a credential"}',
  };
  for (const [path, content] of Object.entries(files)) writeFileSync(path, content);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = run(f, [...required(f), '--workspace', f.workspace]);
    assert.equal(result.status, 0, result.stderr);
    for (const [path, content] of Object.entries(files)) assert.equal(readFileSync(path, 'utf8'), content, path);
  }
});

posixTest('warns without rewriting a supplied config that omits the Carthagent plugin', t => {
  const f = fixture(t);
  const config = join(f.profile, 'config/opencode');
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, 'opencode.json'), '{"plugins":[]}');
  const result = run(f, [...required(f), '--workspace', f.workspace]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /does not reference the Carthagent plugin/);
  assert.equal(readFileSync(join(config, 'opencode.json'), 'utf8'), '{"plugins":[]}');
});

posixTest('accepts a config that references the plugin through its physical path when launched via an alias', t => {
  const f = fixture(t);
  const alias = join(f.base, 'checkout alias');
  symlinkSync(root, alias);
  const config = join(f.profile, 'config/opencode');
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, 'opencode.json'), JSON.stringify({ plugins: [plugin] }));
  const result = sh(join(alias, 'script/ctg/source-preview.sh'), [...required(f), '--workspace', f.workspace], {
    cwd: f.outside, env: { PATH: '/usr/bin:/bin' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /warning/);
});

posixTest('forwards explicit commands after -- and enforces a private standalone server', t => {
  const f = fixture(t);
  let result = run(f, [...required(f), '--', 'auth', 'login', 'my provider']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.recorded.args, ['--no-env-file', 'run', 'src/index.ts', 'auth', 'login', 'my provider', '--standalone']);
  rmSync(f.record);
  result = run(f, [...required(f), '--', '--standalone', f.workspace]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.recorded.args.slice(3), ['--standalone', f.workspace]);
  for (const forbidden of [['--server', 'http://127.0.0.1:4096'], ['--server=http://127.0.0.1:4096']]) {
    rmSync(f.record, { force: true });
    result = run(f, [...required(f), '--', ...forbidden]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /--server/);
    assert.equal(result.recorded, undefined);
  }
});

posixTest('reports missing explicit inputs and prerequisites without launching', t => {
  const f = fixture(t);
  const cases = [
    [['--profile', f.profile, '--bun', f.bun], /--source is required/],
    [['--source', f.source, '--bun', f.bun], /--profile is required/],
    [['--source', f.source, '--profile', f.profile], /--bun is required/],
    [['--source', join(f.base, 'missing'), '--profile', f.profile, '--bun', f.bun], /source .* is not a directory/],
    [['--source', f.workspace, '--profile', f.profile, '--bun', f.bun], /packages\/cli\/src\/index\.ts/],
    [['--source', f.source, '--profile', f.profile, '--bun', join(f.base, 'missing bun')], /not executable/],
    [[...required(f), '--workspace', join(f.base, 'missing workspace')], /workspace .* is not a directory/],
    [[...required(f), '--unknown'], /Unknown option/],
  ];
  for (const [args, message] of cases) {
    const result = run(f, args);
    assert.equal(result.status, 2, `${args.join(' ')}\n${result.stderr}`);
    assert.match(result.stderr, message);
    assert.equal(result.recorded, undefined);
  }
  rmSync(join(f.source, 'node_modules'), { recursive: true });
  const missingDeps = run(f, required(f));
  assert.equal(missingDeps.status, 1);
  assert.match(missingDeps.stderr, /bun install/);
  assert.equal(missingDeps.recorded, undefined);
  assert.equal(existsSync(f.profile), false, 'failed prerequisite checks do not create a profile');
});

posixTest('rejects a Bun version that differs from the source packageManager pin', t => {
  const f = fixture(t, { bunVersion: '1.3.0' });
  const result = run(f, required(f));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires bun 1\.4\.2; .* reports 1\.3\.0/);
  assert.equal(result.recorded, undefined);
});

posixTest('prints usage with --help', t => {
  const result = sh(launcher, ['--help'], { env: { PATH: '/usr/bin:/bin' } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--source DIR/);
  assert.match(result.stdout, /--profile DIR/);
  assert.match(result.stdout, /--bun PATH/);
});
