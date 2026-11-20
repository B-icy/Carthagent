import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  FEATURE_FLAGS,
  expiredFlags,
  flagEnvName,
  flagsCommand,
  flagsFilePath,
  isEnabled,
  parseFlagValue,
  readUserFlags,
  resolveAllFlags,
  resolveFlag,
  createFlagContext,
  validateRegistry,
} from '../lib/feature-flags.mjs';
import { checkFeatureFlags, findFlagReferences } from '../tools/check-feature-flags.mjs';
import { runOpenCodeCli } from '../lib/opencode/cli.mjs';

const REGISTRY = [
  { name: 'dark-launch', description: 'd', owner: '@o', default: false, stage: 'off', expires: '2030-01-01' },
  { name: 'beta-rollout', description: 'b', owner: '@o', default: false, stage: 'beta', expires: '2030-01-01' },
  { name: 'experimental-rollout', description: 'e', owner: '@o', default: false, stage: 'experimental', expires: '2030-01-01' },
  { name: 'legacy-switch', description: 'l', owner: '@o', default: false, stage: 'off', expires: '2030-01-01', legacyEnv: 'OLD_SWITCH' },
];
const FLAGS_FILE = '/virtual/flags.json';
const missingFile = () => {
  throw Object.assign(Error('missing'), { code: 'ENOENT' });
};
const fileWith = text => path => {
  assert.equal(path, FLAGS_FILE);
  return text;
};
const userFlags = flags => fileWith(JSON.stringify({ version: 1, flags }));
const resolve = (name, { env = {}, readFile = missingFile, channel = 'stable' } = {}) =>
  resolveFlag(name, createFlagContext({ env: { CARTHAGENT_FLAGS_FILE: FLAGS_FILE, ...env }, readFile, channel, registry: REGISTRY }));

test('the registry is valid and every flag has a future expiry at registration time', () => {
  assert.deepEqual(validateRegistry(), []);
  assert.deepEqual(validateRegistry(REGISTRY), []);
  for (const flag of FEATURE_FLAGS) assert.match(flag.expires, /^\d{4}-\d{2}-\d{2}$/);
});

test('registry validation catches malformed entries', () => {
  const errors = validateRegistry([
    { name: 'Bad_Name', description: '', owner: '@o', default: 'yes', stage: 'later', expires: '2030-13-45' },
    { name: 'on-flag', description: 'x', owner: '@o', default: false, stage: 'on', expires: '2030-01-01' },
    { name: 'on-flag', description: 'x', owner: '@o', default: true, stage: 'on', expires: '2030-01-01' },
  ]);
  assert.deepEqual(errors, [
    'Bad_Name: name must be kebab-case',
    'Bad_Name: description is required',
    'Bad_Name: default must be true or false',
    'Bad_Name: stage must be one of off, experimental, beta, on',
    'Bad_Name: expires must be a YYYY-MM-DD date',
    'on-flag: stage "on" requires default true',
    'on-flag: registered more than once',
  ]);
});

test('env names and values', () => {
  assert.equal(flagEnvName('advanced-auth'), 'CTG_FLAG_ADVANCED_AUTH');
  assert.equal(parseFlagValue('ON'), true);
  assert.equal(parseFlagValue(' off '), false);
  assert.equal(parseFlagValue('1'), true);
  assert.equal(parseFlagValue(false), false);
  assert.equal(parseFlagValue('maybe'), null);
  assert.equal(flagsFilePath({ HOME: '/home/u' }).replace(/\\/g, '/'), '/home/u/.carthagent/flags.json');
  assert.equal(flagsFilePath({ CARTHAGENT_FLAGS_FILE: '/x.json', HOME: '/home/u' }), '/x.json');
});

