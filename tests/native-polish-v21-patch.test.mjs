import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CTG_DEVELOPMENT_RUNTIME_PATCH_SHA256, CTG_RUNTIME_PATCH_SHA256 } from '../lib/opencode/runtime.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const v20 = read('docs/patches/opencode-v2.0.32-session-ui-combined-v20.patch');
const v21 = read('docs/patches/opencode-v2.0.32-session-ui-combined-v21.patch');
const sections = patch =>
  new Map(
    patch
      .split(/(?=^diff --git )/m)
      .filter(Boolean)
      .map(section => {
        const path = section.match(/^diff --git a\/(\S+) b\/\1\n/)?.[1];
        assert.ok(path?.startsWith('packages/') && !path.split('/').includes('..'), `unsafe path: ${path}`);
        return [path, section.replace(/^index .*\n/gm, '')];
      }),
  );
const added = (patch, path) =>
  sections(patch)
    .get(path)
    .split('\n')
    .filter(line => line.startsWith('+') && !line.startsWith('+++'))
    .join('\n');

test('v21 is the published 1.1.3 runtime patch', () => {
  const expected = digest(v21);
  assert.equal(expected, '9a73eb1ded4d9914a554640226949d53caca986ef8b846ef8592fe75a9a1bf92');
  assert.ok(read('docs/staged-native-polish-v21.md').includes(expected));
  assert.ok(read('docs/release-preparation-1.1.3.md').includes(expected));
  assert.equal(expected, CTG_RUNTIME_PATCH_SHA256);
  assert.notEqual(expected, CTG_DEVELOPMENT_RUNTIME_PATCH_SHA256);
  assert.equal(JSON.parse(read('lib/opencode/runtime-release.json')).patchSha256, expected);
});

test('v21 keeps every v20 section and changes only the reviewed paths', () => {
  const before = sections(v20);
  const after = sections(v21);
  assert.deepEqual(
    [...after.keys()].filter(path => before.has(path)),
    [...before.keys()],
  );
  const changed = [...before.keys()].filter(path => before.get(path) !== after.get(path)).sort();
  assert.deepEqual(changed, [
    'packages/tui/src/app.tsx',
    'packages/tui/src/component/prompt/autocomplete.tsx',
    'packages/tui/src/component/session-tabs.tsx',
    'packages/tui/src/plugin/runtime-plugin-support.bun.ts',
    'packages/tui/src/prompt/slash-options.ts',
    'packages/tui/src/ui/layout.ts',
    'packages/tui/src/ui/pane-resize-handle.tsx',
    'packages/tui/test/navigation-rail.test.tsx',
    'packages/tui/test/plugin-keymap.test.tsx',
    'packages/tui/test/prompt/slash-options.test.ts',
    'packages/tui/test/ui/layout.test.ts',
  ]);
  const extra = [...after.keys()].filter(path => !before.has(path));
  const created = extra.filter(path => /^new file mode /m.test(after.get(path))).sort();
  assert.deepEqual(created, [
    'packages/tui/src/plugin/transform-cache.ts',
    'packages/tui/src/util/theme-mode.ts',
    'packages/tui/test/component/session-tabs-title.test.tsx',
    'packages/tui/test/plugin/transform-cache.test.ts',
    'packages/tui/test/util/theme-mode.test.ts',
  ]);
  // Upstream files that earlier patches left untouched.
  assert.deepEqual(extra.filter(path => !created.includes(path)).sort(), [
    'packages/tui/src/util/path-format.ts',
    'packages/tui/test/ui/pane-resize-handle.test.tsx',
    'packages/tui/test/util/path-format.test.ts',
  ]);
});

test('v21 ends long titles in an ellipsis, uses the real home and runs twin commands on one Enter', () => {
  const tabs = added(v21, 'packages/tui/src/component/session-tabs.tsx');
  assert.match(tabs, /Locale\.truncateWidth\(title\(\), titleWidth\(\), chromeEllipsis\(\)\)/);
  assert.match(tabs, /stringWidth\(tooltipTitle\(sessionID\)\) > rowTitleWidth\(true\)/);
  const titles = added(v21, 'packages/tui/test/component/session-tabs-title.test.tsx');
  for (const name of [
    'a long vertical tab title ends in an ellipsis instead of being cut',
    'hovering a long title keeps the row still and reveals the full title beside the rail',
    'hovering a title that fits shows no tooltip',
  ])
    assert.ok(titles.includes(name), name);
  assert.match(added(v21, 'packages/tui/src/util/path-format.ts'), /value = process\.env\.CTG_USER_HOME/);
  assert.match(added(v21, 'packages/tui/src/app.tsx'), /home: userHome\(global\.home\)/);
  assert.match(read('lib/opencode/runtime.mjs'), /CTG_USER_HOME: inherited\.CTG_USER_HOME && path\.isAbsolute/);
  assert.match(added(v21, 'packages/tui/src/prompt/slash-options.ts'), /else if \(twins\(current, slash\)\)/);
  assert.ok(
    added(v21, 'packages/tui/test/plugin-keymap.test.tsx').includes(
      'one Enter on a submit-twin alias runs the command, and a typed submission still dispatches',
    ),
  );
});

test('v21 clamps a dragged rail and stops the drag release from clicking through', () => {
  assert.match(added(v21, 'packages/tui/src/ui/layout.ts'), /export function clampNavigationRailWidth\(width: number, total: number\)/);
  assert.match(added(v21, 'packages/tui/src/app.tsx'), /clampNavigationRailWidth\(width, dimensions\(\)\.width\)/);
  const handle = added(v21, 'packages/tui/src/ui/pane-resize-handle.tsx');
  assert.match(handle, /id="pane-resize-shield"/);
  assert.match(handle, /container\.zIndex = 10_000/);
  assert.match(handle, /queueMicrotask\(/);
  // Hit testing reads the last drawn frame, so removing the shield must draw one before the next press.
  assert.match(handle, /setShielded\(false\)\n\s*(\+\s*\/\/.*\n\s*)*\+\s*renderer\.intermediateRender\(\)/);
  assert.ok(
    added(v21, 'packages/tui/test/navigation-rail.test.tsx').includes(
      'dragging the rail divider past the page stops at the widest rail that fits, clicks nothing and releases the highlight',
    ),
  );
  assert.ok(added(v21, 'packages/tui/test/ui/pane-resize-handle.test.tsx').includes('a press right after a resize reaches the content under the pointer'));
});

test('v21 caches plugin transforms only in release builds and bounds the theme wait', () => {
  const support = added(v21, 'packages/tui/src/plugin/runtime-plugin-support.bun.ts');
  assert.match(support, /if \(typeof OPENCODE_VERSION !== "string"\) return undefined/);
  assert.match(support, /salt: \[OPENCODE_VERSION, process\.execPath, executable\.size, executable\.mtimeMs\]/);
  const cache = added(v21, 'packages/tui/src/plugin/transform-cache.ts');
  assert.match(cache, /await rename\(temporary, entry\)/);
  assert.match(cache, /after\.equals\(source\)/);
  const cacheTests = added(v21, 'packages/tui/test/plugin/transform-cache.test.ts');
  for (const name of [
    'changed bytes or a different transformer build never reuse an entry',
    'an unreadable or corrupt entry falls back to the transform and is repaired',
    'a cached Solid transform is byte-identical to a fresh one',
  ])
    assert.ok(cacheTests.includes(name), name);
  assert.match(added(v21, 'packages/tui/src/util/theme-mode.ts'), /export const THEME_MODE_WAIT_MS = 300/);
});
