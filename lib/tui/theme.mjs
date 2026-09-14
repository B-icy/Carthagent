/** pi2 theme palettes — opencode token set, Node-only, zero dependencies.
 *
 * Token model ripped from opencode's theme.json schema (extracted from the
 * opencode 1.18.30 binary): primary/secondary/accent, error/warning/success/
 * info, text/textMuted, background/backgroundPanel/backgroundElement,
 * border/borderActive/borderSubtle, diff*, markdown*, syntax*.
 *
 * Resolution: { dark, light } objects pick by mode ('dark' default);
 * plain hex strings and "none" (terminal default) pass through; bare names
 * resolve against `defs`. Legacy pi2 keys (accent, muted, faint, ok, warn,
 * err, info, grad, panelBg, userChip, borderHot, accent2, hot) are derived
 * so existing render code keeps working during migration.
 */
import { fg, bg, mix, gradient, paint, BOLD, DIM, ITALIC, UNDERLINE, RESET } from './ansi.mjs';

export const DEFAULT_MODE = 'dark';

/** Resolve one token value: hex, "none", def-name, or {dark,light}. */
export function resolveToken(value, defs, mode = DEFAULT_MODE) {
  if (value == null) return null;
  if (typeof value === 'object') {
    const v = value[mode] ?? value.dark ?? value.light;
    return resolveToken(v, defs, mode);
  }
  const s = String(value);
  if (s === 'none') return 'none';
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return s.length === 4
    ? '#' + [...s.slice(1)].map(c => c + c).join('')
    : s.slice(0, 7);
  if (/^\d{1,3}$/.test(s)) return s; // ansi 256 index passthrough
  if (defs && defs[s] != null) return resolveToken(defs[s], defs, mode);
  return s;
}

/** Flatten a raw {defs, theme} theme into plain hex tokens for a mode. */
export function flattenTheme(raw, mode = DEFAULT_MODE) {
  const defs = raw.defs || {};
  const flat = {};
  for (const [k, v] of Object.entries(raw.theme || {})) {
    flat[k] = resolveToken(v, defs, mode);
  }
  // Legacy pi2 aliases so existing render code keeps working.
  flat.accent ??= flat.primary;
  flat.accent2 ??= flat.secondary;
  flat.hot ??= flat.accent;
  flat.muted ??= flat.textMuted;
  flat.faint ??= flat.textMuted;
  flat.ok ??= flat.success;
  flat.warn ??= flat.warning;
  flat.err ??= flat.error;
  flat.info ??= flat.info ?? flat.primary;
  flat.borderHot ??= flat.borderActive;
  flat.grad ??= [flat.primary, flat.accent, flat.secondary].filter(Boolean);
  flat.panelBg ??= flat.backgroundPanel;
  flat.userChip ??= flat.backgroundElement;
  flat.label = raw.label || flat.label;
  return flat;
}

const OPENCODE_DEFS = {
  darkBg: '#0f0f0f',
  darkBgPanel: '#15141b',
  darkBorder: '#2d2d2d',
  darkFgMuted: '#6d6d6d',
  darkFg: '#edecee',
  purple: '#a277ff',
  pink: '#f694ff',
  blue: '#82e2ff',
  red: '#ff6767',
  orange: '#ffca85',
  cyan: '#61ffca',
  green: '#9dff65',
};

const OPENCODE_THEME = {
  primary: 'purple', secondary: 'pink', accent: 'purple',
  error: 'red', warning: 'orange', success: 'cyan', info: 'purple',
  text: 'darkFg', textMuted: 'darkFgMuted',
  background: 'darkBg', backgroundPanel: 'darkBgPanel', backgroundElement: 'darkBgPanel',
  border: 'darkBorder', borderActive: 'darkFgMuted', borderSubtle: 'darkBorder',
  diffAdded: 'cyan', diffRemoved: 'red',
  diffContext: 'darkFgMuted', diffHunkHeader: 'darkFgMuted',
  diffHighlightAdded: 'cyan', diffHighlightRemoved: 'red',
  diffAddedBg: '#354933', diffRemovedBg: '#3f191a', diffContextBg: 'darkBgPanel',
  diffLineNumber: '#898989',
  diffAddedLineNumberBg: '#162620', diffRemovedLineNumberBg: '#26161a',
  markdownText: 'darkFg', markdownHeading: 'purple',
  markdownLink: 'pink', markdownLinkText: 'purple', markdownCode: 'cyan',
  markdownBlockQuote: 'darkFgMuted', markdownEmph: 'orange', markdownStrong: 'purple',
  markdownHorizontalRule: 'darkFgMuted',
  markdownListItem: 'purple', markdownListEnumeration: 'purple',
  markdownImage: 'pink', markdownImageText: 'purple', markdownCodeBlock: 'darkFg',
  syntaxComment: 'darkFgMuted', syntaxKeyword: 'pink', syntaxFunction: 'purple',
  syntaxVariable: 'purple', syntaxString: 'cyan', syntaxNumber: 'green',
  syntaxType: 'purple', syntaxOperator: 'pink', syntaxPunctuation: 'darkFg',
};