test('precedence: env > user file > channel > default', () => {
  assert.deepEqual(pick(resolve('beta-rollout')), [false, 'default']);
  assert.deepEqual(pick(resolve('beta-rollout', { channel: 'beta' })), [true, 'channel']);
  assert.deepEqual(pick(resolve('beta-rollout', { channel: 'experimental' })), [true, 'channel']);
  assert.deepEqual(pick(resolve('experimental-rollout', { channel: 'beta' })), [false, 'default']);
  assert.deepEqual(pick(resolve('dark-launch', { channel: 'experimental' })), [false, 'default']);
  const userOff = userFlags({ 'beta-rollout': 'off' });
  assert.deepEqual(pick(resolve('beta-rollout', { channel: 'beta', readFile: userOff })), [false, 'user']);
  assert.deepEqual(pick(resolve('beta-rollout', { channel: 'beta', readFile: userOff, env: { CTG_FLAG_BETA_ROLLOUT: 'on' } })), [true, 'env']);
  assert.deepEqual(pick(resolve('beta-rollout', { channel: 'beta', env: { CTG_FLAG_BETA_ROLLOUT: 'off' } })), [false, 'env']);
  assert.deepEqual(pick(resolve('dark-launch', { readFile: userFlags({ 'dark-launch': true }) })), [true, 'user']);
});

function pick(flag) {
  return [flag.enabled, flag.source];
}

test('an invalid env value falls through to the next source', () => {
  assert.deepEqual(pick(resolve('dark-launch', { env: { CTG_FLAG_DARK_LAUNCH: 'sometimes' }, readFile: userFlags({ 'dark-launch': 'on' }) })), [true, 'user']);
});

test('a legacy env switch keeps its exact old meaning below CTG_FLAG_*', () => {
  assert.deepEqual(pick(resolve('legacy-switch', { env: { OLD_SWITCH: '1' } })), [true, 'legacy-env']);
  assert.deepEqual(pick(resolve('legacy-switch', { env: { OLD_SWITCH: 'true' } })), [false, 'default']);
  assert.deepEqual(pick(resolve('legacy-switch', { env: { OLD_SWITCH: '1', CTG_FLAG_LEGACY_SWITCH: 'off' } })), [false, 'env']);
});

test('advanced-auth defaults off and honors CARTHAGENT_ADVANCED_AUTH=1 as before', () => {
  const options = { env: { CARTHAGENT_FLAGS_FILE: FLAGS_FILE }, readFile: missingFile };
  for (const channel of ['stable', 'beta', 'experimental']) assert.equal(isEnabled('advanced-auth', { ...options, channel }), false);
  assert.equal(isEnabled('advanced-auth', { ...options, env: { ...options.env, CARTHAGENT_ADVANCED_AUTH: '1' } }), true);
  assert.equal(isEnabled('advanced-auth', { ...options, env: { ...options.env, CTG_FLAG_ADVANCED_AUTH: 'on' } }), true);
});

test('unknown flag names throw', () => {
  assert.throws(() => resolve('no-such-flag'), /Unknown feature flag: no-such-flag/);
  assert.throws(() => isEnabled('no-such-flag', { env: {}, readFile: missingFile, channel: 'stable' }), /Register it in lib\/feature-flags\.mjs/);
});

