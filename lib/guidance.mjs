import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unframe } from './tui/framing.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_PROFILE_DIR = join(root, 'guidance', 'profiles');

export function loadGuidanceProfiles(dir = DEFAULT_PROFILE_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(file => file.endsWith('.json'))
    .sort()
    .map(file => validateProfile(JSON.parse(readFileSync(join(dir, file), 'utf8')), file))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

export function routeGuidance(request, { cwd = process.cwd(), profiles = loadGuidanceProfiles() } = {}) {
  // Harness instructions are not user requirements. Route only the task.
  const text = normalize(unframe(request) ?? request);
  const dependencies = projectDependencies(cwd);
  return profiles.filter(profile => {
    const keywordMatch = (profile.match.keywords || []).some(keyword => contains(text, keyword));
    const allMatch = !(profile.match.allKeywords || []).length || profile.match.allKeywords.every(keyword => contains(text, keyword));
    const excluded = (profile.match.excludeKeywords || []).some(keyword => contains(text, keyword));
    const dependencyMatch = (profile.match.dependencies || []).some(dependency => dependencies.has(dependency.toLowerCase()));
    return !excluded && allMatch && (keywordMatch || (profile.activateOnDependency && dependencyMatch));
  });
}

export function formatGuidance(profiles) {
  if (!profiles.length) return '';
  const lines = [
    'Additional delivery guidance applies to this request. Apply it during delivery_plan, implementation, and review. Add only checks relevant to the requested change, but do not omit affected boundaries or failure paths.'
  ];
  for (const profile of profiles) {
    lines.push(`\n[${profile.id}] ${profile.title}`);
    for (const item of profile.planning) lines.push(`Plan: ${item}`);
    for (const item of profile.checks) lines.push(`Check: ${item}`);
    for (const item of profile.review) lines.push(`Review: ${item}`);
  }
  return lines.join('\n');
}

function projectDependencies(cwd) {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    return new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies }).map(name => name.toLowerCase()));
  } catch {
    return new Set();
  }
}

function validateProfile(profile, file) {
  const arrays = ['planning', 'checks', 'review'];
  if (!profile || typeof profile !== 'object' || !/^[a-z][a-z0-9-]{1,39}$/.test(profile.id || '') || typeof profile.title !== 'string') throw Error(`Invalid guidance profile: ${file}`);
  if (!profile.match || !Array.isArray(profile.match.keywords) || !profile.match.keywords.length) throw Error(`Guidance profile ${profile.id} needs match.keywords`);
  for (const key of arrays) if (!Array.isArray(profile[key]) || !profile[key].every(item => typeof item === 'string' && item.trim())) throw Error(`Guidance profile ${profile.id} needs ${key} strings`);
  return { priority: 0, activateOnDependency: false, ...profile };
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function contains(text, keyword) {
  const value = normalize(keyword);
  if (!value) return false;
  if (/^[a-z0-9]+$/.test(value)) return new RegExp(`(?:^|[^a-z0-9])${value}(?:$|[^a-z0-9])`).test(text);
  return text.includes(value);
}
