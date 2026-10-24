import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../plugins/carthagent/src/ui/voyages.tsx', import.meta.url), 'utf8');

test('Voyages keeps wrapping summary rows out of the action layout and exposes native profile scrolling', () => {
  assert.match(source, /<scrollbox ref=\{summary\} flexBasis=\{0\} flexGrow=\{1\} minHeight=\{1\}/);
  assert.match(source, /<select flexBasis=\{0\} flexGrow=\{1\} flexShrink=\{0\} minHeight=\{3\}/);
  for (const text of source.matchAll(/<text\b([^>]*)>/g)) assert.match(text[1], /flexShrink=\{0\}/);
  assert.match(source, /<box flexDirection="column" flexShrink=\{0\}>/);
  assert.match(source, /bind: "ctrl\+u"[^\n]*summary\?\.scrollBy\(-1\)/);
  assert.match(source, /bind: "ctrl\+d"[^\n]*summary\?\.scrollBy\(1\)/);
  assert.doesNotMatch(source.slice(source.indexOf('context.keymap.layer'), source.indexOf('let activeDialog')), /mode: "global"/);
});

test('Voyages retains keyboard navigation and every protected summary field inside the scroll viewport', () => {
  const summary = source.slice(source.indexOf('<scrollbox'), source.indexOf('</scrollbox>'));
  for (const field of ['profile.name', 'profile.shipName', 'profile.coins', 'profile.level', 'profile.totalXp', 'profile.km', 'profile.weeklyKm', 'profile.config.skin', 'profile.config.hairStyle', 'profile.config.bottoms', 'profile.config.hull', 'snapshot().pending', 'view().busy', 'view().error', 'view().notice']) {
    assert.ok(summary.includes(field), `${field} must remain readable in the scrolling summary`);
  }
  const choices = source.slice(source.indexOf('<select '));
  assert.match(choices, /name: "pageup", action: "move-up-fast"/);
  assert.match(choices, /name: "pagedown", action: "move-down-fast"/);
  assert.match(choices, /options=\{options\(\)\}/);
  assert.match(choices, /focused=\{context.keymap.mode.current\(\) === "base"\}/);
  assert.match(choices, /onSelect=\{\(_index, option\) => select\(option\?\.value\)\}/);
});
