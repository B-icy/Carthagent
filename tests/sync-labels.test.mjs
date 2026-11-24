import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { applyLabelPlan, computeLabelPlan, formatPlan, labelPath, listRepoLabels, normalizeColor, parseArgs, validateLabels } from '../tools/sync-labels.mjs';
import { parseGithubRepo } from '../tools/github-issues.mjs';

const desired = [
  { name: 'bug', color: 'd73a4a', description: "Something isn't working" },
  { name: 'priority: P0', color: 'B60205', description: 'Critical' },
  { name: 'area: ci', color: '5319e7', description: 'CI' },
  { name: 'Docs', color: '0075ca', description: 'Docs' },
];

test('plans creates, updates, unchanged and unmanaged labels without deleting', () => {
  const current = [
    { name: 'bug', color: 'd73a4a', description: "Something isn't working" },
    { name: 'area: ci', color: '000000', description: 'old' },
    { name: 'docs', color: '0075ca', description: 'Docs' },
    { name: 'wontfix', color: 'ffffff', description: 'This will not be worked on' },
  ];
  const plan = computeLabelPlan(desired, current);
  assert.deepEqual(plan.create, [{ name: 'priority: P0', color: 'b60205', description: 'Critical' }]);
  assert.deepEqual(plan.update, [
    { name: 'area: ci', changes: { color: '5319e7', description: 'CI' } },
    { name: 'docs', changes: { new_name: 'Docs' } },
  ]);
  assert.deepEqual(plan.unchanged, ['bug']);
  assert.deepEqual(plan.unmanaged, ['wontfix']);
});

test('treats a null description as empty and ignores color case and hash', () => {
  const plan = computeLabelPlan([{ name: 'x', color: '#ABCDEF' }], [{ name: 'x', color: 'abcdef', description: null }]);
  assert.deepEqual(plan.unchanged, ['x']);
  assert.equal(normalizeColor('#ABCDEF'), 'abcdef');
});

test('rejects duplicate, malformed and over-long labels', () => {
  assert.throws(() => validateLabels([]), /non-empty/);
  assert.throws(
    () =>
      validateLabels([
        { name: 'a', color: 'ffffff' },
        { name: 'A', color: 'ffffff' },
      ]),
    /Duplicate/,
  );
  assert.throws(() => validateLabels([{ name: 'a', color: 'fff' }]), /invalid color/);
  assert.throws(() => validateLabels([{ name: ' a', color: 'ffffff' }]), /Invalid label name/);
  assert.throws(() => validateLabels([{ name: 'a', color: 'ffffff', description: 'x'.repeat(101) }]), /exceeds/);
});

test('the committed labels.json is valid', () => {
  const file = JSON.parse(readFileSync(new URL('../.github/labels.json', import.meta.url), 'utf8'));
  assert.equal(validateLabels(file.labels).length, file.labels.length);
  for (const name of ['source: ci-alert', 'source: release-health', 'priority: P0', 'priority: P1', 'area: ci', 'area: release']) {
    assert.ok(
      file.labels.some(label => label.name === name),
      `${name} is required by the alert workflows`,
    );
  }
});

test('URL-encodes label names with spaces and colons', () => {
  assert.equal(labelPath('o/r', 'priority: P0'), 'repos/o/r/labels/priority%3A%20P0');
});

test('applies only creates and updates through the API runner', () => {
  const calls = [];
  const plan = computeLabelPlan(desired, [
    { name: 'bug', color: 'd73a4a', description: 'old' },
    { name: 'stale', color: 'ffffff' },
  ]);
  applyLabelPlan(plan, 'o/r', (method, path, body) => calls.push([method, path, body]));
  assert.deepEqual(
    calls.map(([method, path]) => `${method} ${path}`),
    ['POST repos/o/r/labels', 'POST repos/o/r/labels', 'POST repos/o/r/labels', 'PATCH repos/o/r/labels/bug'],
  );
  assert.ok(!calls.some(([method]) => method === 'DELETE'));
});

test('paginates label listing', () => {
  const pages = { 1: Array.from({ length: 100 }, (_, i) => ({ name: `l${i}` })), 2: [{ name: 'last' }] };
  const labels = listRepoLabels('o/r', (method, path) => pages[Number(path.match(/[?&]page=(\d+)/)[1])]);
  assert.equal(labels.length, 101);
});

test('formats a readable plan and parses arguments', () => {
  const text = formatPlan(computeLabelPlan(desired, [{ name: 'wontfix', color: 'ffffff' }]), { repo: 'o/r' });
  assert.match(text, /dry run/);
  assert.match(text, /create {5}priority: P0/);
  assert.match(text, /unmanaged {2}wontfix/);
  assert.deepEqual(parseArgs(['--apply', '--repo', 'o/r']).repo, 'o/r');
  assert.throws(() => parseArgs(['--repo', 'nope']), /owner\/name/);
  assert.throws(() => parseArgs(['--delete']), /Unknown argument/);
});

test('parses GitHub remotes including SSH host aliases', () => {
  assert.equal(parseGithubRepo('git@github-carthagent:B-icy/Carthagent.git'), 'B-icy/Carthagent');
  assert.equal(parseGithubRepo('https://github.com/B-icy/Carthagent.git'), 'B-icy/Carthagent');
  assert.equal(parseGithubRepo('https://github.com/B-icy/Carthagent'), 'B-icy/Carthagent');
  assert.equal(parseGithubRepo('not a remote'), null);
});
