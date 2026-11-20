#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const OTHER_TITLE = 'Other changes';
const PAGE_SIZE = 100;
const PREFIX_LABELS = {
  feat: 'enhancement',
  feature: 'enhancement',
  fix: 'bug',
  bugfix: 'bug',
  perf: 'performance',
  docs: 'documentation',
  doc: 'documentation',
  deps: 'dependencies',
  security: 'security',
  release: 'area: release',
  ci: 'area: ci',
  build: 'area: ci',
  test: 'test',
  chore: 'chore',
  refactor: 'chore',
  style: 'chore',
};
const USAGE =
  'Usage: release-notes.mjs --tag <tag> [--previous <tag>] [--ref <commitish>] [--repo <owner/name>] [--config .github/release.yml] [--title <title>] [--out <file>]';

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote) quote = char === quote ? null : quote;
    else if (char === "'" || char === '"') quote = char;
    else if (char === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

function splitFlow(inner) {
  const parts = [];
  let quote = null;
  let current = '';
  for (const char of inner) {
    if (quote) quote = char === quote ? null : quote;
    else if (char === "'" || char === '"') quote = char;
    else if (char === ',') {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  return [...parts, current].map(part => part.trim()).filter(Boolean);
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value.startsWith('[') && value.endsWith(']')) return splitFlow(value.slice(1, -1)).map(parseScalar);
  if (/^'.*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'");
  if (/^".*"$/.test(value)) return JSON.parse(value);
  return value;
}

const isItem = text => text === '-' || text.startsWith('- ');
const isKeyLine = text => /^[^'"[\]{}#\s-][^:]*:(\s|$)/.test(text);

function parseMap(lines, state, indent) {
  const map = {};
  while (state.i < lines.length && lines[state.i].indent === indent && !isItem(lines[state.i].text)) {
    const text = lines[state.i].text;
    const colon = text.indexOf(':');
    const key = parseScalar(text.slice(0, colon));
    const rest = text.slice(colon + 1).trim();
    state.i++;
    const next = lines[state.i];
    if (rest) map[key] = parseScalar(rest);
    else if (next && next.indent > indent) map[key] = parseBlock(lines, state, next.indent);
    else if (next && next.indent === indent && isItem(next.text)) map[key] = parseSequence(lines, state, indent);
    else map[key] = null;
  }
  return map;
}

function parseSequence(lines, state, indent) {
  const list = [];
  while (state.i < lines.length && lines[state.i].indent === indent && isItem(lines[state.i].text)) {
    const body = lines[state.i].text.slice(1).trimStart();
    if (!body) {
      state.i++;
      list.push(state.i < lines.length ? parseBlock(lines, state, lines[state.i].indent) : null);
    } else if (isKeyLine(body)) {
      const childIndent = indent + lines[state.i].text.length - body.length;
      lines[state.i] = { indent: childIndent, text: body };
      list.push(parseMap(lines, state, childIndent));
    } else {
      list.push(parseScalar(body));
      state.i++;
    }
  }
  return list;
}

function parseBlock(lines, state, indent) {
  return isItem(lines[state.i].text) ? parseSequence(lines, state, indent) : parseMap(lines, state, indent);
}

export function parseYamlSubset(text) {
  const lines = [];
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const content = stripComment(raw).trimEnd();
    if (content.trim()) lines.push({ indent: content.length - content.trimStart().length, text: content.trimStart() });
  }
  return lines.length ? parseBlock(lines, { i: 0 }, lines[0].indent) : {};
}

const asList = value => (Array.isArray(value) ? value : value == null ? [] : [value]);

export function parseReleaseConfig(text) {
  const changelog = parseYamlSubset(text).changelog ?? {};
  const exclude = changelog.exclude ?? {};
  return {
    exclude: { labels: asList(exclude.labels), authors: asList(exclude.authors) },
    categories: asList(changelog.categories).map(category => ({
      title: category.title,
      labels: asList(category.labels),
      exclude: { labels: asList(category.exclude?.labels), authors: asList(category.exclude?.authors) },
    })),
  };
}

export function prNumberFromMessage(message) {
  const first = String(message).split('\n')[0];
  const merge = first.match(/^Merge pull request #(\d+)/);
  if (merge) return Number(merge[1]);
  const squashed = [...first.matchAll(/\(#(\d+)\)/g)];
  return squashed.length ? Number(squashed.at(-1)[1]) : null;
}

export function cleanTitle(title) {
  return String(title)
    .split('\n')[0]
    .replace(/\s*\(#\d+\)\s*$/, '')
    .trim();
}

export function inferLabels(title) {
  const match = String(title).match(/^([a-z]+)(?:\(([^)]*)\))?(!)?:\s/i);
  if (!match) return /^fix(es|ed)?\b/i.test(String(title)) ? ['bug'] : [];
  const labels = [];
  if (match[3]) labels.push('breaking-change');
  if (match[2]?.toLowerCase() === 'deps') labels.push('dependencies');
  const label = PREFIX_LABELS[match[1].toLowerCase()];
  if (label) labels.push(label);
  return labels;
}

function categoryMatches(category, labels, author, { wildcard }) {
  if (category.exclude.authors.includes(author) || labels.some(label => category.exclude.labels.includes(label))) return false;
  if (wildcard) return category.labels.includes('*');
  return labels.some(label => category.labels.includes(label));
}

export function categorize(entry, config) {
  const inferred = inferLabels(entry.title);
  for (const labels of [entry.labels, inferred]) {
    const category = config.categories.find(item => categoryMatches(item, labels, entry.author, { wildcard: false }));
    if (category) return category.title;
  }
  const fallback = config.categories.find(item => categoryMatches(item, entry.labels, entry.author, { wildcard: true }));
  return fallback?.title ?? OTHER_TITLE;
}

export function isExcluded(entry, config) {
  return config.exclude.authors.includes(entry.author) || entry.labels.some(label => config.exclude.labels.includes(label));
}

export function groupEntries(entries, config) {
  const order = [...config.categories.map(category => category.title), OTHER_TITLE];
  const groups = new Map(order.map(title => [title, []]));
  for (const entry of entries) {
    if (!isExcluded(entry, config)) groups.get(categorize(entry, config)).push(entry);
  }
  return [...groups].filter(([, items]) => items.length).map(([title, items]) => ({ title, entries: items }));
}

export function contributorsOf(groups) {
  const authors = new Set();
  for (const group of groups) for (const entry of group.entries) if (entry.author && !entry.author.endsWith('[bot]')) authors.add(entry.author);
  return [...authors].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

function entryLine(entry) {
  const ref = entry.kind === 'pr' ? `[#${entry.number}](${entry.url})` : `[${entry.sha.slice(0, 7)}](${entry.url})`;
  return `- ${entry.title} (${ref})${entry.author ? ` by @${entry.author}` : ''}`;
}

export function renderNotes({ title, repo, base, head, groups }) {
  const prs = groups.flatMap(group => group.entries).filter(entry => entry.kind === 'pr').length;
  const commits = groups.flatMap(group => group.entries).length - prs;
  const lines = [
    `# ${title}`,
    '',
    `> Draft generated by tools/release-notes.mjs from ${prs} pull request(s) and ${commits} direct commit(s) in ${base}...${head}.`,
    '> Rewrite it for users before publishing.',
  ];
  for (const group of groups) lines.push('', `## ${group.title}`, '', ...group.entries.map(entryLine));
  const contributors = contributorsOf(groups);
  if (contributors.length) lines.push('', '## Contributors', '', contributors.map(login => `@${login}`).join(', '));
  lines.push('', `**Full changelog**: https://github.com/${repo}/compare/${base}...${head}`, '');
  return lines.join('\n');
}

export function parseVersion(tag) {
  const match = String(tag).match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  const pre = match[4] ? match[4].split('.').map(part => (/^\d+$/.test(part) ? Number(part) : part)) : [];
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre };
}

function comparePre(a, b) {
  if (!a.length || !b.length) return b.length - a.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined || b[i] === undefined) return a[i] === undefined ? -1 : 1;
    if (a[i] === b[i]) continue;
    if (typeof a[i] !== typeof b[i]) return typeof a[i] === 'number' ? -1 : 1;
    return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i];
  return comparePre(a.pre, b.pre);
}

export function previousTag(tags, target) {
  const current = parseVersion(target);
  if (!current) throw Error(`Cannot infer the previous tag of ${target}; pass --previous.`);
  const candidates = tags
    .map(tag => ({ tag, version: parseVersion(tag) }))
    .filter(item => item.version && compareVersions(item.version, current) < 0)
    .filter(item => current.pre.length || !item.version.pre.length)
    .sort((a, b) => compareVersions(b.version, a.version));
  return candidates[0]?.tag ?? null;
}

function pullEntry(pull) {
  return {
    kind: 'pr',
    number: pull.number,
    title: cleanTitle(pull.title),
    url: pull.html_url,
    author: pull.user?.login ?? null,
    labels: (pull.labels ?? []).map(label => (typeof label === 'string' ? label : label.name)),
  };
}

function commitEntry(commit) {
  return {
    kind: 'commit',
    sha: commit.sha,
    title: cleanTitle(commit.commit.message),
    url: commit.html_url,
    author: commit.author?.login ?? null,
    labels: [],
  };
}

export async function compareCommits(api, { repo, base, head }) {
  const commits = [];
  for (let page = 1; ; page++) {
    const result = await api(`repos/${repo}/compare/${base}...${head}?per_page=${PAGE_SIZE}&page=${page}`);
    commits.push(...result.commits);
    if (result.commits.length < PAGE_SIZE || commits.length >= result.total_commits) return commits;
  }
}

export async function collectEntries(api, range) {
  const commits = await compareCommits(api, range);
  const numbers = new Set();
  const direct = [];
  for (const commit of commits) {
    const number = prNumberFromMessage(commit.commit.message);
    if (number) {
      numbers.add(number);
      continue;
    }
    const pulls = (await api(`repos/${range.repo}/commits/${commit.sha}/pulls`)).filter(pull => pull.merged_at);
    pulls.forEach(pull => numbers.add(pull.number));
    if (!pulls.length && commit.parents.length < 2) direct.push(commitEntry(commit));
  }
  const pulls = [];
  for (const number of [...numbers].sort((a, b) => a - b)) pulls.push(pullEntry(await api(`repos/${range.repo}/pulls/${number}`)));
  return [...pulls, ...direct];
}

export async function listTags(api, repo) {
  const tags = [];
  for (let page = 1; ; page++) {
    const result = await api(`repos/${repo}/tags?per_page=${PAGE_SIZE}&page=${page}`);
    tags.push(...result.map(item => item.name));
    if (result.length < PAGE_SIZE) return tags;
  }
}

export async function buildReleaseNotes(api, { repo, tag, previous, ref, title, config }) {
  const head = ref || tag;
  const base = previous || previousTag(await listTags(api, repo), tag);
  if (!base) throw Error(`No earlier release tag than ${tag}; pass --previous.`);
  const entries = await collectEntries(api, { repo, base, head });
  return renderNotes({ title: title || `Carthagent ${tag.replace(/^v/, '')}`, repo, base, head, groups: groupEntries(entries, config) });
}

export function parseArgs(argv) {
  const options = { config: '.github/release.yml' };
  const names = { '--tag': 'tag', '--previous': 'previous', '--ref': 'ref', '--repo': 'repo', '--config': 'config', '--title': 'title', '--out': 'out' };
  for (let i = 0; i < argv.length; i++) {
    const name = names[argv[i]];
    if (name && argv[i + 1] !== undefined) options[name] = argv[++i];
    else if (!argv[i].startsWith('--') && !options.tag) options.tag = argv[i];
    else throw Error(`Unknown or incomplete option: ${argv[i]}\n${USAGE}`);
  }
  if (!options.tag) throw Error(`--tag is required.\n${USAGE}`);
  return options;
}

const execFileAsync = promisify(execFile);

async function ghApi(path) {
  const { stdout } = await execFileAsync('gh', ['api', '-H', 'Accept: application/vnd.github+json', path], { maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(stdout);
}

async function defaultRepo() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin']);
  const match = stdout.trim().match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (!match) throw Error('Cannot infer the GitHub repository; pass --repo owner/name.');
  return match[1];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = resolve(import.meta.dirname, '..');
  const config = parseReleaseConfig(readFileSync(resolve(root, options.config), 'utf8'));
  const notes = await buildReleaseNotes(ghApi, { ...options, repo: options.repo || (await defaultRepo()), config });
  if (options.out) {
    writeFileSync(options.out, notes);
    console.error(`Wrote ${options.out}`);
  } else process.stdout.write(notes);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => {
    console.error(error.stderr?.trim() || error.message);
    process.exitCode = 1;
  });
}
