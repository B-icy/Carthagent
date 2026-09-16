/**
 * Terminal glyph registry.
 *
 * pi2 draws a lot of icons — tool marks, status dots, a D2 graph and progress
 * spinners. Fonts that lack Geometric Shapes / Braille / Misc Symbols render
 * those codepoints as `?`, which makes the console unreadable. This module
 * centralizes every non-text glyph behind two complete tiers:
 *
 *   unicode — the designed set (box drawing + widely supported shapes).
 *   ascii   — a pure-ASCII fallback for limited fonts and legacy consoles.
 *
 * The tier is resolved once from `--ascii` / `PI2_GLYPHS` / `PI2_ASCII` and,
 * in `auto` mode, from the locale + terminal markers. Consumers receive a flat
 * object whose values are all single display cells (spinner is an array).
 *
 * When adding a glyph: give it an entry in BOTH tiers. Box drawing stays
 * Unicode in the `unicode` tier because every monospace font ships it; the
 * `ascii` tier replaces it with `+ - | ' .` so the graph survives anywhere.
 */

const U = {
  // --- tool / activity icons ---------------------------------------------
  read: '\u25c8',        // ◈
  run: '\u25b8',         // ▸
  write: '\u270e',       // ✎
  search: '\u2315',      // ⌕
  list: '\u25a4',        // ▤
  plan: '\u25c7',        // ◇
  check: '\u2691',       // ⚑
  status: '\u00b7',      // ·

  // --- status marks -------------------------------------------------------
  done: '\u2713',        // ✓
  fail: '\u2717',        // ✗
  warn: '\u25b2',        // ▲
  stale: '\u25d0',       // ◐
  blocked: '\u25a0',     // ■
  active: '\u25b6',      // ▶
  pending: '\u25cb',     // ○
  running: '\u25cf',     // ●
  queued: '\u25cc',      // ◌
  info: '\u00b7',        // ·

  // --- navigation / decoration -------------------------------------------
  up: '\u2191',          // ↑
  down: '\u2193',        // ↓
  left: '\u2190',        // ←
  right: '\u2192',       // →
  shift: '\u21e7',       // ⇧
  bullet: '\u2022',      // •
  ellipsis: '\u2026',    // …
  fold: '\u22ee',        // ⋮
  back: '\u21a9',        // ↩
  tail: '\u23bf',        // ⎿ (tool-output gutter)
  // phase strip dots
  phaseDone: '\u25cf',   // ●
  phaseCurrent: '\u25c9',// ◉
  phasePending: '\u25cb',// ○

  // --- D2 graph animation -------------------------------------------------
  arrowDown: '\u25bc',       // ▼
  arrowDownHollow: '\u25bd', // ▽
  arrowLeft: '\u25c0',       // ◀
  arrowLeftHollow: '\u25c1', // ◁
  packetOn: '\u25cf',        // ●
  packetOff: '\u25e6',       // ◦

  // --- D2 graph box drawing ----------------------------------------------
  box: {
    tl: '\u256d', tr: '\u256e', bl: '\u2570', br: '\u256f', h: '\u2500', v: '\u2502',
    mtl: '\u2554', mtr: '\u2557', mbl: '\u255a', mbr: '\u255d', mh: '\u2550', mv: '\u2551',
    topJoin: '\u252c', botJoin: '\u2534', topJoinM: '\u2564', botJoinM: '\u2567', tee: '\u251c',
    elbowDR: '\u256d', elbowDL: '\u256e', elbowUR: '\u2570', elbowUL: '\u256f',
    dashV: '\u2504', dashH: '\u254c',
  },

  // --- spinners -----------------------------------------------------------
  spinner: ['\u280b', '\u2819', '\u2839', '\u2838', '\u283c', '\u2834', '\u2826', '\u2827', '\u2807', '\u280f'],
};

