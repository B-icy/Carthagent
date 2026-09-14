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
  darkFgMuted: '#838383',
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
  fg: '#c0caf5', fgMuted: '#9a9fb8', comment: '#9a9fb8',
  blue: '#7aa2f7', purple: '#bb9af7', cyan: '#7dcfff', green: '#9ece6a',
  yellow: '#e0af68', orange: '#ff9e64', red: '#f7768e', teal: '#73daca',
};

const TOKYONIGHT_THEME = {
  primary: 'blue', secondary: 'purple', accent: 'cyan',
  error: 'red', warning: 'yellow', success: 'green', info: 'blue',
  text: 'fg', textMuted: 'fgMuted',
  background: 'bg', backgroundPanel: 'bgPanel', backgroundElement: 'bgElement',
  border: '#3b4261', borderActive: 'blue', borderSubtle: '#2e3350',
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
      text: '#d8dbe9', textMuted: '#969bb8',
      background: '#0e1020', backgroundPanel: '#14152b', backgroundElement: '#2a2f55',
      border: '#3d4266', borderActive: '#8b7bff', borderSubtle: '#2b2f4d',
      diffAdded: '#58d68d', diffRemoved: '#f16d75',
      diffContext: '#969bb8', diffHunkHeader: '#4dd0e1',
      diffHighlightAdded: '#58d68d', diffHighlightRemoved: '#f16d75',
      diffAddedBg: '#14281e', diffRemovedBg: '#2c1518', diffContextBg: '#14152b',
      diffLineNumber: '#888ca4',
      diffAddedLineNumberBg: '#14281e', diffRemovedLineNumberBg: '#2c1518',
      markdownText: '#d8dbe9', markdownHeading: '#8b7bff',
      markdownLink: '#4dd0e1', markdownLinkText: '#c792ea', markdownCode: '#58d68d',
      markdownBlockQuote: '#969bb8', markdownEmph: '#f0b35e', markdownStrong: '#c792ea',
      markdownHorizontalRule: '#888ca4',
      markdownListItem: '#8b7bff', markdownListEnumeration: '#4dd0e1',
      markdownImage: '#4dd0e1', markdownImageText: '#c792ea', markdownCodeBlock: '#d8dbe9',
      syntaxComment: '#888ca4', syntaxKeyword: '#c792ea', syntaxFunction: '#8b7bff',
      syntaxVariable: '#d8dbe9', syntaxString: '#58d68d', syntaxNumber: '#f0b35e',
      syntaxType: '#4dd0e1', syntaxOperator: '#c792ea', syntaxPunctuation: '#969bb8',
    },
  },
  ember: {
    label: 'Ember',
    defs: {},
    theme: {
      primary: '#ff9e64', secondary: '#ffc53d', accent: '#ff7a93',
      error: '#f7768e', warning: '#e0af68', success: '#9ece6a', info: '#7aa2f7',
      text: '#e8ddce', textMuted: '#ac9e89',
      background: '#1a130d', backgroundPanel: '#231a13', backgroundElement: '#453322',
      border: '#57493a', borderActive: '#ff9e64', borderSubtle: '#40352a',
      diffAdded: '#9ece6a', diffRemoved: '#f7768e',
      diffContext: '#ac9e89', diffHunkHeader: '#7aa2f7',
      diffHighlightAdded: '#9ece6a', diffHighlightRemoved: '#f7768e',
      diffAddedBg: '#222a14', diffRemovedBg: '#2c1418', diffContextBg: '#231a13',
      diffLineNumber: '#978e81',
      diffAddedLineNumberBg: '#222a14', diffRemovedLineNumberBg: '#2c1418',
      markdownText: '#e8ddce', markdownHeading: '#ff9e64',
      markdownLink: '#7aa2f7', markdownLinkText: '#ff7a93', markdownCode: '#9ece6a',
      markdownBlockQuote: '#ac9e89', markdownEmph: '#e0af68', markdownStrong: '#ff7a93',
      markdownHorizontalRule: '#978e81',
      markdownListItem: '#ff9e64', markdownListEnumeration: '#ffc53d',
      markdownImage: '#7aa2f7', markdownImageText: '#ff7a93', markdownCodeBlock: '#e8ddce',
      syntaxComment: '#978e81', syntaxKeyword: '#ff7a93', syntaxFunction: '#ff9e64',
      syntaxVariable: '#e8ddce', syntaxString: '#9ece6a', syntaxNumber: '#e0af68',
      syntaxType: '#7aa2f7', syntaxOperator: '#ff7a93', syntaxPunctuation: '#ac9e89',
    },
  },
  forest: {
    label: 'Forest',
    defs: {},
    theme: {
      primary: '#7ee081', secondary: '#4dd0a1', accent: '#d4e157',
      error: '#ff6f60', warning: '#ffd54f', success: '#58d68d', info: '#64b5f6',
      text: '#d8e8d8', textMuted: '#8fac99',
      background: '#0b1510', backgroundPanel: '#0f1f16', backgroundElement: '#1f4030',
      border: '#3a5546', borderActive: '#7ee081', borderSubtle: '#2a4034',
      diffAdded: '#58d68d', diffRemoved: '#ff6f60',
      diffContext: '#8fac99', diffHunkHeader: '#64b5f6',
      diffHighlightAdded: '#58d68d', diffHighlightRemoved: '#ff6f60',
      diffAddedBg: '#12241a', diffRemovedBg: '#2a1412', diffContextBg: '#0f1f16',
      diffLineNumber: '#7b9085',
      diffAddedLineNumberBg: '#12241a', diffRemovedLineNumberBg: '#2a1412',
      markdownText: '#d8e8d8', markdownHeading: '#7ee081',
      markdownLink: '#64b5f6', markdownLinkText: '#4dd0a1', markdownCode: '#58d68d',
      markdownBlockQuote: '#8fac99', markdownEmph: '#ffd54f', markdownStrong: '#d4e157',
      markdownHorizontalRule: '#7b9085',
      markdownListItem: '#7ee081', markdownListEnumeration: '#4dd0a1',
      markdownImage: '#64b5f6', markdownImageText: '#4dd0a1', markdownCodeBlock: '#d8e8d8',
      syntaxComment: '#7b9085', syntaxKeyword: '#d4e157', syntaxFunction: '#7ee081',
      syntaxVariable: '#d8e8d8', syntaxString: '#58d68d', syntaxNumber: '#ffd54f',
      syntaxType: '#4dd0a1', syntaxOperator: '#d4e157', syntaxPunctuation: '#8fac99',
    },
  },
  mono: {
    label: 'Mono',
    defs: {},
    theme: {
      primary: '#e0e0e0', secondary: '#a8a8a8', accent: '#ffffff',
      error: '#f0a8a8', warning: '#f0e0a8', success: '#c8f0c8', info: '#b8d0f0',
      text: '#d4d4d4', textMuted: '#9b9b9b',
      background: '#101010', backgroundPanel: '#161616', backgroundElement: '#303030',
      border: '#4a4a4a', borderActive: '#e0e0e0', borderSubtle: '#2c2c2c',
      diffAdded: '#c8f0c8', diffRemoved: '#f0a8a8',
      diffContext: '#9b9b9b', diffHunkHeader: '#9b9b9b',
      diffHighlightAdded: '#c8f0c8', diffHighlightRemoved: '#f0a8a8',
      diffAddedBg: '#1a2a1a', diffRemovedBg: '#2a1a1a', diffContextBg: '#161616',
      diffLineNumber: '#949494',
      diffAddedLineNumberBg: '#1a2a1a', diffRemovedLineNumberBg: '#2a1a1a',
      markdownText: '#d4d4d4', markdownHeading: '#ffffff',
      markdownLink: '#b8d0f0', markdownLinkText: '#a8a8a8', markdownCode: '#c8f0c8',
      markdownBlockQuote: '#9b9b9b', markdownEmph: '#f0e0a8', markdownStrong: '#ffffff',
      markdownHorizontalRule: '#949494',
      markdownListItem: '#e0e0e0', markdownListEnumeration: '#a8a8a8',
      markdownImage: '#b8d0f0', markdownImageText: '#a8a8a8', markdownCodeBlock: '#d4d4d4',
      syntaxComment: '#949494', syntaxKeyword: '#e0e0e0', syntaxFunction: '#ffffff',
      syntaxVariable: '#d4d4d4', syntaxString: '#c8f0c8', syntaxNumber: '#f0e0a8',
      syntaxType: '#b8d0f0', syntaxOperator: '#e0e0e0', syntaxPunctuation: '#9b9b9b',
    },
  },  'obsidian': {
    label: 'Obsidian',
    defs: {},
    theme: {
      primary: '#a78bff', secondary: '#d2a8ff',
      accent: '#a78bff', error: '#ff7d7d',
      warning: '#ffc078', success: '#5fd4a4',
      info: '#d2a8ff', text: '#e8e8e8',
      textMuted: '#9a9a9a', background: '#0f0f0f',
      backgroundPanel: '#161616', backgroundElement: '#1d1d1d',
      border: '#3d3d3d', borderActive: '#a78bff',
      borderSubtle: '#2c2c2c', diffContext: '#808080',
      diffHunkHeader: '#a78bff', diffContextBg: '#161616',
      diffLineNumber: '#9a9a9a', markdownText: '#e8e8e8',
      markdownHeading: '#a78bff', markdownLink: '#d2a8ff',
      markdownLinkText: '#a78bff', markdownCode: '#5fd4a4',
      markdownBlockQuote: '#9a9a9a', markdownEmph: '#ffc078',
      markdownStrong: '#a78bff', markdownHorizontalRule: '#808080',
      markdownListItem: '#a78bff', markdownListEnumeration: '#a78bff',
      markdownImage: '#d2a8ff', markdownImageText: '#a78bff',
      markdownCodeBlock: '#c9c9c9', syntaxComment: '#808080',
      syntaxKeyword: '#d2a8ff', syntaxFunction: '#a78bff',
      syntaxVariable: '#e8e8e8', syntaxString: '#5fd4a4',
      syntaxNumber: '#ffc078', syntaxType: '#d2a8ff',
      syntaxOperator: '#d2a8ff', syntaxPunctuation: '#e8e8e8',
      diffAdded: '#5fd4a4', diffRemoved: '#ff7d7d',
      diffHighlightAdded: '#5fd4a4', diffHighlightRemoved: '#ff7d7d',
      diffAddedBg: '#1b2d25', diffRemovedBg: '#332020',
      diffAddedLineNumberBg: '#151d19', diffRemovedLineNumberBg: '#201717',
    },
  },
  'midnight': {
    label: 'Midnight',
    defs: {},
    theme: {
      primary: '#58a6ff', secondary: '#d2a8ff',
      accent: '#58a6ff', error: '#ff7b72',
      warning: '#e3b341', success: '#56d364',
      info: '#d2a8ff', text: '#e6edf3',
      textMuted: '#9198a1', background: '#0d1117',
      backgroundPanel: '#161b22', backgroundElement: '#21262d',
      border: '#3d444d', borderActive: '#58a6ff',
      borderSubtle: '#30363d', diffContext: '#7d8590',
      diffHunkHeader: '#58a6ff', diffContextBg: '#161b22',
      diffLineNumber: '#9198a1', markdownText: '#e6edf3',
      markdownHeading: '#58a6ff', markdownLink: '#d2a8ff',
      markdownLinkText: '#58a6ff', markdownCode: '#56d364',
      markdownBlockQuote: '#9198a1', markdownEmph: '#e3b341',
      markdownStrong: '#58a6ff', markdownHorizontalRule: '#7d8590',
      markdownListItem: '#58a6ff', markdownListEnumeration: '#58a6ff',
      markdownImage: '#d2a8ff', markdownImageText: '#58a6ff',
      markdownCodeBlock: '#d1d7e0', syntaxComment: '#7d8590',
      syntaxKeyword: '#d2a8ff', syntaxFunction: '#58a6ff',
      syntaxVariable: '#e6edf3', syntaxString: '#56d364',
      syntaxNumber: '#e3b341', syntaxType: '#d2a8ff',
      syntaxOperator: '#d2a8ff', syntaxPunctuation: '#e6edf3',
      diffAdded: '#56d364', diffRemoved: '#ff7b72',
      diffHighlightAdded: '#56d364', diffHighlightRemoved: '#ff7b72',
      diffAddedBg: '#182e23', diffRemovedBg: '#312125',
      diffAddedLineNumberBg: '#121f1c', diffRemovedLineNumberBg: '#1e181d',
    },
  },
  'solarized-dark': {
    label: 'Solarized Dark',
    defs: {},
    theme: {
      primary: '#5eacdc', secondary: '#c98bd0',
      accent: '#5eacdc', error: '#f0938a',
      warning: '#d4a72c', success: '#a4b94e',
      info: '#c98bd0', text: '#a2b2b2',
      textMuted: '#9aa9ac', background: '#002b36',
      backgroundPanel: '#073642', backgroundElement: '#0a4050',
      border: '#1a5c6e', borderActive: '#5eacdc',
      borderSubtle: '#0d4a5a', diffContext: '#8d9c9e',
      diffHunkHeader: '#5eacdc', diffContextBg: '#073642',
      diffLineNumber: '#9aa9ac', markdownText: '#a2b2b2',
      markdownHeading: '#5eacdc', markdownLink: '#c98bd0',
      markdownLinkText: '#5eacdc', markdownCode: '#a4b94e',
      markdownBlockQuote: '#9aa9ac', markdownEmph: '#d4a72c',
      markdownStrong: '#5eacdc', markdownHorizontalRule: '#8d9c9e',
      markdownListItem: '#5eacdc', markdownListEnumeration: '#5eacdc',
      markdownImage: '#c98bd0', markdownImageText: '#5eacdc',
      markdownCodeBlock: '#a5b5b5', syntaxComment: '#8d9c9e',
      syntaxKeyword: '#c98bd0', syntaxFunction: '#5eacdc',
      syntaxVariable: '#a2b2b2', syntaxString: '#a4b94e',
      syntaxNumber: '#d4a72c', syntaxType: '#c98bd0',
      syntaxOperator: '#c98bd0', syntaxPunctuation: '#a2b2b2',
      diffAdded: '#a4b94e', diffRemoved: '#f0938a',
      diffHighlightAdded: '#a4b94e', diffHighlightRemoved: '#f0938a',
      diffAddedBg: '#19403a', diffRemovedBg: '#243b43',
      diffAddedLineNumberBg: '#0b3538', diffRemovedLineNumberBg: '#11323c',
    },
  },
  'nord': {
    label: 'Nord',
    defs: {},
    theme: {
      primary: '#8fc4d3', secondary: '#c2a6ce',
      accent: '#8fc4d3', error: '#e6a8ad',
      warning: '#ebcb8b', success: '#a3be8c',
      info: '#c2a6ce', text: '#eceff4',
      textMuted: '#c0c9d8', background: '#2e3440',
      backgroundPanel: '#3b4252', backgroundElement: '#3f4653',
      border: '#5b6a82', borderActive: '#8fc4d3',
      borderSubtle: '#4c566a', diffContext: '#a6aec0',
      diffHunkHeader: '#8fc4d3', diffContextBg: '#3b4252',
      diffLineNumber: '#c0c9d8', markdownText: '#eceff4',
      markdownHeading: '#8fc4d3', markdownLink: '#c2a6ce',
      markdownLinkText: '#8fc4d3', markdownCode: '#a3be8c',
      markdownBlockQuote: '#c0c9d8', markdownEmph: '#ebcb8b',
      markdownStrong: '#8fc4d3', markdownHorizontalRule: '#a6aec0',
      markdownListItem: '#8fc4d3', markdownListEnumeration: '#8fc4d3',
      markdownImage: '#c2a6ce', markdownImageText: '#8fc4d3',
      markdownCodeBlock: '#d8dee9', syntaxComment: '#a6aec0',
      syntaxKeyword: '#c2a6ce', syntaxFunction: '#8fc4d3',
      syntaxVariable: '#eceff4', syntaxString: '#a3be8c',
      syntaxNumber: '#ebcb8b', syntaxType: '#c2a6ce',
      syntaxOperator: '#c2a6ce', syntaxPunctuation: '#eceff4',
      diffAdded: '#a3be8c', diffRemoved: '#e6a8ad',
      diffHighlightAdded: '#a3be8c', diffHighlightRemoved: '#e6a8ad',
      diffAddedBg: '#40494b', diffRemovedBg: '#4a4550',
      diffAddedLineNumberBg: '#363e45', diffRemovedLineNumberBg: '#3b3c48',
    },
  },
  'contrast-dark': {
    label: 'High Contrast Dark',
    defs: {},
    theme: {
      primary: '#82aaff', secondary: '#5eead4',
      accent: '#82aaff', error: '#ff8a8a',
      warning: '#fde047', success: '#5eead4',
      info: '#5eead4', text: '#ffffff',
      textMuted: '#b8b8b8', background: '#000000',
      backgroundPanel: '#0d0d0d', backgroundElement: '#1a1a1a',
      border: '#8f8f8f', borderActive: '#82aaff',
      borderSubtle: '#6f6f6f', diffContext: '#949494',
      diffHunkHeader: '#82aaff', diffContextBg: '#0d0d0d',
      diffLineNumber: '#b8b8b8', markdownText: '#ffffff',
      markdownHeading: '#82aaff', markdownLink: '#5eead4',
      markdownLinkText: '#82aaff', markdownCode: '#5eead4',
      markdownBlockQuote: '#b8b8b8', markdownEmph: '#fde047',
      markdownStrong: '#82aaff', markdownHorizontalRule: '#949494',
      markdownListItem: '#82aaff', markdownListEnumeration: '#82aaff',
      markdownImage: '#5eead4', markdownImageText: '#82aaff',
      markdownCodeBlock: '#e0e0e0', syntaxComment: '#949494',
      syntaxKeyword: '#5eead4', syntaxFunction: '#82aaff',
      syntaxVariable: '#ffffff', syntaxString: '#5eead4',
      syntaxNumber: '#fde047', syntaxType: '#5eead4',
      syntaxOperator: '#5eead4', syntaxPunctuation: '#ffffff',
      diffAdded: '#5eead4', diffRemoved: '#ff8a8a',
      diffHighlightAdded: '#5eead4', diffHighlightRemoved: '#ff8a8a',
      diffAddedBg: '#0e2320', diffRemovedBg: '#261515',
      diffAddedLineNumberBg: '#07100f', diffRemovedLineNumberBg: '#120a0a',
    },
  },
  'okabe-dark': {
    label: 'Okabe-Ito Dark',
    defs: {},
    theme: {
      primary: '#56b4e9', secondary: '#cc79a7',
      accent: '#56b4e9', error: '#f07c3f',
      warning: '#e8d24a', success: '#35d6a5',
      info: '#cc79a7', text: '#e8eaed',
      textMuted: '#9ba1aa', background: '#121316',
      backgroundPanel: '#1a1c21', backgroundElement: '#22252b',
      border: '#41454f', borderActive: '#56b4e9',
      borderSubtle: '#30333b', diffContext: '#7e8490',
      diffHunkHeader: '#56b4e9', diffContextBg: '#1a1c21',
      diffLineNumber: '#9ba1aa', markdownText: '#e8eaed',
      markdownHeading: '#56b4e9', markdownLink: '#cc79a7',
      markdownLinkText: '#56b4e9', markdownCode: '#35d6a5',
      markdownBlockQuote: '#9ba1aa', markdownEmph: '#e8d24a',
      markdownStrong: '#56b4e9', markdownHorizontalRule: '#7e8490',
      markdownListItem: '#56b4e9', markdownListEnumeration: '#56b4e9',
      markdownImage: '#cc79a7', markdownImageText: '#56b4e9',
      markdownCodeBlock: '#c9cdd4', syntaxComment: '#7e8490',
      syntaxKeyword: '#cc79a7', syntaxFunction: '#56b4e9',
      syntaxVariable: '#e8eaed', syntaxString: '#35d6a5',
      syntaxNumber: '#e8d24a', syntaxType: '#cc79a7',
      syntaxOperator: '#cc79a7', syntaxPunctuation: '#e8eaed',
      diffAdded: '#35d6a5', diffRemoved: '#f07c3f',
      diffHighlightAdded: '#35d6a5', diffHighlightRemoved: '#f07c3f',
      diffAddedBg: '#17302b', diffRemovedBg: '#33231c',
      diffAddedLineNumberBg: '#142120', diffRemovedLineNumberBg: '#221a19',
    },
  },
  'paper': {
    label: 'Paper',
    defs: {},
    theme: {
      primary: '#5b4bd4', secondary: '#0e7c86',
      accent: '#5b4bd4', error: '#cb2d3b',
      warning: '#8a6100', success: '#157347',
      info: '#0e7c86', text: '#24292f',
      textMuted: '#5c6470', background: '#faf9f6',
      backgroundPanel: '#ffffff', backgroundElement: '#f1efe9',
      border: '#c9c3b4', borderActive: '#5b4bd4',
      borderSubtle: '#e0dcd2', diffContext: '#666d76',
      diffHunkHeader: '#5b4bd4', diffContextBg: '#ffffff',
      diffLineNumber: '#5c6470', markdownText: '#24292f',
      markdownHeading: '#5b4bd4', markdownLink: '#0e7c86',
      markdownLinkText: '#5b4bd4', markdownCode: '#157347',
      markdownBlockQuote: '#5c6470', markdownEmph: '#8a6100',
      markdownStrong: '#5b4bd4', markdownHorizontalRule: '#666d76',
      markdownListItem: '#5b4bd4', markdownListEnumeration: '#5b4bd4',
      markdownImage: '#0e7c86', markdownImageText: '#5b4bd4',
      markdownCodeBlock: '#3a424d', syntaxComment: '#666d76',
      syntaxKeyword: '#0e7c86', syntaxFunction: '#5b4bd4',
      syntaxVariable: '#24292f', syntaxString: '#157347',
      syntaxNumber: '#8a6100', syntaxType: '#0e7c86',
      syntaxOperator: '#0e7c86', syntaxPunctuation: '#24292f',
      diffAdded: '#105635', diffRemoved: '#98222c',
      diffHighlightAdded: '#105635', diffHighlightRemoved: '#98222c',
      diffAddedBg: '#e3ece5', diffRemovedBg: '#f5e5e3',
      diffAddedLineNumberBg: '#dfe9e1', diffRemovedLineNumberBg: '#f4e1e0',
    },
  },
  'daylight': {
    label: 'Daylight',
    defs: {},
    theme: {
      primary: '#0963c9', secondary: '#8250df',
      accent: '#0963c9', error: '#cf222e',
      warning: '#8a5700', success: '#1a7f37',
      info: '#8250df', text: '#1f2328',
      textMuted: '#59636e', background: '#f6f8fa',
      backgroundPanel: '#ffffff', backgroundElement: '#eef1f4',
      border: '#b7c0c9', borderActive: '#0963c9',
      borderSubtle: '#d1d9e0', diffContext: '#6a7280',
      diffHunkHeader: '#0963c9', diffContextBg: '#ffffff',
      diffLineNumber: '#59636e', markdownText: '#1f2328',
      markdownHeading: '#0963c9', markdownLink: '#8250df',
      markdownLinkText: '#0963c9', markdownCode: '#1a7f37',
      markdownBlockQuote: '#59636e', markdownEmph: '#8a5700',
      markdownStrong: '#0963c9', markdownHorizontalRule: '#6a7280',
      markdownListItem: '#0963c9', markdownListEnumeration: '#0963c9',
      markdownImage: '#8250df', markdownImageText: '#0963c9',
      markdownCodeBlock: '#383f47', syntaxComment: '#6a7280',
      syntaxKeyword: '#8250df', syntaxFunction: '#0963c9',
      syntaxVariable: '#1f2328', syntaxString: '#1a7f37',
      syntaxNumber: '#8a5700', syntaxType: '#8250df',
      syntaxOperator: '#8250df', syntaxPunctuation: '#1f2328',
      diffAdded: '#145f29', diffRemoved: '#9b1a23',
      diffHighlightAdded: '#145f29', diffHighlightRemoved: '#9b1a23',
      diffAddedBg: '#e0ece7', diffRemovedBg: '#f2e3e6',
      diffAddedLineNumberBg: '#dce9e3', diffRemovedLineNumberBg: '#f1dee2',
    },
  },
  'solarized-light': {
    label: 'Solarized Light',
    defs: {},
    theme: {
      primary: '#1e6aa4', secondary: '#a04a7c',
      accent: '#1e6aa4', error: '#c62d2b',
      warning: '#866500', success: '#636f00',
      info: '#a04a7c', text: '#073642',
      textMuted: '#556970', background: '#fdf6e3',
      backgroundPanel: '#fdf6e3', backgroundElement: '#f1e9d2',
      border: '#cbbf98', borderActive: '#1e6aa4',
      borderSubtle: '#e3d8b8', diffContext: '#5a6e75',
      diffHunkHeader: '#1e6aa4', diffContextBg: '#fdf6e3',
      diffLineNumber: '#4a5b61', markdownText: '#073642',
      markdownHeading: '#1e6aa4', markdownLink: '#a04a7c',
      markdownLinkText: '#1e6aa4', markdownCode: '#636f00',
      markdownBlockQuote: '#556970', markdownEmph: '#866500',
      markdownStrong: '#1e6aa4', markdownHorizontalRule: '#5a6e75',
      markdownListItem: '#1e6aa4', markdownListEnumeration: '#1e6aa4',
      markdownImage: '#a04a7c', markdownImageText: '#1e6aa4',
      markdownCodeBlock: '#2d4a52', syntaxComment: '#5a6e75',
      syntaxKeyword: '#a04a7c', syntaxFunction: '#1e6aa4',
      syntaxVariable: '#073642', syntaxString: '#636f00',
      syntaxNumber: '#866500', syntaxType: '#a04a7c',
      syntaxOperator: '#a04a7c', syntaxPunctuation: '#073642',
      diffAdded: '#4a5300', diffRemoved: '#952220',
      diffHighlightAdded: '#4a5300', diffHighlightRemoved: '#952220',
      diffAddedBg: '#eee9cc', diffRemovedBg: '#f8e2d1',
      diffAddedLineNumberBg: '#ebe6c8', diffRemovedLineNumberBg: '#f6decd',
    },
  },
  'contrast-light': {
    label: 'High Contrast Light',
    defs: {},
    theme: {
      primary: '#0043c8', secondary: '#00633b',
      accent: '#0043c8', error: '#b00020',
      warning: '#694d00', success: '#00633b',
      info: '#00633b', text: '#000000',
      textMuted: '#3d3d3d', background: '#ffffff',
      backgroundPanel: '#ffffff', backgroundElement: '#f2f2f2',
      border: '#595959', borderActive: '#0043c8',
      borderSubtle: '#767676', diffContext: '#525252',
      diffHunkHeader: '#0043c8', diffContextBg: '#ffffff',
      diffLineNumber: '#3d3d3d', markdownText: '#000000',
      markdownHeading: '#0043c8', markdownLink: '#00633b',
      markdownLinkText: '#0043c8', markdownCode: '#00633b',
      markdownBlockQuote: '#3d3d3d', markdownEmph: '#694d00',
      markdownStrong: '#0043c8', markdownHorizontalRule: '#525252',
      markdownListItem: '#0043c8', markdownListEnumeration: '#0043c8',
      markdownImage: '#00633b', markdownImageText: '#0043c8',
      markdownCodeBlock: '#1a1a1a', syntaxComment: '#525252',
      syntaxKeyword: '#00633b', syntaxFunction: '#0043c8',
      syntaxVariable: '#000000', syntaxString: '#00633b',
      syntaxNumber: '#694d00', syntaxType: '#00633b',
      syntaxOperator: '#00633b', syntaxPunctuation: '#000000',
      diffAdded: '#004a2c', diffRemoved: '#840018',
      diffHighlightAdded: '#004a2c', diffHighlightRemoved: '#840018',
      diffAddedBg: '#e6efeb', diffRemovedBg: '#f7e6e9',
      diffAddedLineNumberBg: '#e0ece7', diffRemovedLineNumberBg: '#f6e0e4',
    },
  },
  'okabe-light': {
    label: 'Okabe-Ito Light',
    defs: {},
    theme: {
      primary: '#0072b2', secondary: '#a3537f',
      accent: '#0072b2', error: '#a3537f',
      warning: '#8a6300', success: '#00795b',
      info: '#a3537f', text: '#20242a',
      textMuted: '#4f5862', background: '#fbfbf8',
      backgroundPanel: '#ffffff', backgroundElement: '#f2f2ec',
      border: '#b8b8a8', borderActive: '#0072b2',
      borderSubtle: '#dadad0', diffContext: '#667079',
      diffHunkHeader: '#0072b2', diffContextBg: '#ffffff',
      diffLineNumber: '#4f5862', markdownText: '#20242a',
      markdownHeading: '#0072b2', markdownLink: '#a3537f',
      markdownLinkText: '#0072b2', markdownCode: '#00795b',
      markdownBlockQuote: '#4f5862', markdownEmph: '#8a6300',
      markdownStrong: '#0072b2', markdownHorizontalRule: '#667079',
      markdownListItem: '#0072b2', markdownListEnumeration: '#0072b2',
      markdownImage: '#a3537f', markdownImageText: '#0072b2',
      markdownCodeBlock: '#343c46', syntaxComment: '#667079',
      syntaxKeyword: '#a3537f', syntaxFunction: '#0072b2',
      syntaxVariable: '#20242a', syntaxString: '#00795b',
      syntaxNumber: '#8a6300', syntaxType: '#a3537f',
      syntaxOperator: '#a3537f', syntaxPunctuation: '#20242a',
      diffAdded: '#005b44', diffRemoved: '#7a3e5f',
      diffHighlightAdded: '#005b44', diffHighlightRemoved: '#7a3e5f',
      diffAddedBg: '#e2eee8', diffRemovedBg: '#f2eaec',
      diffAddedLineNumberBg: '#ddebe5', diffRemovedLineNumberBg: '#f0e7e9',
    },
  },
};

