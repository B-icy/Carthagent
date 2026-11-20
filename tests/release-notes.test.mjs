import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  buildReleaseNotes,
  categorize,
  cleanTitle,
  collectEntries,
  groupEntries,
  inferLabels,
  parseArgs,
  parseReleaseConfig,
  parseYamlSubset,
  previousTag,
  prNumberFromMessage,
  renderNotes,
} from '../tools/release-notes.mjs';

const CONFIG = parseReleaseConfig(readFileSync(new URL('../.github/release.yml', import.meta.url), 'utf8'));
const pr = (number, title, labels = [], author = 'alice') => ({ kind: 'pr', number, title, url: `https://github.com/o/r/pull/${number}`, author, labels });

test('the repository release.yml parses into GitHub changelog categories', () => {
  assert.deepEqual(CONFIG.exclude, { labels: ['release-notes: skip'], authors: ['dependabot[bot]'] });
  assert.deepEqual(
    CONFIG.categories.map(category => [category.title, category.labels]),
    [
      ['Breaking changes', ['breaking-change']],
      ['Security', ['security']],
      ['Features', ['enhancement']],
      ['Fixes', ['bug']],
      ['Performance', ['performance']],
      ['Documentation', ['documentation']],
      ['Dependencies', ['dependencies']],
      ['Other changes', ['*']],
    ],
  );
});

test('the YAML subset handles block lists, flow lists, quotes and comments', () => {
  const parsed = parseYamlSubset(
    [
      '# comment',
      'changelog:',
      '  exclude:',
      '    labels:',
      "    - 'skip # me'",
      '    - other',
      '  categories:',
      '  - title: "Fixes: all"  # trailing',
      '    labels: [bug, "it\'s"]',
      '    exclude:',
      '      authors: [bot]',
    ].join('\n'),
  );
  assert.deepEqual(parsed, {
    changelog: {
      exclude: { labels: ['skip # me', 'other'] },
      categories: [{ title: 'Fixes: all', labels: ['bug', "it's"], exclude: { authors: ['bot'] } }],
    },
  });
});

test('pull request numbers come from merge and squash commit subjects', () => {
  assert.equal(prNumberFromMessage('Merge pull request #253 from B-icy/folder-navigation\n\nbody'), 253);
  assert.equal(prNumberFromMessage('Rename provider id (#255)'), 255);
  assert.equal(prNumberFromMessage('Revert "x (#10)" (#12)'), 12);
  assert.equal(prNumberFromMessage('fix: no pull request\n\nSee (#99)'), null);
  assert.equal(cleanTitle('Rename provider id (#255)\n\nbody'), 'Rename provider id');
});

test('conventional prefixes infer labels for unlabeled changes', () => {
  assert.deepEqual(inferLabels('feat(cli): add flags'), ['enhancement']);
  assert.deepEqual(inferLabels('fix!: drop legacy path'), ['breaking-change', 'bug']);
  assert.deepEqual(inferLabels('chore(deps): bump x'), ['dependencies', 'chore']);
  assert.deepEqual(inferLabels('release: Carthagent 1.1.2'), ['area: release']);
  assert.deepEqual(inferLabels('Fix picker focus'), ['bug']);
  assert.deepEqual(inferLabels('VOY-02: open the hub'), []);
  assert.deepEqual(inferLabels('/goal: keep working'), []);
});

test('labels win over title prefixes, and wildcard is the last resort', () => {
  assert.equal(categorize(pr(1, 'fix: crash', ['security']), CONFIG), 'Security');
  assert.equal(categorize(pr(2, 'fix: crash', ['area: cli']), CONFIG), 'Fixes');
  assert.equal(categorize(pr(3, 'perf: faster', []), CONFIG), 'Performance');
  assert.equal(categorize(pr(4, 'Polish login', ['area: cli']), CONFIG), 'Other changes');
  const noWildcard = { ...CONFIG, categories: CONFIG.categories.filter(category => !category.labels.includes('*')) };
  assert.equal(categorize(pr(5, 'Polish login'), noWildcard), 'Other changes');
});

