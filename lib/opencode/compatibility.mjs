import { OPENCODE_VERSION, resolveOpenCode } from './runtime.mjs';

/** Assert that the installed executable implements the native runtime contract. */
export async function assertCompatibility(options = {}) {
  const binary = await resolveOpenCode(options);
  return Object.freeze({ binary, version: OPENCODE_VERSION, native: true });
}

/** Keep only portable CTG slash-command metadata for the native TUI launcher. */
export function normalizeSlashCommand(name, definition) {
  if (!/^[a-z][a-z0-9_-]*$/i.test(name)) throw new TypeError(`Invalid slash command name: ${name}`);
  if (typeof definition === 'string') return { description: name, template: definition };
  if (!definition || typeof definition.template !== 'string') throw new TypeError(`Slash command ${name} requires a template`);
  return { description: definition.description ?? name, template: definition.template, ...(definition.agent ? { agent: definition.agent } : {}) };
}

export function nativeCommandConfig(commands = {}) {
  return Object.fromEntries(Object.entries(commands).map(([name, definition]) => [name, normalizeSlashCommand(name, definition)]));
}