test('a malformed or unreadable user file is ignored with a warning', () => {
  const env = { CARTHAGENT_FLAGS_FILE: FLAGS_FILE };
  const cases = [
    ['{not json', /Ignoring \/virtual\/flags\.json: /],
    [JSON.stringify({ version: 2, flags: {} }), /expected \{ "version": 1/],
    [JSON.stringify({ version: 1, flags: ['dark-launch'] }), /expected \{ "version": 1/],
  ];
  for (const [text, warning] of cases) {
    const user = readUserFlags({ env, readFile: fileWith(text), registry: REGISTRY });
    assert.deepEqual(user.values, {});
    assert.match(user.warnings[0], warning);
    assert.deepEqual(pick(resolve('dark-launch', { readFile: fileWith(text) })), [false, 'default']);
  }
  const denied = () => {
    throw Object.assign(Error('EACCES: permission denied'), { code: 'EACCES' });
  };
  assert.match(readUserFlags({ env, readFile: denied, registry: REGISTRY }).warnings[0], /permission denied/);
  const mixed = readUserFlags({ env, readFile: userFlags({ 'dark-launch': 'on', gone: 'on', 'beta-rollout': 'maybe' }), registry: REGISTRY });
  assert.deepEqual(mixed.values, { 'dark-launch': true });
  assert.deepEqual(mixed.warnings, ['Ignoring unknown flag gone in /virtual/flags.json', 'Ignoring beta-rollout in /virtual/flags.json: use "on" or "off"']);
});

test('an unreadable update channel falls back to registry defaults', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ctg-flags-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const channelFile = join(dir, 'update-channel.json');
  const env = { CARTHAGENT_FLAGS_FILE: FLAGS_FILE, CARTHAGENT_UPDATE_CHANNEL_FILE: channelFile };
  assert.equal(resolveAllFlags({ env, readFile: missingFile, registry: REGISTRY }).channel, 'stable');
  writeFileSync(channelFile, JSON.stringify({ version: 1, channel: 'beta' }));
  assert.equal(resolveAllFlags({ env, readFile: missingFile, registry: REGISTRY }).flags[1].source, 'channel');
  writeFileSync(channelFile, '{broken');
  const broken = resolveAllFlags({ env, readFile: missingFile, registry: REGISTRY });
  assert.equal(broken.channel, null);
  assert.ok(broken.flags.every(flag => flag.source === 'default'));
});

test('expired flags are detected by date', () => {
  const registry = [{ ...REGISTRY[0], expires: '2026-01-31' }, REGISTRY[1]];
  assert.deepEqual(
    expiredFlags(registry, new Date('2026-02-01T00:00:00Z')).map(flag => flag.name),
    ['dark-launch'],
  );
  assert.deepEqual(expiredFlags(registry, new Date('2026-01-31T12:00:00Z')), []);
});

test('the checker finds literal references, unregistered, unused, expired and dynamic flags', () => {
  const files = [
    { path: 'lib/a.mjs', text: "import { isEnabled } from './feature-flags.mjs';\nif (isEnabled('dark-launch')) {}\nisEnabled(\"ghost\");\nisEnabled(name);" },
    { path: 'lib/b.mjs', text: "logger.isEnabled(level); isEnabled('not-a-flag-file')" },
  ];
  const { references, dynamic } = findFlagReferences(files);
  assert.deepEqual(references, [
    { name: 'dark-launch', path: 'lib/a.mjs', line: 2 },
    { name: 'ghost', path: 'lib/a.mjs', line: 3 },
  ]);
  assert.deepEqual(dynamic, [{ path: 'lib/a.mjs', line: 4 }]);
  const registry = [{ ...REGISTRY[0], expires: '2026-01-01' }, REGISTRY[1]];
  const problems = checkFeatureFlags({ registry, references, dynamic, today: new Date('2026-06-01T00:00:00Z') });
  assert.deepEqual(
    problems.map(problem => problem.kind),
    ['expired', 'unregistered', 'unused', 'dynamic'],
  );
  assert.match(problems[2].message, /beta-rollout is registered but no source calls/);
});

test('the repository flags are registered, referenced and unexpired', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../tools/check-feature-flags.mjs', import.meta.url)), '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.problems, []);
  assert.ok(report.references.some(reference => reference.name === 'advanced-auth' && reference.path === 'plugins/carthagent/src/server/providers.ts'));
});

test('the checker fails once a flag passes its expiry date', () => {
  const script = fileURLToPath(new URL('../tools/check-feature-flags.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--today', '2999-01-01'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[expired\] advanced-auth expired on/);
});

test('ctg flags lists flags as text or JSON without touching the runtime', async () => {
  const output = [];
  const io = { log: line => output.push(line), error: line => output.push(`ERR ${line}`) };
  const options = { env: { CARTHAGENT_FLAGS_FILE: FLAGS_FILE }, readFile: fileWith('{oops'), channel: 'beta', registry: REGISTRY };
  assert.equal(flagsCommand({ args: [], io, ...options }), 0);
  assert.match(output[0], /^ERR Ignoring \/virtual\/flags\.json/);
  assert.match(output[1], /Update channel: beta/);
  assert.match(output[1], /beta-rollout\s+on\s+channel\s+beta\s+2030-01-01/);
  output.length = 0;
  assert.equal(flagsCommand({ args: ['--json'], io, ...options, readFile: missingFile }), 0);
  assert.equal(JSON.parse(output[0]).flags.find(flag => flag.name === 'beta-rollout').source, 'channel');
  assert.equal(flagsCommand({ args: ['--all'], io, ...options }), 1);
  const runtime = new Proxy({}, { get: () => () => assert.fail('flags must not call the runtime') });
  const lines = [];
  assert.equal(await runOpenCodeCli({ argv: ['flags', '--json'], runtime, io: { log: line => lines.push(line), error() {} }, stdoutIsTTY: false }), 0);
  assert.ok(JSON.parse(lines[0]).flags.some(flag => flag.name === 'advanced-auth'));
});