test('grouping follows release.yml order and honors exclusions', () => {
  const groups = groupEntries(
    [
      pr(1, 'Polish login'),
      pr(2, 'fix: crash', [], 'bob'),
      pr(3, 'feat: new', ['enhancement']),
      pr(4, 'bump', ['dependencies'], 'dependabot[bot]'),
      pr(5, 'internal', ['release-notes: skip']),
      pr(6, 'BREAKING', ['breaking-change', 'bug']),
    ],
    CONFIG,
  );
  assert.deepEqual(
    groups.map(group => [group.title, group.entries.map(entry => entry.number)]),
    [
      ['Breaking changes', [6]],
      ['Features', [3]],
      ['Fixes', [2]],
      ['Other changes', [1]],
    ],
  );
});

test('rendered notes link PRs and commits and list contributors', () => {
  const groups = groupEntries(
    [
      pr(7, 'fix: crash', [], 'Zed'),
      pr(8, 'feat: x', [], 'renovate[bot]'),
      { kind: 'commit', sha: 'abcdef1234', title: 'release: 1.2.0', url: 'https://github.com/o/r/commit/abcdef1234', author: 'alice', labels: [] },
    ],
    CONFIG,
  );
  const notes = renderNotes({ title: 'Carthagent 1.2.0', repo: 'o/r', base: 'v1.1.0', head: 'v1.2.0', groups });
  assert.match(notes, /^# Carthagent 1\.2\.0\n/);
  assert.match(notes, /from 2 pull request\(s\) and 1 direct commit\(s\) in v1\.1\.0\.\.\.v1\.2\.0/);
  assert.match(notes, /## Fixes\n\n- fix: crash \(\[#7\]\(https:\/\/github\.com\/o\/r\/pull\/7\)\) by @Zed/);
  assert.match(notes, /- release: 1\.2\.0 \(\[abcdef1\]\(https:\/\/github\.com\/o\/r\/commit\/abcdef1234\)\) by @alice/);
  assert.match(notes, /## Contributors\n\n@alice, @Zed\n/);
  assert.match(notes, /\*\*Full changelog\*\*: https:\/\/github\.com\/o\/r\/compare\/v1\.1\.0\.\.\.v1\.2\.0\n$/);
});

test('previous tag selection follows semver and skips prereleases for stable tags', () => {
  const tags = ['v1.1.3', 'v1.1.2', 'v1.1.1', 'v1.1.0', 'v1.1.0-beta.8', 'v1.1.0-beta.10', 'v1.0.9', 'nightly'];
  assert.equal(previousTag(tags, 'v1.1.2'), 'v1.1.1');
  assert.equal(previousTag(tags, 'v1.1.0'), 'v1.0.9');
  assert.equal(previousTag(tags, 'v1.1.0-beta.11'), 'v1.1.0-beta.10');
  assert.equal(previousTag(tags, 'v1.1.0-rc.1'), 'v1.1.0-beta.10');
  assert.equal(previousTag(['v2.0.0'], 'v1.0.0'), null);
  assert.throws(() => previousTag(tags, 'main'), /pass --previous/);
});

function fakeApi(routes) {
  const calls = [];
  const api = async path => {
    calls.push(path);
    const key = Object.keys(routes).find(prefix => path.startsWith(prefix));
    if (!key) throw Error(`Unexpected API path ${path}`);
    return typeof routes[key] === 'function' ? routes[key](path) : routes[key];
  };
  return { api, calls };
}

const commit = (sha, message, parents = 1, login = 'alice') => ({
  sha,
  commit: { message },
  parents: Array.from({ length: parents }, () => ({})),
  author: { login },
  html_url: `https://github.com/o/r/commit/${sha}`,
});

const ROUTES = {
  'repos/o/r/tags': [{ name: 'v1.1.0' }, { name: 'v1.0.0' }],
  'repos/o/r/compare/v1.0.0...v1.1.0': {
    total_commits: 5,
    commits: [
      commit('a1', 'Merge pull request #10 from o/feature'),
      commit('b2', 'fix: crash (#11)'),
      commit('c3', 'branch work without a number'),
      commit('d4', 'release: 1.1.0', 1, 'carol'),
      commit('e5', 'Merge branch main', 2),
    ],
  },
  'repos/o/r/commits/c3/pulls': [{ number: 10, merged_at: '2026-01-01' }],
  'repos/o/r/commits/d4/pulls': [{ number: 99, merged_at: null }],
  'repos/o/r/commits/e5/pulls': [],
  'repos/o/r/pulls/10': {
    number: 10,
    title: 'Add flags',
    html_url: 'https://github.com/o/r/pull/10',
    user: { login: 'bob' },
    labels: [{ name: 'enhancement' }],
  },
  'repos/o/r/pulls/11': { number: 11, title: 'fix: crash (#11)', html_url: 'https://github.com/o/r/pull/11', user: { login: 'alice' }, labels: [] },
};

test('commits map to merged PRs; direct non-merge commits are kept', async () => {
  const { api } = fakeApi(ROUTES);
  const entries = await collectEntries(api, { repo: 'o/r', base: 'v1.0.0', head: 'v1.1.0' });
  assert.deepEqual(
    entries.map(entry => `${entry.kind}:${entry.number ?? entry.sha}:${entry.title}:${entry.author}:${entry.labels.join('|')}`),
    ['pr:10:Add flags:bob:enhancement', 'pr:11:fix: crash:alice:', 'commit:d4:release: 1.1.0:carol:'],
  );
});

test('compare results are paginated until total_commits is reached', async () => {
  const many = Array.from({ length: 100 }, (_, i) => commit(`p${i}`, `chore: step ${i} (#${i + 1})`));
  const { api, calls } = fakeApi({
    'repos/o/r/compare/a...b?per_page=100&page=1': { total_commits: 101, commits: many },
    'repos/o/r/compare/a...b?per_page=100&page=2': { total_commits: 101, commits: [commit('last', 'docs: tail (#200)')] },
    'repos/o/r/pulls/': path => ({ number: Number(path.split('/').at(-1)), title: 'x', html_url: 'u', user: { login: 'a' }, labels: [] }),
  });
  const entries = await collectEntries(api, { repo: 'o/r', base: 'a', head: 'b' });
  assert.equal(entries.length, 101);
  assert.equal(calls.filter(path => path.includes('/compare/')).length, 2);
});

test('buildReleaseNotes infers the previous tag and renders a draft', async () => {
  const { api } = fakeApi(ROUTES);
  const notes = await buildReleaseNotes(api, { repo: 'o/r', tag: 'v1.1.0', config: CONFIG });
  assert.match(notes, /^# Carthagent 1\.1\.0/);
  assert.match(notes, /## Features\n\n- Add flags \(\[#10\]/);
  assert.match(notes, /## Fixes\n\n- fix: crash \(\[#11\]/);
  assert.match(notes, /## Other changes\n\n- release: 1\.1\.0 \(\[d4\]/);
  assert.match(notes, /@alice, @bob, @carol/);
});

test('CLI arguments accept a positional tag and reject unknown options', () => {
  assert.deepEqual(parseArgs(['v1.2.0', '--previous', 'v1.1.0', '--out', 'x.md']), {
    config: '.github/release.yml',
    tag: 'v1.2.0',
    previous: 'v1.1.0',
    out: 'x.md',
  });
  assert.throws(() => parseArgs(['--bogus']), /Unknown or incomplete option/);
  assert.throws(() => parseArgs(['--previous', 'v1']), /--tag is required/);
});