const A = {
  read: 'r', run: '>', write: 'w', search: '/', list: '=',
  plan: '+', check: '!', status: '-',

  done: '+', fail: 'x', warn: '!', stale: '~', blocked: '#',
  active: '>', pending: '.', running: '*', queued: ':', info: '-',

  up: '^', down: 'v', left: '<', right: '>', shift: '^',
  bullet: '*', ellipsis: '..', fold: ':', back: '<-', tail: '\\',
  phaseDone: '*', phaseCurrent: '@', phasePending: '.',

  arrowDown: 'v', arrowDownHollow: 'v', arrowLeft: '<', arrowLeftHollow: '<',
  packetOn: '*', packetOff: 'o',

  box: {
    tl: '.', tr: '.', bl: "'", br: "'", h: '-', v: '|',
    mtl: '+', mtr: '+', mbl: '+', mbr: '+', mh: '=', mv: '|',
    topJoin: '+', botJoin: '+', topJoinM: '+', botJoinM: '+', tee: '+',
    elbowDR: '.', elbowDL: '.', elbowUR: "'", elbowUL: "'",
    dashV: ':', dashH: '.',
  },

  spinner: ['|', '/', '-', '\\'],
};

export const UNICODE_GLYPHS = Object.freeze({ ...U, box: Object.freeze({ ...U.box }), spinner: Object.freeze([...U.spinner]) });
export const ASCII_GLYPHS = Object.freeze({ ...A, box: Object.freeze({ ...A.box }), spinner: Object.freeze([...A.spinner]) });

const KNOWN_UTF8_TERMINALS = ['WT_SESSION', 'TERM_PROGRAM', 'ITERM_SESSION_ID', 'KITTY_WINDOW_ID', 'WEZTERM_EXECUTABLE', 'ALACRITTY_WINDOW_ID', 'GHOSTTY_RESOURCES_DIR', 'VTE_VERSION', 'KONSOLE_VERSION', 'TMUX', 'STY'];

/**
 * Pick a glyph tier. Explicit config always wins; otherwise `auto` keeps the
 * Unicode set on terminals we can reasonably expect to support it and falls
 * back to ASCII everywhere else (non-UTF-8 locale, legacy Windows console,
 * unknown TERM). `NO_COLOR` is deliberately NOT a signal — it disables color,
 * not glyphs.
 *
 * @returns {'unicode'|'ascii'}
 */
export function detectGlyphMode(env = process.env, platform = process.platform) {
  const explicit = String(env.PI2_GLYPHS || '').trim().toLowerCase();
  if (explicit === 'ascii' || explicit === 'unicode') return explicit;
  const flag = String(env.PI2_ASCII || '').trim().toLowerCase();
  if (flag === '1' || flag === 'true' || flag === 'yes') return 'ascii';
  if (flag === '0' || flag === 'false' || flag === 'no') return 'unicode';

  // A non-UTF-8 locale or a dumb terminal can't carry the symbol set at all.
  const locale = String(env.LC_ALL || env.LC_CTYPE || env.LANG || '');
  const utf8 = !locale || /utf-?8/i.test(locale);
  if (!utf8) return 'ascii';
  if (env.TERM === 'dumb') return 'ascii';

  // `auto` prefers ASCII unless we have positive evidence of a modern terminal
  // emulator. Half the designed glyphs (Geometric Shapes, Braille, Misc
  // Symbols) silently render as `?` in legacy consoles and limited fonts, and
  // there is no reliable runtime font probe — so opt in to Unicode, not out.
  // Set PI2_GLYPHS=unicode / --glyphs unicode to force the designed set.
  const marker = KNOWN_UTF8_TERMINALS.some(k => env[k]);
  const truecolor = /truecolor|24bit/i.test(env.COLORTERM || '');
  const modernTerm = /xterm|screen|tmux|linux|vt|ansi|alacritty|kitty|wezterm|ghostty/i.test(env.TERM || '');
  if (marker || (truecolor && modernTerm)) return 'unicode';
  return 'ascii';
}

/** Resolve a full glyph object for an option bag / env. */
export function resolveGlyphs({ mode, ascii, env = process.env, platform = process.platform } = {}) {
  let chosen = mode;
  if (!chosen) chosen = ascii ? 'ascii' : detectGlyphMode(env, platform);
  return chosen === 'ascii' ? ASCII_GLYPHS : UNICODE_GLYPHS;
}

/** Spinner frame for a resolved set. */
export function spinnerFrame(glyphs, frame) {
  const s = glyphs?.spinner || UNICODE_GLYPHS.spinner;
  return s[((frame % s.length) + s.length) % s.length];
}

/** True when `text` is fully ASCII (used by tests to assert the fallback). */
export function isAsciiGlyphs(glyphs) {
  return glyphs === ASCII_GLYPHS;
}
