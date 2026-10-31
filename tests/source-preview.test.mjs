import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const launcher = join(root, 'script/ctg/source-preview.sh');
const plugin = join(root, 'plugins/carthagent');

function fixture(t, { bunVersion = '1.4.2' } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'ctg preview '));
  t.after(() => rmSync(base, { recursive: true, force: true }));
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

function run(f, args, { env = {}, cwd = f.outside } = {}) {
  const result = spawnSync('/bin/sh', [launcher, ...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', TERM: 'xterm-256color', ...env },
  });
  const recorded = existsSync(f.record) ? JSON.parse(readFileSync(f.record, 'utf8')) : undefined;
  return { ...result, recorded };
}

const required = f => ['--source', f.source, '--profile', f.profile, '--bun', f.bun];

test('launches source CLI from packages/cli with explicit space-containing paths outside the repository', t => {
  const f = fixture(t);
  const result = run(f, [...required(f), '--workspace', f.workspace]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.recorded.cwd, join(f.source, 'packages/cli'));
  assert.deepEqual(result.recorded.args, ['--no-env-file', 'run', 'src/index.ts', '--standalone', f.workspace]);
});

test('defaults the workspace to the caller directory and resolves relative paths against it', t => {
  const f = fixture(t);
  let result = run(f, required(f), { cwd: f.workspace });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.recorded.args.slice(-2), ['--standalone', f.workspace]);
  rmSync(f.record);
  result = run(f, ['--source', 'native source', '--profile', 'private profile', '--bun', 'tool dir/bun', '--workspace', 'empty workspace'], { cwd: f.base });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.recorded.cwd, join(f.source, 'packages/cli'));
  assert.deepEqual(result.recorded.args.slice(-2), ['--standalone', f.workspace]);
  assert.equal(result.recorded.env.HOME, join(f.profile, 'home'));
});

test('passes only the isolated allowlist and never inherits credentials', t => {
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

test('creates a private profile with plugin, theme and CLI configuration on first launch', t => {
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

test('preserves existing profile configuration and authentication on repeat launches', t => {
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

test('warns without rewriting a supplied config that omits the Carthagent plugin', t => {
  const f = fixture(t);
  const config = join(f.profile, 'config/opencode');
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, 'opencode.json'), '{"plugins":[]}');
  const result = run(f, [...required(f), '--workspace', f.workspace]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /does not reference the Carthagent plugin/);
  assert.equal(readFileSync(join(config, 'opencode.json'), 'utf8'), '{"plugins":[]}');
});

test('accepts a config that references the plugin through its physical path when launched via an alias', t => {
  const f = fixture(t);
  const alias = join(f.base, 'checkout alias');
  symlinkSync(root, alias);
  const config = join(f.profile, 'config/opencode');
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, 'opencode.json'), JSON.stringify({ plugins: [plugin] }));
  const result = spawnSync('/bin/sh', [join(alias, 'script/ctg/source-preview.sh'), ...required(f), '--workspace', f.workspace], {
    cwd: f.outside, encoding: 'utf8', env: { PATH: '/usr/bin:/bin' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /warning/);
});

test('forwards explicit commands after -- and enforces a private standalone server', t => {
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

test('reports missing explicit inputs and prerequisites without launching', t => {
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

test('rejects a Bun version that differs from the source packageManager pin', t => {
  const f = fixture(t, { bunVersion: '1.3.0' });
  const result = run(f, required(f));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires bun 1\.4\.2; .* reports 1\.3\.0/);
  assert.equal(result.recorded, undefined);
});

test('prints usage with --help', t => {
  const result = spawnSync('/bin/sh', [launcher, '--help'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--source DIR/);
  assert.match(result.stdout, /--profile DIR/);
  assert.match(result.stdout, /--bun PATH/);
});
