import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readUpdateChannel, UPDATE_CHANNELS } from './update-channel.mjs';

export const FLAG_STAGES = ['off', 'experimental', 'beta', 'on'];

const STAGE_CHANNELS = {
  off: [],
  experimental: ['experimental'],
  beta: ['beta', 'experimental'],
  on: UPDATE_CHANNELS,
};
const FLAG_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const VALUE_WORDS = new Map([
  ['on', true],
  ['true', true],
  ['1', true],
  ['off', false],
  ['false', false],
  ['0', false],
]);

export const FEATURE_FLAGS = Object.freeze([
  Object.freeze({
    name: 'advanced-auth',
    description: 'Offer "Advanced: use an Experiential API key" as a Carthagent Cloud sign-in method in the native login dialog.',
    owner: '@B-icy',
    default: false,
    stage: 'off',
    expires: '2027-05-20',
    legacyEnv: 'CARTHAGENT_ADVANCED_AUTH',
  }),
]);

export function flagEnvName(name) {
  return `CTG_FLAG_${name.toUpperCase().replace(/-/g, '_')}`;
}

export function parseFlagValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  return VALUE_WORDS.get(value.trim().toLowerCase()) ?? null;
}

export function flagsFilePath(env = process.env) {
  return env.CARTHAGENT_FLAGS_FILE || join(env.HOME || env.USERPROFILE || homedir(), '.carthagent', 'flags.json');
}

const isText = value => typeof value === 'string' && value.trim() !== '';
const isDate = value => ISO_DATE.test(value ?? '') && !Number.isNaN(Date.parse(value));

const FLAG_RULES = [
  [flag => FLAG_NAME.test(flag.name ?? ''), 'name must be kebab-case'],
  [flag => isText(flag.description), 'description is required'],
  [flag => isText(flag.owner), 'owner is required'],
  [flag => typeof flag.default === 'boolean', 'default must be true or false'],
  [flag => FLAG_STAGES.includes(flag.stage), `stage must be one of ${FLAG_STAGES.join(', ')}`],
  [flag => flag.stage !== 'on' || flag.default === true, 'stage "on" requires default true'],
  [flag => isDate(flag.expires), 'expires must be a YYYY-MM-DD date'],
];

export function validateRegistry(registry = FEATURE_FLAGS) {
  const errors = [];
  const seen = new Set();
  for (const flag of registry) {
    const label = flag?.name ?? '(unnamed)';
    if (seen.has(label)) errors.push(`${label}: registered more than once`);
    seen.add(label);
    for (const [valid, message] of FLAG_RULES) if (!valid(flag ?? {})) errors.push(`${label}: ${message}`);
  }
  return errors;
}

export function expiredFlags(registry = FEATURE_FLAGS, today = new Date()) {
  const day = today.toISOString().slice(0, 10);
  return registry.filter(flag => flag.expires < day);
}

function findFlag(registry, name) {
  const flag = registry.find(item => item.name === name);
  if (!flag) throw Error(`Unknown feature flag: ${name}. Register it in lib/feature-flags.mjs.`);
  return flag;
}

export function readUserFlags({ env = process.env, readFile = readFileSync, registry = FEATURE_FLAGS } = {}) {
  const path = flagsFilePath(env);
  let parsed;
  try {
    parsed = JSON.parse(readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { path, values: {}, warnings: [] };
    return { path, values: {}, warnings: [`Ignoring ${path}: ${error.message}`] };
  }
  if (parsed?.version !== 1 || typeof parsed.flags !== 'object' || parsed.flags === null || Array.isArray(parsed.flags)) {
    return { path, values: {}, warnings: [`Ignoring ${path}: expected { "version": 1, "flags": { "<name>": "on" | "off" } }`] };
  }
  const values = {};
  const warnings = [];
  for (const [name, raw] of Object.entries(parsed.flags)) {
    const value = parseFlagValue(raw);
    if (!registry.some(flag => flag.name === name)) warnings.push(`Ignoring unknown flag ${name} in ${path}`);
    else if (value === null) warnings.push(`Ignoring ${name} in ${path}: use "on" or "off"`);
    else values[name] = value;
  }
  return { path, values, warnings };
}

function currentChannel(env, channel) {
  if (channel !== undefined) return channel;
  try {
    return readUpdateChannel(env);
  } catch {
    return null;
  }
}

export function createFlagContext({ env = process.env, readFile = readFileSync, channel, registry = FEATURE_FLAGS } = {}) {
  const user = readUserFlags({ env, readFile, registry });
  return { env, registry, user, channel: currentChannel(env, channel) };
}

function envOverride(flag, env) {
  const value = parseFlagValue(env[flagEnvName(flag.name)]);
  if (value !== null) return { enabled: value, source: 'env' };
  if (flag.legacyEnv && env[flag.legacyEnv] === '1') return { enabled: true, source: 'legacy-env' };
  return null;
}

export function resolveFlag(name, context = createFlagContext()) {
  const flag = findFlag(context.registry, name);
  const decision = envOverride(flag, context.env) ??
    (name in context.user.values ? { enabled: context.user.values[name], source: 'user' } : null) ??
    (STAGE_CHANNELS[flag.stage]?.includes(context.channel) ? { enabled: true, source: 'channel' } : null) ?? { enabled: flag.default, source: 'default' };
  return { ...flag, ...decision, channel: context.channel };
}

export function isEnabled(name, options = {}) {
  return resolveFlag(name, createFlagContext(options)).enabled;
}

export function resolveAllFlags(options = {}) {
  const context = createFlagContext(options);
  return { channel: context.channel, flags: context.registry.map(flag => resolveFlag(flag.name, context)), warnings: context.user.warnings };
}

export function formatFlags({ channel, flags }) {
  const rows = flags.map(flag => [flag.name, flag.enabled ? 'on' : 'off', flag.source, flag.stage, flag.expires]);
  const header = ['FLAG', 'STATE', 'SOURCE', 'STAGE', 'EXPIRES'];
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map(row => row[column].length)));
  const line = row =>
    row
      .map((cell, column) => cell.padEnd(widths[column]))
      .join('  ')
      .trimEnd();
  const details = flags.map(flag => `  ${flag.name}: ${flag.description} (owner ${flag.owner}; override with ${flagEnvName(flag.name)}=on|off)`);
  return [`Update channel: ${channel ?? 'unknown'}`, '', line(header), ...rows.map(line), '', ...details].join('\n');
}

export function flagsCommand({ args = [], io = console, ...options } = {}) {
  const unknown = args.filter(arg => arg !== '--json');
  if (unknown.length) {
    io.error(`Unknown option: ${unknown[0]}\nUsage: ctg flags [--json]`);
    return 1;
  }
  const report = resolveAllFlags(options);
  for (const warning of report.warnings) io.error(warning);
  io.log(args.includes('--json') ? JSON.stringify(report, null, 2) : formatFlags(report));
  return 0;
}
