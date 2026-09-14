/** ANSI + text-measurement primitives for the pi2 TUI. Zero dependencies.
 *
 * Truecolor-forced like opencode: 24-bit SGR always, unless the terminal is
 * `dumb`, NO_COLOR is set, or PI2_NO_TRUECOLOR=1 / PI2_TRUECOLOR=0 opts out
 * (which restores the legacy COLORTERM/TERM heuristic). `bgLine()` paints
 * full-bleed background fills opencode-style.
 */

export const ESC = '\x1b';
export const RESET = `${ESC}[0m`;
export const BOLD = `${ESC}[1m`;
export const DIM = `${ESC}[2m`;
export const ITALIC = `${ESC}[3m`;
export const UNDERLINE = `${ESC}[4m`;
export const BLINK = `${ESC}[5m`;
export const INVERSE = `${ESC}[7m`;
export const STRIKE = `${ESC}[9m`;

export function detectColorDepth(env = process.env) {
  if (env.TERM === 'dumb' || 'NO_COLOR' in env) return 4;
  if (env.PI2_NO_TRUECOLOR === '1' || env.PI2_TRUECOLOR === '0') {
    const ct = env.COLORTERM || '';
    if (/truecolor|24bit/i.test(ct)) return 24;
    if (/256color/i.test(env.TERM || '')) return 8;
    return 4;
  }
  return 24;
}

export const colorDepth = detectColorDepth();

/** True when the terminal can render opencode palettes at full fidelity. */
export function hasTruecolor(env = process.env) {
  return detectColorDepth(env) === 24;
}

/** One-line gold warning when truecolor is unavailable (opencode-style). */
export function truecolorWarning() {
  return 'terminal lacks truecolor (set COLORTERM=truecolor) — colors approximated';
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

const CUBE = [0, 95, 135, 175, 215, 255];
function rgbTo256(r, g, b) {
  const gray = Math.round((r + g + b) / 3);
  const ri = nearest(CUBE, r), gi = nearest(CUBE, g), bi = nearest(CUBE, b);
  const cube = 16 + 36 * ri + 6 * gi + bi;
  const grayIdx = gray < 8 ? 16 : gray > 248 ? 231 : 232 + Math.round((gray - 8) / 10);
  const cd = (CUBE[ri] - r) ** 2 + (CUBE[gi] - g) ** 2 + (CUBE[bi] - b) ** 2;
  const gs = grayIdx < 232 ? 0 : (grayIdx - 232) * 10 + 8;
  const gd = 3 * (gs - gray) ** 2;
  return gd < cd ? grayIdx : cube;
}
function nearest(arr, v) { let bi = 0, bd = 1e9; arr.forEach((x, i) => { const d = Math.abs(x - v); if (d < bd) { bd = d; bi = i; } }); return bi; }

/** Foreground color for a #rrggbb hex, honoring terminal color depth.
 * 'none' passes through as '' (no SGR emitted). */
export function fg(hex) {
  if (hex === 'none' || hex == null) return '';
  const [r, g, b] = hexToRgb(hex);
  if (colorDepth === 24) return `${ESC}[38;2;${r};${g};${b}m`;
  if (colorDepth === 8) return `${ESC}[38;5;${rgbTo256(r, g, b)}m`;
  return `${ESC}[${ansi16Index(r, g, b)}m`;
}
export function bg(hex) {
  if (hex === 'none' || hex == null) return '';
  const [r, g, b] = hexToRgb(hex);
  if (colorDepth === 24) return `${ESC}[48;2;${r};${g};${b}m`;
  if (colorDepth === 8) return `${ESC}[48;5;${rgbTo256(r, g, b)}m`;
  return `${ESC}[${ansi16Index(r, g, b) + 10}m`;
}
const ANSI16 = [
  [30, [0, 0, 0]], [31, [205, 49, 49]], [32, [13, 188, 121]], [33, [229, 229, 16]],
  [34, [36, 114, 200]], [35, [188, 63, 188]], [36, [17, 168, 205]], [37, [229, 229, 229]],
  [90, [102, 102, 102]], [91, [241, 76, 76]], [92, [35, 209, 139]], [93, [245, 245, 67]],
  [94, [59, 142, 234]], [95, [214, 112, 214]], [96, [41, 184, 219]], [97, [255, 255, 255]],
];
function ansi16Index(r, g, b) {
  let best = 37, bd = 1e9;
  for (const [code, [cr, cg, cb]] of ANSI16) {
    const d = (cr - r) ** 2 + (cg - g) ** 2 + (cb - b) ** 2;
    if (d < bd) { bd = d; best = code; }
  }
  return best;
}
export function paint(text, hex) { return fg(hex) + text + RESET; }
export function mix(h1, h2, t) {
  const a = hexToRgb(h1), b = hexToRgb(h2);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}
/** Paint each char along a multi-stop gradient. */
export function gradient(text, stops) {
  const chars = [...text];
  if (chars.length <= 1 || stops.length === 1) return paint(text, stops[0]);
  const segs = stops.length - 1;
  return chars.map((ch, i) => {
    const t = i / (chars.length - 1);
    const seg = Math.min(segs - 1, Math.floor(t * segs));
    return paint(ch, mix(stops[seg], stops[seg + 1], (t * segs) - seg));
  }).join('');
}

/**
 * Full-bleed background fill, opencode-style: paint `line` on `bgHex`,
 * re-applying bg after every RESET (fg closes, modals, nested spans all
 * reset), then pad with bg-painted spaces to width W. The caller must emit
 * EL (`\x1b[K`) while bg is still active — see Screen.frame in app.mjs.
 */
export function bgLine(line, W, bgHex) {
  const B = bg(bgHex);
  if (!B) return line;
  const painted = String(line).split(RESET).join(RESET + B);
  const d = width(line);
  const fill = d >= W ? '' : B + ' '.repeat(W - d);
  return B + painted + fill + RESET;
}

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
export function strip(s) { return String(s).replace(ANSI_RE, ''); }

/** Display width (wcwidth-lite): 0 combining/control, 2 wide/emoji. */
export function width(s) {
  let w = 0;
  for (const ch of strip(s)) {
    const cp = ch.codePointAt(0);
    w += charWidth(cp);
  }
  return w;
}
function charWidth(cp) {
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if ((cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x1ab0 && cp <= 0x1aff) || (cp >= 0x1dc0 && cp <= 0x1dff) ||
      (cp >= 0x20d0 && cp <= 0x20ff) || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xfe20 && cp <= 0xfe2f) ||
      cp === 0x200d || cp === 0x200b) return 0;
  if ((cp >= 0x1100 && cp <= 0x115f) || cp === 0x2329 || cp === 0x232a ||
      (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x20000 && cp <= 0x3fffd)) return 2;
  return 1;
}

