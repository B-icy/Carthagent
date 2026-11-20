import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultRepo, ghRunner } from './github-issues.mjs';

const DEFAULT_LABELS_FILE = fileURLToPath(new URL('../.github/labels.json', import.meta.url));
const COLOR_RE = /^[0-9a-f]{6}$/;
const MAX_DESCRIPTION_LENGTH = 100;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

export function normalizeColor(color) {
  return String(color || '')
    .trim()
    .replace(/^#/, '')
    .toLowerCase();
}

export function validateLabels(labels) {
  if (!Array.isArray(labels) || labels.length === 0) throw new Error('labels.json must contain a non-empty "labels" array.');
  const seen = new Set();
  for (const label of labels) {
    const name = typeof label?.name === 'string' ? label.name.trim() : '';
    if (!name || name !== label.name) throw new Error(`Invalid label name: ${JSON.stringify(label?.name)}`);
    const key = name.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate label (names are case-insensitive): ${name}`);
    seen.add(key);
    if (!COLOR_RE.test(normalizeColor(label.color))) throw new Error(`Label "${name}" has an invalid color: ${JSON.stringify(label.color)}`);
    if (String(label.description ?? '').length > MAX_DESCRIPTION_LENGTH)
      throw new Error(`Label "${name}" description exceeds ${MAX_DESCRIPTION_LENGTH} characters.`);
  }
  return labels;
}

function labelChanges(wanted, existing) {
  const changes = {};
  if (existing.name !== wanted.name) changes.new_name = wanted.name;
  if (normalizeColor(existing.color) !== normalizeColor(wanted.color)) changes.color = normalizeColor(wanted.color);
  if ((existing.description ?? '') !== (wanted.description ?? '')) changes.description = wanted.description ?? '';
  return changes;
}

export function computeLabelPlan(desired, current) {
  validateLabels(desired);
  const byName = new Map((current || []).map(label => [label.name.toLowerCase(), label]));
  const plan = { create: [], update: [], unchanged: [], unmanaged: [] };
  for (const wanted of desired) {
    const existing = byName.get(wanted.name.toLowerCase());
    if (!existing) {
      plan.create.push({ name: wanted.name, color: normalizeColor(wanted.color), description: wanted.description ?? '' });
      continue;
    }
    byName.delete(wanted.name.toLowerCase());
    const changes = labelChanges(wanted, existing);
    if (Object.keys(changes).length) plan.update.push({ name: existing.name, changes });
    else plan.unchanged.push(wanted.name);
  }
  plan.unmanaged = [...byName.values()].map(label => label.name).sort((a, b) => a.localeCompare(b));
  return plan;
}

export function labelPath(repo, name) {
  return `repos/${repo}/labels/${encodeURIComponent(name)}`;
}

export function formatPlan(plan, { repo, apply = false } = {}) {
  const lines = [`Label sync plan for ${repo}${apply ? '' : ' (dry run; pass --apply to change labels)'}:`];
  for (const label of plan.create) lines.push(`  create     ${label.name}  #${label.color}  ${label.description}`);
  for (const label of plan.update) {
    const detail = Object.entries(label.changes)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(' ');
    lines.push(`  update     ${label.name}  ${detail}`);
  }
  for (const name of plan.unchanged) lines.push(`  unchanged  ${name}`);
  for (const name of plan.unmanaged) lines.push(`  unmanaged  ${name} (not in labels.json; left untouched)`);
  lines.push(`Summary: ${plan.create.length} create, ${plan.update.length} update, ${plan.unchanged.length} unchanged, ${plan.unmanaged.length} unmanaged.`);
  return lines.join('\n');
}

export function listRepoLabels(repo, run) {
  const labels = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = run('GET', `repos/${repo}/labels?per_page=${PAGE_SIZE}&page=${page}`);
    labels.push(...batch);
    if (batch.length < PAGE_SIZE) return labels;
  }
  throw new Error(`Repository ${repo} has more than ${PAGE_SIZE * MAX_PAGES} labels; refusing an incomplete plan.`);
}

export function applyLabelPlan(plan, repo, run) {
  for (const label of plan.create) run('POST', `repos/${repo}/labels`, label);
  for (const label of plan.update) run('PATCH', labelPath(repo, label.name), label.changes);
}

export function parseArgs(argv) {
  const options = { apply: false, repo: null, file: DEFAULT_LABELS_FILE, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--repo') options.repo = argv[++i];
    else if (arg === '--file') options.file = argv[++i];
    else throw new Error(`Unknown argument: ${arg}\nUsage: node tools/sync-labels.mjs [--repo owner/name] [--file path] [--json] [--apply]`);
  }
  if (options.repo !== null && !/^[\w.-]+\/[\w.-]+$/.test(options.repo || '')) throw new Error('--repo must be owner/name.');
  if (!options.file) throw new Error('--file requires a path.');
  return options;
}

export function main(argv = process.argv.slice(2), { run = ghRunner(), log = console.log } = {}) {
  const options = parseArgs(argv);
  const repo = options.repo || defaultRepo();
  const desired = JSON.parse(readFileSync(options.file, 'utf8')).labels;
  const plan = computeLabelPlan(desired, listRepoLabels(repo, run));
  log(options.json ? JSON.stringify({ repo, apply: options.apply, plan }, null, 2) : formatPlan(plan, { repo, apply: options.apply }));
  if (options.apply) {
    applyLabelPlan(plan, repo, run);
    if (!options.json) log(`Applied ${plan.create.length + plan.update.length} label change(s) to ${repo}.`);
  }
  return plan;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
