import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const baseline = read('docs/patches/opencode-v2.0.32-session-ui-combined-v17.patch');
const candidate = read('docs/patches/opencode-v2.0.32-session-ui-combined-v18.patch');

test('v18 is the published runtime patch and v17 stays frozen', () => {
  assert.equal(digest(baseline), 'e4fe6ee137d27fbc279c33e169725292e7bff1151a1fea2d8b23cb1f16664d57');
  const expected = digest(candidate);
  assert.equal(expected, '636e01c3da517c64a5f90fb1ea6a682a25fbcb2b63372a8fd2c32ec11fe706dd');
  assert.ok(read('docs/staged-native-test-followup.md').includes(expected));
  assert.ok(read('script/ctg/build-owned-runtime.sh').includes('combined-v18.patch'));
  assert.ok(read('.github/workflows/publish-owned-opencode-runtime.yml').includes('combined-v18.patch'));
  assert.equal(JSON.parse(read('lib/opencode/runtime-release.json')).patchSha256, expected);
});

test('v18 changes only seven separator expectations in two native tests', () => {
  const sections = patch =>
    new Map(
      patch
        .split(/(?=^diff --git )/m)
        .filter(Boolean)
        .map(section => {
          const path = section.match(/^diff --git a\/(\S+) b\/\1\n/)?.[1];
          assert.ok(path);
          return [path, section.replace(/^index .*\n/gm, '')];
        }),
    );
  const before = sections(baseline);
  const after = sections(candidate);
  assert.deepEqual([...after.keys()], [...before.keys()]);
  const changed = [...after.keys()].filter(path => before.get(path) !== after.get(path));
  assert.deepEqual(changed, ['packages/tui/test/app-lifecycle.test.tsx', 'packages/tui/test/session-panel.test.tsx']);
  const replacements = [
    ['Build · Model Provider', 'Build · Model · Provider'],
    ['Build · Remote Model Provider', 'Build · Remote Model · Provider'],
    ['Build · Source Model Provider', 'Build · Source Model · Provider'],
    ['Build · Target Model provider', 'Build · Target Model · provider'],
    ['Build · Target Model Provider', 'Build · Target Model · Provider'],
    ['Build · Model Fixture', 'Build · Model · Fixture'],
  ];
  let count = 0;
  for (const path of changed) {
    const expected = before
      .get(path)
      .split('\n')
      .map(line => {
        // Removed lines describe pristine upstream, not the candidate source.
        if (!line.startsWith('+') || line.startsWith('+++')) return line;
        for (const [oldLabel, newLabel] of replacements) {
          count += line.split(oldLabel).length - 1;
          line = line.replaceAll(oldLabel, newLabel);
        }
        return line;
      })
      .join('\n');
    assert.equal(after.get(path), expected, `${path}: no assertion, timing, or behavior changes beyond the separator`);
  }
  assert.equal(count, 7);
});
