import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { uiChromeGlyph } = await jiti.import('../plugins/carthagent/src/ui/chrome.ts');

test('native plugin chrome honors the host-resolved ASCII or Unicode mode', () => {
  assert.equal(uiChromeGlyph('edge', { CTG_TUI_GLYPHS: 'ascii' }), '->');
  assert.equal(uiChromeGlyph('refresh', { CTG_TUI_GLYPHS: 'ascii' }), 'R');
  assert.equal(uiChromeGlyph('edge', { CTG_TUI_GLYPHS: 'unicode' }), '→');
  assert.equal(uiChromeGlyph('refresh', { CTG_TUI_GLYPHS: 'unicode' }), '↻');
  assert.equal(uiChromeGlyph('separator', { CTG_TUI_GLYPHS: 'ascii' }), '|');
  assert.equal(uiChromeGlyph('separator', { CTG_TUI_GLYPHS: 'unicode' }), '·');
});

test('unknown glyph names are never substituted into arbitrary dynamic text', () => {
  assert.equal(uiChromeGlyph('project', { CTG_TUI_GLYPHS: 'ascii' }), '*');
  assert.equal(uiChromeGlyph('project', { CTG_TUI_GLYPHS: 'unicode' }), '◆');
});
