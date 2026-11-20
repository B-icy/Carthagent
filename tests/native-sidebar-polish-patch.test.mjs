import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const published = read('docs/patches/opencode-v2.0.32-session-ui-combined-v18.patch');
const staged = read('docs/patches/opencode-v2.0.32-session-ui-combined-v20.patch');
const sections = patch => new Map(patch.split(/(?=^diff --git )/m).filter(Boolean).map(section => {
  const path = section.match(/^diff --git a\/(\S+) b\/\1\n/)?.[1];
  assert.ok(path);
  return [path, section.replace(/^index .*\n/gm, '')];
}));

test('v20 stays a staged record; v18 keeps its digest', () => {
  assert.equal(digest(published), '636e01c3da517c64a5f90fb1ea6a682a25fbcb2b63372a8fd2c32ec11fe706dd');
  const expected = digest(staged);
  assert.equal(expected, '335ef409841928fb34f6c8c0332eacb2c1b8dc90410835a8a6ae8dc6a8d367e0');
  assert.ok(read('docs/staged-native-sidebar-polish.md').includes(expected));
  assert.notEqual(JSON.parse(read('lib/opencode/runtime-release.json')).patchSha256, expected);
  // v21 carries every v20 change; v20 itself is never built.
  assert.ok(!read('script/ctg/build-owned-runtime.sh').includes('combined-v20.patch'));
  assert.ok(!read('.github/workflows/publish-owned-opencode-runtime.yml').includes('combined-v20.patch'));
});

test('v20 changes only the sidebar sources, plugin readiness and their tests', () => {
  const before = sections(published);
  const after = sections(staged);
  assert.deepEqual([...after.keys()], [...before.keys()]);
  const changed = [...after.keys()].filter(path => before.get(path) !== after.get(path));
  assert.deepEqual(changed, [
    'packages/tui/src/app.tsx',
    'packages/tui/src/component/session-tabs-folder.tsx',
    'packages/tui/src/component/session-tabs.tsx',
    'packages/tui/src/plugin/context.tsx',
    'packages/tui/test/navigation-rail.test.tsx',
    'packages/tui/test/sidebar/sidebar-hierarchy.test.tsx',
  ]);
});

test('v20 removes the separator overlays that drew through titles and keeps regressions covered', () => {
  const tabs = sections(staged).get('packages/tui/src/component/session-tabs.tsx');
  assert.ok(!/^\+.*edge="above"/m.test(tabs));
  assert.ok(!/^\+.*edge="below"/m.test(tabs));
  assert.match(tabs, /^\+.*scrollChildIntoView\(newTab\(\) \? "project-row-new"/m);
  const tests = sections(staged).get('packages/tui/test/sidebar/sidebar-hierarchy.test.tsx');
  for (const name of [
    'session titles render without separator glyphs',
    'collapsing and expanding a folder keeps the list where it was',
    'compact hover tooltip paints over the main pane without bleed-through',
    'short folder paths show in place without a tooltip',
    'opening on Home keeps the folders at the top until the user leaves the draft',
  ]) assert.ok(tests.includes(name), name);
  assert.match(tabs, /^\+.*if \(newTab\(\) && startedOnDraft && !leftDraft\) return/m);
});

test('v20 holds the rail until server plugin panes settle, without delaying the app', () => {
  const app = sections(staged).get('packages/tui/src/app.tsx');
  assert.match(app, /^\+.*<Show when=\{plugins\.settled\(\)\}/m);
  assert.match(app, /^\+.*id="navigation-placeholder"/m);
  const context = sections(staged).get('packages/tui/src/plugin/context.tsx');
  assert.match(context, /^\+.*\.finally\(loadInventory\)/m);
  assert.match(context, /^\+.*setTimeout\(loadInventory, 5_000\)/m);
  const rail = sections(staged).get('packages/tui/test/navigation-rail.test.tsx');
  assert.ok(rail.includes("a navigation pane from the server's plugin inventory appears with the first rail paint, not after it"));
});