/** Truncate a styled string to a display width, preserving escapes + reset. */
export function truncate(s, w) {
  let out = '', used = 0, i = 0;
  const str = String(s);
  while (i < str.length && used < w) {
    if (str[i] === '\x1b') {
      const m = str.slice(i).match(/^\x1b\[[0-9;?]*[ -/]*[@-~]/);
      if (m) { out += m[0]; i += m[0].length; continue; }
    }
    const cp = str.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const cw = charWidth(cp);
    if (used + cw > w) break;
    out += ch; used += cw; i += ch.length;
  }
  return out + (i < str.length ? RESET : '');
}
export function padEnd(s, w, fill = ' ') {
  const d = width(s);
  return d >= w ? s : s + fill.repeat(w - d);
}

/** Word-wrap a styled/plain string to width. Returns array of styled lines. */
export function wrap(s, w) {
  const out = [];
  for (const rawLine of String(s).split('\n')) {
    const words = rawLine.split(/(\s+)/);
    let line = '', used = 0;
    const push = () => { out.push(line); line = ''; used = 0; };
    for (const word of words) {
      const ww = width(word);
      if (ww === 0) { line += word; continue; }
      if (used + ww > w && used > 0) {
        if (/^\s+$/.test(word)) continue;
        push();
      }
      if (ww > w) {
        // hard-break long token
        for (const ch of word) {
          const cw = charWidth(ch.codePointAt(0));
          if (used + cw > w) push();
          line += ch; used += cw;
        }
        continue;
      }
      line += word; used += ww;
    }
    push();
  }
  return out;
}

/** A styled line: array of {text, style} spans we can measure and compose. */
export function spans(line) { return [{ text: String(line) }]; }
export function cat(...styled) { return styled.join(''); }

export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
export const DOTS = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'];
export function bar(frac, w, { filled = '█', empty = '░' } = {}) {
  const n = Math.max(0, Math.min(1, frac));
  const f = Math.round(n * w);
  return filled.repeat(f) + empty.repeat(w - f);
}
