import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEMES, flattenTheme, detectTermMode } from '../lib/tui/theme.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'public', 'index.html'), 'utf8');

const TOKENS = [
  'bg', 'chrome', 'panel', 'panel-2', 'sunken',
  'border', 'border-strong', 'border-hover', 'control-border',
  'text', 'muted', 'faint', 'code',
  'accent', 'accent-ink', 'accent-bg', 'hover-bg',
  'success', 'warning', 'error',
];

// Normal text (AA 4.5:1): role color -> the surfaces it renders on.
const TEXT_PAIRS = [
  ['text', 'bg'], ['text', 'panel'], ['text', 'panel-2'], ['text', 'sunken'], ['text', 'chrome'],
  ['muted', 'bg'], ['muted', 'panel'], ['muted', 'sunken'], ['muted', 'chrome'],
  ['faint', 'bg'], ['faint', 'panel'], ['faint', 'chrome'],
  ['code', 'sunken'], ['code', 'panel'],
  ['accent', 'bg'], ['accent', 'panel'], ['accent', 'panel-2'], ['accent', 'chrome'], ['accent', 'accent-bg'],
  ['accent-ink', 'accent'],
  ['success', 'panel'], ['success', 'sunken'],
  ['warning', 'panel'], ['warning', 'sunken'],
  ['error', 'panel'], ['error', 'sunken'], ['error', 'panel-2'],
];

// Non-text UI elements (AA 3:1): control outlines, status dots, nav underline.
const UI_PAIRS = [
  ['control-border', 'sunken'], ['control-border', 'panel'],
  ['success', 'chrome'], ['warning', 'chrome'], ['error', 'chrome'],
];

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a, b) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

// Collect theme blocks: ':root, [data-theme="x"] { --token: #hex; ... }'.
const themes = {};
for (const match of html.matchAll(/([^{}]+)\{([^}]*--[a-z-]+\s*:[^}]*)\}/g)) {
  const [, selector, body] = match;
  const vars = {};
  for (const decl of body.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) vars[decl[1]] = decl[2].toLowerCase();
  for (const name of selector.split(',').map(s => s.trim())) {
    const theme = name === ':root' ? 'obsidian' : name.match(/^\[data-theme="([^"]+)"\]$/)?.[1];
    if (theme) themes[theme] = { ...themes[theme], ...vars };
  }
}

test('every theme picker option has a matching theme block', () => {
  const options = [...html.matchAll(/<option value="([^"]+)"/g)].map(m => m[1]).filter(v => v !== 'system');
  assert.deepEqual(options.sort(), Object.keys(themes).sort());
});

for (const [name, vars] of Object.entries(themes)) {
  test(`theme "${name}" defines the full token set`, () => {
    const missing = TOKENS.filter(t => !vars[`--${t}`]);
    assert.deepEqual(missing, []);
  });

  test(`theme "${name}" meets WCAG AA contrast`, () => {
    const failures = [];
    for (const [fg, bg] of TEXT_PAIRS) {
      const r = contrast(vars[`--${fg}`], vars[`--${bg}`]);
      if (r < 4.5) failures.push(`${fg}/${bg} = ${r.toFixed(2)}`);
    }
    for (const [fg, bg] of UI_PAIRS) {
      const r = contrast(vars[`--${fg}`], vars[`--${bg}`]);
      if (r < 3.0) failures.push(`${fg}/${bg} = ${r.toFixed(2)} (UI)`);
    }
    assert.deepEqual(failures, []);
  });
}

// ---------------------------------------------------------------- TUI

