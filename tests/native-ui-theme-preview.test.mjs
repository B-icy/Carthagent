import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNativeThemePreview } from '../plugins/carthagent/src/ui/theme-preview.mjs';

test('theme preview renders a provisioned compatibility palette without host mutation', () => {
  const before = { name: 'paper', mode: 'light' };
  const preview = buildNativeThemePreview('carthage', before.mode);
  assert.deepEqual(before, { name: 'paper', mode: 'light' });
  assert.equal(preview.name, 'carthage');
  assert.equal(preview.mode, 'dark', 'dark-only themes fall back to their supported mode');
  assert.match(preview.background, /^#[a-f\d]{6}$/i);
  assert.match(preview.text, /^#[a-f\d]{6}$/i);
  assert.match(preview.accent, /^#[a-f\d]{6}$/i);
  assert.equal(preview.background, '#160e20', 'Carthage preview reads the palette actually provisioned to OpenCode');
  assert.equal(preview.accent, '#d5af66', 'Carthage preview matches its installed yellow accent');
  assert.match(preview.sample, /Plan → Verify/);
});

test('adaptive theme preview uses the requested supported light palette', () => {
  const preview = buildNativeThemePreview('solarized', 'light');
  assert.equal(preview.mode, 'light');
  assert.match(preview.background, /^#[a-f\d]{6}$/i);
});

test('unknown preview themes fail explicitly', () => {
  assert.throws(() => buildNativeThemePreview('missing'), /no preview palette/);
});
