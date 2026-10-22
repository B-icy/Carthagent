import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

export const UPDATE_CHANNELS = ['stable', 'beta', 'experimental'];

export function validateUpdateChannel(channel) {
  if (!UPDATE_CHANNELS.includes(channel)) throw Error(`Invalid update channel: ${channel}. Choose stable, beta, or experimental.`);
  return channel;
}

export function updateChannelPath(env = process.env) {
  return env.CARTHAGENT_UPDATE_CHANNEL_FILE || join(env.HOME || env.USERPROFILE || homedir(), '.carthagent', 'update-channel.json');
}

export function readUpdateChannel(env = process.env) {
  try {
    const value = JSON.parse(readFileSync(updateChannelPath(env), 'utf8'));
    if (value.version !== 1) throw Error('Unsupported update channel file version');
    return validateUpdateChannel(value.channel);
  } catch (error) {
    if (error.code === 'ENOENT') return 'stable';
    throw Error(`Cannot read update channel; use ctg update --channel stable to reset it: ${error.message}`);
  }
}

export function writeUpdateChannel(channel, env = process.env) {
  validateUpdateChannel(channel);
  const path = updateChannelPath(env);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify({ version: 1, channel }) + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(temp, path);
  } finally { rmSync(temp, { force: true }); }
}

export function parseUpdateOptions(args) {
  const options = { checkOnly: false, force: false, channel: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--check') options.checkOnly = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--channel' || arg.startsWith('--channel=')) {
      if (options.channel !== null) throw Error('Specify --channel only once.');
      options.channel = validateUpdateChannel(arg === '--channel' ? args[++i] : arg.slice('--channel='.length));
    } else throw Error(`Unknown update option: ${arg}`);
  }
  return options;
}

export function releaseAllowedOnChannel(release, channel) {
  validateUpdateChannel(channel);
  if (!release || release.draft || typeof release.version !== 'string') return false;
  const version = release.version.split('+')[0];
  const label = version.includes('-') ? version.slice(version.indexOf('-') + 1) : '';
  if (!label && !release.prerelease) return true;
  if (channel === 'stable') return false;
  if (channel === 'experimental') return true;
  return /^(beta|rc)(\.|$)/.test(label || '');
}
