import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  ['control-border', 'sunken'],
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