/** Zip a dark and a light theme into one adaptive theme whose tokens are
 * {dark, light} objects resolved by flattenTheme(mode). */
function pairThemes(darkName, lightName, label) {
  const theme = {};
  const dt = RAW_THEMES[darkName].theme;
  const lt = RAW_THEMES[lightName].theme;
  for (const k of Object.keys(dt)) theme[k] = { dark: dt[k], light: lt[k] };
  return { label, theme };
}

// Adaptive themes: the same tokens switch dark/light palette by terminal mode.
RAW_THEMES.solarized = pairThemes('solarized-dark', 'solarized-light', 'Solarized (auto)');
RAW_THEMES.okabe = pairThemes('okabe-dark', 'okabe-light', 'Okabe-Ito (auto)');
RAW_THEMES.contrast = pairThemes('contrast-dark', 'contrast-light', 'High Contrast (auto)');
RAW_THEMES.system = pairThemes('obsidian', 'paper', 'System (auto)');

export const THEMES = RAW_THEMES;

export const THEME_NAMES = Object.keys(THEMES);

/** Guess whether the terminal is running a light or dark color scheme.
 * PI2_THEME_MODE=light|dark overrides; otherwise COLORFGBG's background
 * index (0-6 or 8 = dark ANSI colors, 7 or 9-15 = light); default dark. */