const TOKYONIGHT_DEFS = {
  bg: '#1a1b26', bgAlt: '#16161e', bgPanel: '#1f2335', bgElement: '#292e42',
  fg: '#c0caf5', fgMuted: '#565f89', comment: '#565f89',
  blue: '#7aa2f7', purple: '#bb9af7', cyan: '#7dcfff', green: '#9ece6a',
  yellow: '#e0af68', orange: '#ff9e64', red: '#f7768e', teal: '#73daca',
};

const TOKYONIGHT_THEME = {
  primary: 'blue', secondary: 'purple', accent: 'cyan',
  error: 'red', warning: 'yellow', success: 'green', info: 'blue',
  text: 'fg', textMuted: 'fgMuted',
  background: 'bg', backgroundPanel: 'bgPanel', backgroundElement: 'bgElement',
  border: 'bgElement', borderActive: 'blue', borderSubtle: 'bgPanel',
  diffAdded: 'green', diffRemoved: 'red',
  diffContext: 'comment', diffHunkHeader: 'cyan',
  diffHighlightAdded: 'green', diffHighlightRemoved: 'red',
  diffAddedBg: '#1e3a2a', diffRemovedBg: '#3a1e2a', diffContextBg: 'bgPanel',
  diffLineNumber: 'fgMuted',
  diffAddedLineNumberBg: '#1e3a2a', diffRemovedLineNumberBg: '#3a1e2a',
  markdownText: 'fg', markdownHeading: 'purple',
  markdownLink: 'blue', markdownLinkText: 'cyan', markdownCode: 'green',
  markdownBlockQuote: 'comment', markdownEmph: 'yellow', markdownStrong: 'orange',
  markdownHorizontalRule: 'comment',
  markdownListItem: 'blue', markdownListEnumeration: 'cyan',
  markdownImage: 'blue', markdownImageText: 'cyan', markdownCodeBlock: 'fg',
  syntaxComment: 'comment', syntaxKeyword: 'purple', syntaxFunction: 'blue',
  syntaxVariable: 'fg', syntaxString: 'green', syntaxNumber: 'orange',
  syntaxType: 'cyan', syntaxOperator: 'purple', syntaxPunctuation: 'fg',
};

