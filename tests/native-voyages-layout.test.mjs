import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../plugins/carthagent/src/ui/voyages.tsx', import.meta.url), 'utf8');

test('Voyages keeps wrapping summary rows out of the action layout and exposes native profile scrolling', () => {
  assert.match(source, /<scrollbox ref=\{summary\} flexBasis=\{0\} flexGrow=\{1\} minHeight=\{1\}/);
  assert.match(source, /<select height=\{5\} flexShrink=\{0\}/);
  for (const text of source.matchAll(/<text\b([^>]*)>/g)) assert.match(text[1], /flexShrink=\{0\}/);
  assert.match(source, /<box flexDirection="column" flexShrink=\{0\}>/);
  assert.match(source, /bind: "ctrl\+u"[^\n]*summary\?\.scrollBy\(-1\)/);
  assert.match(source, /bind: "ctrl\+d"[^\n]*summary\?\.scrollBy\(1\)/);
  assert.doesNotMatch(source.slice(source.indexOf('context.keymap.layer'), source.indexOf('let activeDialog')), /mode: "global"/);
});

test('Voyages keeps profile progress, artwork and status in the scroll viewport with guarded keyboard actions', () => {
  const summary = source.slice(source.indexOf('<scrollbox'), source.indexOf('</scrollbox>'));
  for (const field of ['profile.name', 'profile.shipName', 'profile.coins', 'profile.level', 'profile.xpIntoLevel', 'profile.xpForLevel', 'profile.km', 'profile.config', 'VoyagesPreview', 'snapshot().pending', 'view().busy', 'view().error', 'view().notice']) {
    assert.ok(summary.includes(field), `${field} must remain readable in the scrolling summary`);
  }
  const choices = source.slice(source.indexOf('<select '));
  assert.match(choices, /name: "pageup", action: "move-up-fast"/);
  assert.match(choices, /name: "pagedown", action: "move-down-fast"/);
  assert.match(choices, /options=\{options\(\)\}/);
  assert.match(choices, /focused=\{enabled\(\)\}/);
  assert.match(source, /const enabled = \(\) => !view\(\).busy && !reconciling\(\) && context.keymap.mode.current\(\) === "base";/);
  assert.match(choices, /onSelect=\{\(_index, option\) => select\(option\?\.value\)\}/);
});

test('switching Character ↔ Shop starts on the first row and Esc in Shop returns to Character', () => {
  const switcher = source.slice(source.indexOf('const switchSection'), source.indexOf('const goBack'));
  assert.match(switcher, /memory\.reset\(\)/, 'the shared "section" row must not be restored on the other side');
  const goBack = source.slice(source.indexOf('const goBack'), source.indexOf('let summary'));
  assert.match(goBack, /props\.section === "equipment"\) \{ switchSection\("profile"\)/);
  assert.match(source, /if \(value === "section"\) \{ switchSection\(/);
});