export function detectTermMode(env = {}) {
  const forced = String(env.PI2_THEME_MODE || '').toLowerCase();
  if (forced === 'light' || forced === 'dark') return forced;
  const parts = String(env.COLORFGBG || '').split(';');
  const idx = Number(parts[parts.length - 1]);
  if (Number.isFinite(idx) && env.COLORFGBG !== undefined) return idx === 7 || idx >= 9 ? 'light' : 'dark';
  return DEFAULT_MODE;
}

/** Back-compat: flattened palettes keyed by name, per mode. */
export function themePalettes(mode = DEFAULT_MODE) {
  const out = {};
  for (const [name, raw] of Object.entries(RAW_THEMES)) out[name] = flattenTheme(raw, mode);
  return out;
}

const _flatCache = new Map();
function flatPalettes(mode = DEFAULT_MODE) {
  if (!_flatCache.has(mode)) _flatCache.set(mode, themePalettes(mode));
  return _flatCache.get(mode);
}

export function getTheme(name, mode = DEFAULT_MODE) {
  const key = resolveThemeName(name);
  const palettes = flatPalettes(mode);
  return palettes[key] || palettes.opencode;
}

/** Resolve env/flag theme name. Default is now `opencode`. */
export function resolveThemeName(name) {
  if (!name) return 'opencode';
  const n = String(name).toLowerCase();
  return THEME_NAMES.find(k => k === n || (RAW_THEMES[k].label || '').toLowerCase() === n) || 'opencode';
}

export { fg, bg, mix, gradient, paint, BOLD, DIM, ITALIC, UNDERLINE, RESET };