const RAW_THEMES = {
  // Default: ripped from opencode's own `opencode` theme (dark variant).
  opencode: { label: 'Opencode', defs: OPENCODE_DEFS, theme: OPENCODE_THEME },
  tokyonight: { label: 'Tokyonight', defs: TOKYONIGHT_DEFS, theme: TOKYONIGHT_THEME },
  // Legacy pi2 palettes, expressed in the opencode token set.
  nebula: {
    label: 'Nebula',
    defs: {},
    theme: {
      primary: '#8b7bff', secondary: '#4dd0e1', accent: '#c792ea',
      error: '#f16d75', warning: '#f0b35e', success: '#58d68d', info: '#6cb5f4',
      text: '#d8dbe9', textMuted: '#8a90b0',
      background: '#0e1020', backgroundPanel: '#14152b', backgroundElement: '#2a2f55',
      border: '#3d4266', borderActive: '#8b7bff', borderSubtle: '#2b2f4d',
      diffAdded: '#58d68d', diffRemoved: '#f16d75',
      diffContext: '#8a90b0', diffHunkHeader: '#4dd0e1',
      diffHighlightAdded: '#58d68d', diffHighlightRemoved: '#f16d75',
      diffAddedBg: '#14281e', diffRemovedBg: '#2c1518', diffContextBg: '#14152b',
      diffLineNumber: '#555b7d',
      diffAddedLineNumberBg: '#14281e', diffRemovedLineNumberBg: '#2c1518',
      markdownText: '#d8dbe9', markdownHeading: '#8b7bff',
      markdownLink: '#4dd0e1', markdownLinkText: '#c792ea', markdownCode: '#58d68d',
      markdownBlockQuote: '#8a90b0', markdownEmph: '#f0b35e', markdownStrong: '#c792ea',
      markdownHorizontalRule: '#555b7d',
      markdownListItem: '#8b7bff', markdownListEnumeration: '#4dd0e1',
      markdownImage: '#4dd0e1', markdownImageText: '#c792ea', markdownCodeBlock: '#d8dbe9',
      syntaxComment: '#555b7d', syntaxKeyword: '#c792ea', syntaxFunction: '#8b7bff',
      syntaxVariable: '#d8dbe9', syntaxString: '#58d68d', syntaxNumber: '#f0b35e',
      syntaxType: '#4dd0e1', syntaxOperator: '#c792ea', syntaxPunctuation: '#8a90b0',
    },
  },
  ember: {
    label: 'Ember',
    defs: {},
    theme: {
      primary: '#ff9e64', secondary: '#ffc53d', accent: '#ff7a93',
      error: '#f7768e', warning: '#e0af68', success: '#9ece6a', info: '#7aa2f7',
      text: '#e8ddce', textMuted: '#a3937c',
      background: '#1a130d', backgroundPanel: '#231a13', backgroundElement: '#453322',
      border: '#57493a', borderActive: '#ff9e64', borderSubtle: '#40352a',
      diffAdded: '#9ece6a', diffRemoved: '#f7768e',
      diffContext: '#a3937c', diffHunkHeader: '#7aa2f7',
      diffHighlightAdded: '#9ece6a', diffHighlightRemoved: '#f7768e',
      diffAddedBg: '#222a14', diffRemovedBg: '#2c1418', diffContextBg: '#231a13',
      diffLineNumber: '#6b5d4b',
      diffAddedLineNumberBg: '#222a14', diffRemovedLineNumberBg: '#2c1418',
      markdownText: '#e8ddce', markdownHeading: '#ff9e64',
      markdownLink: '#7aa2f7', markdownLinkText: '#ff7a93', markdownCode: '#9ece6a',
      markdownBlockQuote: '#a3937c', markdownEmph: '#e0af68', markdownStrong: '#ff7a93',
      markdownHorizontalRule: '#6b5d4b',
      markdownListItem: '#ff9e64', markdownListEnumeration: '#ffc53d',
      markdownImage: '#7aa2f7', markdownImageText: '#ff7a93', markdownCodeBlock: '#e8ddce',
      syntaxComment: '#6b5d4b', syntaxKeyword: '#ff7a93', syntaxFunction: '#ff9e64',
      syntaxVariable: '#e8ddce', syntaxString: '#9ece6a', syntaxNumber: '#e0af68',
      syntaxType: '#7aa2f7', syntaxOperator: '#ff7a93', syntaxPunctuation: '#a3937c',
    },
  },
  forest: {
    label: 'Forest',
    defs: {},
    theme: {
      primary: '#7ee081', secondary: '#4dd0a1', accent: '#d4e157',
      error: '#ff6f60', warning: '#ffd54f', success: '#58d68d', info: '#64b5f6',
      text: '#d8e8d8', textMuted: '#89a894',
      background: '#0b1510', backgroundPanel: '#0f1f16', backgroundElement: '#1f4030',
      border: '#3a5546', borderActive: '#7ee081', borderSubtle: '#2a4034',
      diffAdded: '#58d68d', diffRemoved: '#ff6f60',
      diffContext: '#89a894', diffHunkHeader: '#64b5f6',
      diffHighlightAdded: '#58d68d', diffHighlightRemoved: '#ff6f60',
      diffAddedBg: '#12241a', diffRemovedBg: '#2a1412', diffContextBg: '#0f1f16',
      diffLineNumber: '#4f6b5c',
      diffAddedLineNumberBg: '#12241a', diffRemovedLineNumberBg: '#2a1412',
      markdownText: '#d8e8d8', markdownHeading: '#7ee081',
      markdownLink: '#64b5f6', markdownLinkText: '#4dd0a1', markdownCode: '#58d68d',
      markdownBlockQuote: '#89a894', markdownEmph: '#ffd54f', markdownStrong: '#d4e157',
      markdownHorizontalRule: '#4f6b5c',
      markdownListItem: '#7ee081', markdownListEnumeration: '#4dd0a1',
      markdownImage: '#64b5f6', markdownImageText: '#4dd0a1', markdownCodeBlock: '#d8e8d8',
      syntaxComment: '#4f6b5c', syntaxKeyword: '#d4e157', syntaxFunction: '#7ee081',
      syntaxVariable: '#d8e8d8', syntaxString: '#58d68d', syntaxNumber: '#ffd54f',
      syntaxType: '#4dd0a1', syntaxOperator: '#d4e157', syntaxPunctuation: '#89a894',
    },
  },
  mono: {
    label: 'Mono',
    defs: {},
    theme: {
      primary: '#e0e0e0', secondary: '#a8a8a8', accent: '#ffffff',
      error: '#f0a8a8', warning: '#f0e0a8', success: '#c8f0c8', info: '#b8d0f0',
      text: '#d4d4d4', textMuted: '#909090',
      background: '#101010', backgroundPanel: '#161616', backgroundElement: '#303030',
      border: '#4a4a4a', borderActive: '#e0e0e0', borderSubtle: '#2c2c2c',
      diffAdded: '#c8f0c8', diffRemoved: '#f0a8a8',
      diffContext: '#909090', diffHunkHeader: '#909090',
      diffHighlightAdded: '#c8f0c8', diffHighlightRemoved: '#f0a8a8',
      diffAddedBg: '#1a2a1a', diffRemovedBg: '#2a1a1a', diffContextBg: '#161616',
      diffLineNumber: '#5a5a5a',
      diffAddedLineNumberBg: '#1a2a1a', diffRemovedLineNumberBg: '#2a1a1a',
      markdownText: '#d4d4d4', markdownHeading: '#ffffff',
      markdownLink: '#b8d0f0', markdownLinkText: '#a8a8a8', markdownCode: '#c8f0c8',
      markdownBlockQuote: '#909090', markdownEmph: '#f0e0a8', markdownStrong: '#ffffff',
      markdownHorizontalRule: '#5a5a5a',
      markdownListItem: '#e0e0e0', markdownListEnumeration: '#a8a8a8',
      markdownImage: '#b8d0f0', markdownImageText: '#a8a8a8', markdownCodeBlock: '#d4d4d4',
      syntaxComment: '#5a5a5a', syntaxKeyword: '#e0e0e0', syntaxFunction: '#ffffff',
      syntaxVariable: '#d4d4d4', syntaxString: '#c8f0c8', syntaxNumber: '#f0e0a8',
      syntaxType: '#b8d0f0', syntaxOperator: '#e0e0e0', syntaxPunctuation: '#909090',
    },
  },
};

export const THEMES = RAW_THEMES;

export const THEME_NAMES = Object.keys(THEMES);

/** Back-compat: flattened default-mode palettes keyed by name. */
export function themePalettes(mode = DEFAULT_MODE) {
  const out = {};
  for (const [name, raw] of Object.entries(RAW_THEMES)) out[name] = flattenTheme(raw, mode);
  return out;
}

let _flatCache = null;
function flatPalettes() {
  if (!_flatCache) _flatCache = themePalettes();
  return _flatCache;
}

export function getTheme(name, mode = DEFAULT_MODE) {
  const key = resolveThemeName(name);
  if (mode !== DEFAULT_MODE) return flattenTheme(RAW_THEMES[key], mode);
  return flatPalettes()[key] || flatPalettes().opencode;
}

/** Resolve env/flag theme name. Default is now `opencode`. */
export function resolveThemeName(name) {
  if (!name) return 'opencode';
  const n = String(name).toLowerCase();
  return THEME_NAMES.find(k => k === n || (RAW_THEMES[k].label || '').toLowerCase() === n) || 'opencode';
}

export { fg, bg, mix, gradient, paint, BOLD, DIM, ITALIC, UNDERLINE, RESET };