// Normal text (AA 4.5:1) for the TUI token set.
const TUI_TEXT_PAIRS = [
  ['text', 'background'], ['text', 'backgroundPanel'], ['text', 'backgroundElement'],
  ['textMuted', 'background'], ['textMuted', 'backgroundPanel'], ['textMuted', 'backgroundElement'],
  ['primary', 'backgroundPanel'], ['secondary', 'backgroundPanel'], ['accent', 'backgroundPanel'],
  ['info', 'backgroundPanel'], ['error', 'backgroundPanel'], ['warning', 'backgroundPanel'],
  ['success', 'backgroundPanel'],
  ['markdownText', 'backgroundPanel'], ['markdownBlockQuote', 'backgroundPanel'],
  ['markdownCode', 'backgroundPanel'], ['markdownCodeBlock', 'backgroundPanel'],
  ['markdownLink', 'backgroundPanel'], ['markdownLinkText', 'backgroundPanel'],
  ['markdownEmph', 'backgroundPanel'], ['markdownHeading', 'backgroundPanel'],
  ['markdownStrong', 'backgroundPanel'],
  ['syntaxComment', 'background'], ['syntaxKeyword', 'background'],
  ['syntaxFunction', 'background'], ['syntaxVariable', 'background'],
  ['syntaxString', 'background'], ['syntaxNumber', 'background'],
  ['syntaxType', 'background'], ['syntaxOperator', 'background'],
  ['syntaxPunctuation', 'background'],
  ['diffAdded', 'diffAddedBg'], ['diffRemoved', 'diffRemovedBg'],
  ['diffContext', 'diffContextBg'], ['diffHunkHeader', 'backgroundPanel'],
  ['diffHighlightAdded', 'diffAddedBg'], ['diffHighlightRemoved', 'diffRemovedBg'],
  ['diffLineNumber', 'diffAddedLineNumberBg'], ['diffLineNumber', 'diffRemovedLineNumberBg'],
];

// Non-text UI elements (AA 3:1): focused-pane border.
const TUI_UI_PAIRS = [['borderActive', 'backgroundPanel']];

// Decorative separators: visible but intentionally subtle.
const TUI_DECO_PAIRS = [
  ['border', 'backgroundPanel'],
  ['borderSubtle', 'backgroundPanel'],
  ['markdownHorizontalRule', 'backgroundPanel'],
];

for (const [name, raw] of Object.entries(THEMES)) {
  for (const mode of ['dark', 'light']) {
    test(`tui theme "${name}" (${mode}) meets WCAG AA contrast`, () => {
      const t = flattenTheme(raw, mode);
      const failures = [];
      for (const [fgC, bgC] of TUI_TEXT_PAIRS) {
        if (t[fgC] === 'none' || t[bgC] === 'none') continue;
        const r = contrast(t[fgC], t[bgC]);
        if (r < 4.5) failures.push(`${fgC}/${bgC} = ${r.toFixed(2)}`);
      }
      for (const [fgC, bgC] of TUI_UI_PAIRS) {
        const r = contrast(t[fgC], t[bgC]);
        if (r < 3.0) failures.push(`${fgC}/${bgC} = ${r.toFixed(2)} (UI)`);
      }
      for (const [fgC, bgC] of TUI_DECO_PAIRS) {
        const r = contrast(t[fgC], t[bgC]);
        if (r < 1.2) failures.push(`${fgC}/${bgC} = ${r.toFixed(2)} (deco)`);
      }
      assert.deepEqual(failures, []);
    });
  }
}

test('detectTermMode reads COLORFGBG / PI2_THEME_MODE', () => {
  assert.equal(detectTermMode({}), 'dark');
  assert.equal(detectTermMode({ COLORFGBG: '15;0' }), 'dark');
  assert.equal(detectTermMode({ COLORFGBG: '0;15' }), 'light');
  assert.equal(detectTermMode({ COLORFGBG: '0;7' }), 'light');
  assert.equal(detectTermMode({ COLORFGBG: '0;15', PI2_THEME_MODE: 'dark' }), 'dark');
});

// Light themes: the d2 graph renderer uses the plain panel as the node fill
// (state carried by the border). Verify that text/label/glyph colors have
// ≥4.5:1 contrast against the panel — the surface text actually renders on.
for (const name of ['paper', 'daylight', 'solarized-light', 'contrast-light', 'okabe-light']) {
  test(`tui light theme "${name}" text is readable on the panel fill`, () => {
    const t = flattenTheme(THEMES[name], 'light');
    const panelBg = t.backgroundPanel || t.background;
    const ok = t.diffAdded || t.success;
    const err = t.diffRemoved || t.error;
    const warn = t.warning;
    const accent = t.primary || t.accent;
    const pairs = [
      [t.text, panelBg], [t.textMuted, panelBg],
      [ok, panelBg], [err, panelBg], [warn, panelBg], [accent, panelBg],
      [t.borderActive, panelBg],
    ];
    for (const [fg, bg] of pairs) {
      const r = contrast(fg, bg);
      assert.ok(r >= 4.5, `${fg} on ${bg} = ${r.toFixed(2)} < 4.5`);
    }
  });
}
