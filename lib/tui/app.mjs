/**
 * carthagent TUI — a split-terminal delivery console on top of the bundled engine's `--mode rpc`.
 *
 *   ┌ header: 𐤀 · model · status · elapsed · tokens · cost ──────────┐
 *   │ RUN TERMINAL (live feed)          │ PLAN (live d2 flowchart +   │
 *   │                                   │ checks + fingerprint)      │
 *   │ › input box / footer hints                                     │
 *   └─────────────────────────────────────────────────────────────────┘
 */
import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { planD2, computePhase, freshChecks, coverageReport, verificationMode } from '../delivery.mjs';
import { parseD2, renderD2 } from './d2.mjs';
import { resolveGlyphs, spinnerFrame } from './glyphs.mjs';
import { createFeed, resetFeed, applyEvent, echoUser, echoBash, notice, renderFeed, runline, hydrateFeed } from './feed.mjs';
import { getTheme, resolveThemeName, detectTermMode, THEME_NAMES } from './theme.mjs';
import { frameHint, framePrompt, shouldFrame } from './framing.mjs';
import { locateEngine, buildEngineArgs, listSessions, mostRecentSession } from '../engine.mjs';
import { normalizeReviewMode, resolveReviewMode, saveCarthagentConfig, carthagentConfigPath, reviewKickoff, shouldOfferReview } from '../review.mjs';
import { authTypeLabel, applyAuthEvent, createCloudBillingLink, filterLoginProviders, formatCloudAccount, hasConfiguredProvider, loadAuthRuntime, loadCloudAccount, loginAndRefresh, loginProviderFocus, loginProviderList, newAuthState, revokeCloudSession } from './auth.mjs';
import { openBrowser } from '../cloud/client.mjs';
import { readClipboard, writeClipboard, sanitizePaste } from './clipboard.mjs';
import { modelMatchesQuery, providersFromModels } from './models.mjs';
import { pickerKey, commitPicker } from './picker.mjs';
import { RESET, BOLD, ITALIC, fg, bg, width, strip, truncate, padEnd, bar, bgLine, colorDepth, sliceCols, inverseCols } from './ansi.mjs';

export { locateEngine, buildEngineArgs };

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const CTG_BIN = join(ROOT, 'bin', 'ctg.mjs');

// ------------------------------------------------------------------ RPC client

class EngineRpc {
  constructor() { this.listeners = []; this.pending = new Map(); this.reqId = 0; this.buf = ''; this.proc = null; this.stderrTail = ''; this.gen = 0; }
  /** (Re)spawn the engine child. Calling again force-restarts a wedged process;
   *  events from the previous generation are ignored. */
  start({ cmd, args, cwd, env }) {
    const gen = ++this.gen;
    try { this.proc?.kill('SIGKILL'); } catch { }
    this.buf = ''; this.stderrTail = ''; this.exited = null;
    for (const p of this.pending.values()) p.reject(new Error('agent process restarted'));
    this.pending.clear();
    this.proc = spawn(cmd, args, { cwd, env: env || process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stdout.on('data', d => {
      if (gen !== this.gen) return;
      this.buf += d.toString();
      let i;
      while ((i = this.buf.indexOf('\n')) !== -1) {
        const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
        if (!line.trim()) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        this.dispatch(msg);
      }
    });
    this.proc.stderr.on('data', d => { if (gen !== this.gen) return; this.stderrTail = (this.stderrTail + d).slice(-4000); });
    this.proc.on('exit', (code, sig) => {
      if (gen !== this.gen) return;
      this.exited = { code, sig };
      for (const l of this.listeners) l({ type: '__exit__', code, sig });
      for (const p of this.pending.values()) p.reject(new Error(`agent exited (${code})`));
      this.pending.clear();
    });
    this.proc.on('error', e => { if (gen !== this.gen) return; for (const l of this.listeners) l({ type: '__error__', error: e }); });
  }
  dispatch(msg) {
    if (msg.type === 'response' && msg.id && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id); this.pending.delete(msg.id);
      msg.success === false ? p.reject(new Error(msg.error || 'rpc error')) : p.resolve(msg.data);
      return;
    }
    for (const l of this.listeners) l(msg);
  }
  onEvent(l) { this.listeners.push(l); }
  send(cmd) {
    const id = `r${++this.reqId}`;
    return new Promise((res, rej) => {
      if (this.exited || !this.proc?.stdin?.writable) return rej(new Error('agent process is not running'));
      this.pending.set(id, { resolve: res, reject: rej });
      try { this.proc.stdin.write(JSON.stringify({ ...cmd, id }) + '\n'); }
      catch (e) { this.pending.delete(id); rej(e); }
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error(`timeout: ${cmd.type}`)); } }, 30000);
    });
  }
  replyExtensionUi(id, value) {
    try { this.proc?.stdin?.write(JSON.stringify({ type: 'extension_ui_response', id, cancelled: true, ...value }) + '\n'); } catch { }
  }
  kill() { const proc = this.proc; try { proc?.kill('SIGTERM'); } catch { } setTimeout(() => { try { proc?.kill('SIGKILL'); } catch { } }, 800); }
}

// ------------------------------------------------------------------ screen

class Screen {
  constructor() { this.prev = []; this.w = 0; this.h = 0; this.onResize = null; this.bgHex = null; }
  enter() {
    const out = process.stdout;
    this.w = out.columns || 80; this.h = out.rows || 24;
    out.write('\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1002h\x1b[?1006h\x1b[?2004h\x1b[2J');
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    // 'resize' on stdout is emitted on all platforms (SIGWINCH doesn't exist on Windows)
    this._winch = () => { this.w = out.columns; this.h = out.rows; this.prev = []; this.onResize?.(); };
    out.on('resize', this._winch);
    process.on('SIGWINCH', this._winch);
  }
  exit() {
    const out = process.stdout;
    out.off('resize', this._winch);
    process.off('SIGWINCH', this._winch);
    process.stdin.setRawMode?.(false);
    out.write('\x1b[?2004l\x1b[?1006l\x1b[?1002l\x1b[?1000l\x1b[?25h\x1b[?2026l\x1b[?1049l');
  }
  /** Diff-write a frame: lines[] of styled strings, then place cursor.
   * Each line is full-bleed painted on this.bgHex (set per-frame by render):
   * bg is re-applied after every RESET inside the line, and EL runs while bg
   * is still active so erased cells keep the fill instead of flashing default. */
  frame(lines, cursor) {
    const out = process.stdout;
    const B = this.bgHex ? bg(this.bgHex) : '';
    let s = '\x1b[?2026h';
    for (let y = 0; y < lines.length; y++) {
      if (this.prev[y] === lines[y]) continue;
      s += `\x1b[${y + 1};1H` + (B ? lines[y].split(RESET).join(RESET + B) + B + '\x1b[K' + RESET : lines[y] + '\x1b[K');
    }
    for (let y = lines.length; y < this.prev.length; y++) s += `\x1b[${y + 1};1H` + (B ? B + '\x1b[K' + RESET : '\x1b[K');
    if (cursor) s += `\x1b[${cursor.y};${cursor.x}H\x1b[?25h`;
    else s += '\x1b[?25l';
    s += '\x1b[?2026l';
    out.write(s);
    this.prev = lines;
    this.plain = lines.map(strip); // text-only copy for drag-select extraction
  }
}

// ------------------------------------------------------------------ keys

const KEY_SEQS = {
  '\x1b[A': 'up', '\x1b[B': 'down', '\x1b[C': 'right', '\x1b[D': 'left',
  '\x1b[H': 'home', '\x1b[F': 'end', '\x1b[1~': 'home', '\x1b[4~': 'end',
  '\x1b[3~': 'delete', '\x1b[5~': 'pgup', '\x1b[6~': 'pgdn', '\x1b[Z': 'stab',
  '\x1bOH': 'home', '\x1bOF': 'end', '\x1bOA': 'up', '\x1bOB': 'down', '\x1bOC': 'right', '\x1bOD': 'left',
  // Modified delete / backspace sequences (Cmd, Ctrl, Alt)
  '\x1b[3;5~': 'ctrl-delete', '\x1b[3;3~': 'alt-delete', '\x1b[3;2~': 'shift-delete',
  '\x1b[3;9~': 'cmd-delete', '\x1b[3;10~': 'cmd-delete',
  // xterm modifyOtherKeys backspace (127) and delete (8)
  '\x1b[27;5;127~': 'ctrl-backspace', '\x1b[27;3;127~': 'alt-backspace', '\x1b[27;2;127~': 'backspace',
  '\x1b[27;9;127~': 'cmd-delete', '\x1b[27;10;127~': 'cmd-delete',
  '\x1b[27;5;8~': 'ctrl-backspace', '\x1b[27;9;8~': 'cmd-delete',
  // Kitty keyboard protocol
  '\x1b[127;5u': 'ctrl-backspace', '\x1b[127;3u': 'alt-backspace', '\x1b[127;2u': 'backspace',
  '\x1b[127;8u': 'cmd-delete', '\x1b[127;9u': 'cmd-delete', '\x1b[127;10u': 'cmd-delete',
  '\x1b[127;13u': 'cmd-delete', '\x1b[127;14u': 'cmd-delete',
  '\x1b[8;5u': 'ctrl-backspace', '\x1b[8;3u': 'alt-backspace', '\x1b[8;9u': 'cmd-delete',
  '\x1b\x7f': 'alt-backspace', '\x1b\x08': 'alt-backspace',
};

export function makeKeyParser(onKey) {
  let buf = '', pasting = false, escTimer = null;
  const flushEsc = () => { if (buf === '\x1b') { buf = ''; onKey({ key: 'esc' }); } };
  return chunk => {
    buf += chunk;
    // bracketed paste passthrough
    for (;;) {
      if (pasting) {
        const end = buf.indexOf('\x1b[201~');
        if (end === -1) { const keep = buf.length > 8 ? buf.slice(0, -8) : ''; const emit = buf.slice(0, keep ? buf.length - 8 : buf.length); if (emit) onKey({ key: 'paste', text: emit.replace(/\r/g, '') }); buf = buf.slice(emit.length); if (!keep) return; continue; }
        const emit = buf.slice(0, end); if (emit) onKey({ key: 'paste', text: emit.replace(/\r/g, '') });
        buf = buf.slice(end + 6); pasting = false; continue;
      }
      const ps = buf.indexOf('\x1b[200~');
      if (ps === 0) { pasting = true; buf = buf.slice(6); continue; }
      break;
    }
    // mouse SGR — carry 1-based cell coords so scroll can route by pane
    for (;;) {
      const m = buf.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
      if (!m) break;
      buf = buf.slice(m[0].length);
      const raw = +m[1];
      const b = raw & ~28; // strip shift/alt/ctrl modifier bits; low bits carry the button
      const at = { x: +m[2], y: +m[3], ctrl: !!(raw & 16), alt: !!(raw & 8), shift: !!(raw & 4) };
      if (m[4] === 'm') onKey({ key: 'mouseup', button: b, ...at });
      else if (b === 64) onKey({ key: 'wheelup', ...at });
      else if (b === 65) onKey({ key: 'wheeldown', ...at });
      else if (b & 32) onKey({ key: 'mousedrag', button: b & ~32, ...at });
      else onKey({ key: 'mousedown', button: b, ...at });
    }
    // escape sequences
    for (;;) {
      let done = false;
      for (const seq of Object.keys(KEY_SEQS).sort((a, b) => b.length - a.length)) {
        if (buf.startsWith(seq)) { onKey({ key: KEY_SEQS[seq] }); buf = buf.slice(seq.length); done = true; break; }
      }
      if (done) continue;
      if (buf === '\x1b') { clearTimeout(escTimer); escTimer = setTimeout(flushEsc, 40); return; }
      if (buf.startsWith('\x1b')) {
        const rest = buf.slice(1);
        if (/^\[<[\d;]*$/.test(rest)) return; // incomplete SGR mouse report — wait for M/m terminator
        if ('\x1b['.startsWith(buf.slice(0, 2)) && buf.length < 16 && /[\[\d;?<$u~]/.test(rest)) return; // incomplete seq
        if (rest.length >= 1) { buf = rest; if (buf.startsWith('\x1b')) { buf = buf.slice(1); onKey({ key: 'esc' }); } continue; }
      }
      break;
    }
    // plain input
    let i = 0;
    while (i < buf.length) {
      const c = buf[i];
      if (c === '\x1b') break;
      const cp = buf.codePointAt(i);
      const ch = String.fromCodePoint(cp);
      i += ch.length;
      const code = cp;
      if (code === 13 || code === 10) onKey({ key: 'enter' });
      else if (code === 127 || code === 8) onKey({ key: 'backspace' });
      else if (code === 3) onKey({ key: 'ctrl-c' });
      else if (code === 20) onKey({ key: 'ctrl-t' });
      else if (code === 18) onKey({ key: 'ctrl-r' });
      else if (code === 14) onKey({ key: 'ctrl-n' });
      else if (code === 12) onKey({ key: 'ctrl-l' });
      else if (code === 21) onKey({ key: 'ctrl-u' });
      else if (code === 23) onKey({ key: 'ctrl-w' });
      else if (code === 25) onKey({ key: 'ctrl-y' });
      else if (code === 22) onKey({ key: 'ctrl-v' });
      else if (code === 1) onKey({ key: 'home' });
      else if (code === 5) onKey({ key: 'end' });
      else if (code === 11) onKey({ key: 'ctrl-k' });
      else if (code === 9) onKey({ key: 'tab' });
      else if (code === 24) onKey({ key: 'x' });
      else if (code >= 32) onKey({ key: 'char', ch });
    }
    buf = buf.slice(i);
  };
}

// ------------------------------------------------------------------ slash commands

/** Single source of truth for slash-command discovery (autocomplete + /help).
 *  Keep in sync with the `slash()` executor switch below — names here must
 *  resolve to a real case there, or the popup will offer a no-op command. */
const SLASH_COMMANDS = [
  { name: '/help', desc: 'show keys and commands' },
  { name: '/resume', aliases: ['/sessions'], args: '[id|name]', desc: 'resume a session' },
  { name: '/new', desc: 'start a fresh session' },
  { name: '/restart', aliases: ['/kill'], desc: 'force-restart the agent (resumes session)' },
  { name: '/theme', args: '[name]', desc: 'pick or set the theme' },
  { name: '/model', args: '[name]', desc: 'pick or set the model' },
  { name: '/thinking', desc: 'set the thinking level' },
  { name: '/compact', args: '[notes]', desc: 'compact the context window' },
  { name: '/review', aliases: ['/review-mode'], args: '[ask|yes|no|status]', desc: 'self-review loop control' },
  { name: '/export', args: '[file]', desc: 'export the session to HTML' },
  { name: '/stats', desc: 'show session token/cost stats' },
  { name: '/clear', desc: 'clear the message feed' },
  { name: '/abort', desc: 'abort the current run' },
  { name: '/raw', args: '<prompt>', desc: 'send without delivery framing' },
  { name: '/guide', args: '[task]', desc: 'toggle or run phased delivery framing' },
  { name: '/login', aliases: ['/auth'], desc: 'connect an AI provider' },
  { name: '/account', aliases: ['/cloud'], desc: 'show Cloud credit, plan, and sessions' },
  { name: '/billing', args: '[checkout|portal]', desc: 'open Cloud billing' },
  { name: '/logout-cloud', args: '[session-id]', desc: 'revoke a Cloud CLI session' },
  { name: '/quit', aliases: ['/q', '/exit'], desc: 'quit carthagent' },
];

/** Pure filter for slash-command autocomplete. `q` is the buffer text starting
 *  with '/'. Returns matching command entries (name or alias startsWith q).
 *  Returns [] once a space appears (we're past the command token, into args). */
export function matchSlash(q, list = SLASH_COMMANDS) {
  if (!q.startsWith('/') || q.includes(' ')) return [];
  const ql = q.toLowerCase();
  return list.filter(c => c.name.toLowerCase().startsWith(ql)
    || (c.aliases || []).some(a => a.toLowerCase().startsWith(ql)));
}

export function isCloudCreditExhaustion(event, activeModel = '') {
  const message = event?.message;
  if (event?.type !== 'message_end' || message?.role !== 'assistant' || message.stopReason !== 'error') return false;
  const provider = message.provider || String(activeModel).split('/')[0];
  if (provider !== 'experiential-labs') return false;
  return /insufficient_quota|insufficient.credit|credit (?:is )?exhausted/i.test(String(message.errorMessage || ''));
}

/** Compute geometry for the slash-command autocomplete card.
 *  The card is left-justified (aligned with prompt area: x0 = 2) and sized
 *  adequately to hold command details without border overflow. */
export function slashCardDimensions(W) {
  const cardW = Math.max(16, Math.min(W - 4, 88));
  const innerW = Math.max(2, cardW - 2);
  const x0 = Math.min(2, Math.max(0, W - cardW));
  return { cardW, innerW, x0 };
}

/** Render slash autocomplete card lines for testing and TUI rendering. */
export function syncActiveModel(state, feed, model) {
  if (!model?.provider || !model?.id) return;
  state.model = `${model.provider}/${model.id}`;
  let changed = false;
  for (const block of feed.blocks) {
    if (block.kind === 'welcome' && block.model !== state.model) {
      block.model = state.model;
      changed = true;
    }
  }
  if (changed) feed.version++;
}

export function renderSlashCard(items, sel, W, t = {}, G = { active: '●' }) {
  const { cardW, innerW, x0 } = slashCardDimensions(W);
  const accent = t.primary || t.accent || '#888';
  const faint = t.textMuted || t.faint || '#666', muted = t.muted || faint;
  const bc = accent;
  const row = core => fg(bc) + '│' + RESET + padEnd(truncate(core, innerW), innerW) + fg(bc) + '│' + RESET;
  const card = [];
  const title = ' commands ';
  card.push(fg(bc) + '╭' + '─'.repeat(2) + RESET + fg(muted) + title + RESET + fg(bc) + '─'.repeat(Math.max(0, innerW - 2 - title.length)) + '╮' + RESET);
  const maxRows = Math.min(items.length, 8);
  const selIdx = Math.min(sel, Math.max(0, items.length - 1));
  const start = Math.max(0, selIdx - maxRows + 1);
  for (let i = start; i < start + maxRows; i++) {
    const c = items[i];
    if (!c) { card.push(row('')); continue; }
    const isSel = i === selIdx;
    const marker = isSel ? fg(accent) + G.active + RESET : ' ';
    const aliases = c.aliases?.length ? fg(faint) + ' (' + c.aliases.join(', ') + ')' + RESET : '';
    const args = c.args ? fg(faint) + ' ' + c.args + RESET : '';
    const nameCol = (isSel ? fg(accent) + BOLD : fg(t.text || '#eee')) + c.name + RESET;
    const descCol = fg(faint) + ' — ' + c.desc + RESET;
    const core = ' ' + marker + ' ' + nameCol + aliases + args + descCol;
    card.push(row(core));
  }
  const hints = ` ${items.length ? selIdx + 1 : 0}/${items.length} · ↑↓ browse · Tab complete · Enter activate · Esc dismiss `;
  card.push(row(fg(faint) + hints + RESET));
  card.push(fg(bc) + '╰' + '─'.repeat(innerW) + '╯' + RESET);
  return { card, cardW, innerW, x0 };
}

// Manual plan-scroll sentinel: null/PLAN_FOLLOW = auto-follow frontier.
const PLAN_FOLLOW = -1;

/** Rail width tiers: wider terminals get a wider PLAN rail (still split). */
export function planSideWidth(W) {
  if (W >= 200) return Math.min(84, Math.floor(W * 0.42));
  if (W >= 160) return Math.min(72, Math.floor(W * 0.40));
  if (W >= 120) return Math.min(64, Math.floor(W * 0.38));
  return Math.max(34, Math.min(56, Math.floor(W * 0.36)));
}

/** Map a scrolling viewport onto a scrollbar track: the thumb {pos,len} in
 * cells, or null when the content already fits (nothing to scroll). */
export function barRange(viewport, total, start) {
  if (viewport <= 0 || total <= viewport) return null;
  const len = Math.max(1, Math.round(viewport * viewport / total));
  const maxStart = Math.max(1, total - viewport);
  const clamped = Math.min(Math.max(0, start || 0), maxStart);
  const pos = Math.min(viewport - len, Math.round((viewport - len) * clamped / maxStart));
  return { pos, len };
}

/** One scrollbar cell in the active theme: a faint track and a brighter thumb
 * (accent while its pane is focused). Carries no background — the pane paints it. */
export function scrollCell(glyphs, kind, focused, t) {
  if (kind !== 'thumb' && kind !== 'track') return ' ';
  const track = t.borderSubtle || t.border || t.textMuted;
  const thumb = focused ? (t.primary || t.accent) : (t.secondary || t.accent2 || t.textMuted || t.borderActive);
  return fg(kind === 'thumb' ? thumb : track) + (kind === 'thumb' ? glyphs.scrollThumb : glyphs.scrollTrack) + RESET;
}

// ------------------------------------------------------------------ editor

class Editor {
  constructor() { this.buf = ''; this.cur = 0; this.history = []; this.hi = -1; this.saved = ''; }
  insert(s) { this.buf = this.buf.slice(0, this.cur) + s + this.buf.slice(this.cur); this.cur += s.length; }
  backspace() { if (this.cur > 0) { this.buf = this.buf.slice(0, this.cur - 1) + this.buf.slice(this.cur); this.cur--; } }
  del() { this.buf = this.buf.slice(0, this.cur) + this.buf.slice(this.cur + 1); }
  wordBack() { const m = this.buf.slice(0, this.cur).match(/\S+\s*$/); if (m) { this.buf = this.buf.slice(0, this.cur - m[0].length) + this.buf.slice(this.cur); this.cur -= m[0].length; } }
  killEnd() { this.buf = this.buf.slice(0, this.cur); }
  clear() { this.buf = ''; this.cur = 0; }
  up() { if (!this.history.length) return; if (this.hi === -1) { this.saved = this.buf; this.hi = this.history.length - 1; } else if (this.hi > 0) this.hi--; this.buf = this.history[this.hi]; this.cur = this.buf.length; }
  down() { if (this.hi === -1) return; if (this.hi < this.history.length - 1) { this.hi++; this.buf = this.history[this.hi]; } else { this.hi = -1; this.buf = this.saved; } this.cur = this.buf.length; }
  take() { const v = this.buf; if (v.trim()) { this.history.push(v); if (this.history.length > 200) this.history.shift(); } this.hi = -1; this.clear(); return v; }
}

// ------------------------------------------------------------------ delivery → graph states

export function computeNodeStates(delivery, checksRunning, checkRunId, currentHash) {
  const states = new Map();
  const plan = delivery?.plan;
  if (!plan) return { states, checkRows: [], status: null, allFresh: false, anyFail: false };
  const ev = delivery.evidence || {};
  const status = delivery.status || 'implementing';
  const checks = plan.checks || [];
  let firstQueued = false;
  const checkRows = checks.map(c => {
    const e = ev[c.id];
    let st = 'pending';
    if (e) st = e.passed ? 'done' : 'fail';
    const stale = !!(e?.passed && currentHash && e.fingerprint && e.fingerprint !== currentHash);
    if (stale) st = 'stale';
    if (checksRunning && !e) {
      // during an id="all" run the first pending row is the one executing
      const isCurrent = checkRunId === 'all' ? !firstQueued : checkRunId === c.id;
      st = isCurrent ? 'running' : 'queued';
      if (isCurrent) firstQueued = true;
    }
    return { id: c.id, kind: c.kind, st, code: e?.code, ms: e?.durationMs, required: c.id.startsWith('required_') };
  });
  const allPass = checks.length > 0 && checkRows.every(r => r.st === 'done');
  const allFresh = allPass && !checkRows.some(r => r.st === 'stale');
  const anyFail = checkRows.some(r => r.st === 'fail');
  states.set('goal', 'done');
  const implActive = status === 'implementing' || status === 'planned';
  const stepStatus = delivery.stepStatus || {};
  const stepStates = (plan.steps || []).map((_, i) => stepStatus[`step${i}`]);
  // Exactly one "current" step: the first explicit active, else the first
  // step not already done/failed. Previously every unmarked step rendered as
  // active while implementing, so the D2 rail lit a swirl on the whole plan
  // and auto-follow pinned to step0 no matter where the agent actually was.
  let current = stepStates.findIndex(s => s === 'active');
  if (current < 0) current = stepStates.findIndex(s => s !== 'done' && s !== 'failed');
  (plan.steps || []).forEach((_, i) => {
    const st = stepStates[i];
    if (st === 'done') states.set(`step${i}`, 'done');
    else if (st === 'failed') states.set(`step${i}`, 'fail');
    else if (!implActive) states.set(`step${i}`, 'done');
    else if (i === current) states.set(`step${i}`, 'active');
    else if (i < current) states.set(`step${i}`, 'done');
    else states.set(`step${i}`, 'pending');
  });
  let verify = 'pending';
  const informative = verificationMode(plan) !== 'required';
  if (informative && checks.length === 0) verify = 'done';
  else if (anyFail) verify = 'fail';
  else if (checksRunning || status === 'verifying') verify = 'active';
  else if (allFresh && status === 'verified') verify = 'done';
  else if (allPass) verify = 'done';
  if (status === 'blocked' && !checksRunning) verify = anyFail ? 'fail' : 'blocked';
  states.set('verify', verify);
  states.set('repair', anyFail && !informative ? 'fail' : 'pending');
  states.set('review', status === 'verified' ? 'done' : (allPass && !anyFail) || informative ? 'active' : 'pending');
  states.set('deliver', status === 'verified' ? 'done' : status === 'blocked' ? 'blocked' : 'pending');
  return { states, checkRows, status, allFresh, anyFail };
}

// ------------------------------------------------------------------ app

export async function runTui(opts) {
  const cwd = opts.cwd || process.cwd();
  const termMode = detectTermMode(process.env);
  const T = { theme: getTheme(resolveThemeName(opts.theme), termMode) };
  const G = resolveGlyphs({ ascii: opts.ascii, mode: opts.glyphs });
  const spin = frame => spinnerFrame(G, frame);
  const feed = createFeed();
  const screen = new Screen();
  const editor = new Editor();
  const rpc = new EngineRpc();

  const state = {
    view: 'split',           // split | feed | plan
    scroll: 0,               // feed scroll offset from bottom
    expand: false,
    running: false,
    sessionId: null,
    model: opts.model || '',
    thinking: opts.thinking || '',
    isCompacting: false,
    checkRunId: null,
    runStarted: 0,
    runEnded: 0,
    delivery: null,          // report.json contents
    d2Source: '',
    d2Graph: null,
    currentHash: '',
    checkToolRunning: false,
    lastActivity: Date.now(),
    toast: null,             // {text, tone, until}
    startedAt: Date.now(),
    focusPane: 'feed', // split-view scroll focus: 'feed' | 'plan'
    planScroll: null, // null = auto-follow frontier; number = manual graph start row
    autoFraming: opts.autoFraming ?? true, // phased delivery framing for plain prompts
    stats: null,             // get_session_stats payload
    overlay: null,           // settings overlay: { row: 0=theme,1=provider,2=model,3=thinking, provider?, search?, modelSel? }
    modelList: null,         // cached get_available_models response [{provider,id,...}]
    sessionFile: null,       // current session .jsonl path (get_state.sessionFile)
    sessionName: null,
    abortAt: 0,              // soft-abort requested at; esc/^c again force-restarts the engine
    sessions: null,          // resume picker: { items, sel, search }
    slash: null,             // slash-command autocomplete: { items, sel }
    hydrated: false,         // feed was rebuilt from a session file
    sel: null,               // active mouse selection {ax,ay,bx,by,dragged}
    runWrites: 0,            // write/edit tool calls in the current run
    reviewOffer: null,       // pending self-review offer {reason}
    reviewLoop: false,       // a self-review loop is running — suppress re-offers
    reviewOfferedRuns: new Set(), // run keys already offered (dedupe)
    reviewPendingVerified: false, // report.json flipped to verified this run
    auth: null,              // connect-provider popup: see lib/tui/auth.mjs
    cloudRecoveryOfferedAt: 0,
  };

  // ---- spawn agent
  let engineCmd;
  if (opts.demo) engineCmd = { cmd: process.execPath, args: [join(__dirname, 'mock-engine.mjs')] };
  else {
    try { engineCmd = locateEngine(opts.engineCli); }
    catch (e) { console.error(e.message); process.exit(1); }
  }

  const baseArgs = () => opts.demo ? engineCmd.args : [...engineCmd.args, '--mode', 'rpc', ...buildEngineArgs({ isolate: true, ...opts, cwd })];
  const spawnEngine = (extraArgs = []) => rpc.start({
    cmd: engineCmd.cmd,
    args: [...baseArgs(), ...extraArgs],
    cwd,
    env: {
      ...process.env,
      CARTHAGENT_CODING_AGENT_DIR: process.env.CARTHAGENT_CODING_AGENT_DIR || join(os.homedir(), '.carthagent', 'agent'),
      PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR || process.env.CARTHAGENT_CODING_AGENT_DIR || join(os.homedir(), '.carthagent', 'agent')
    }
  });
  spawnEngine();

  // ---- fingerprint worker
  let hashWorker = null, hashBusy = false;
  try {
    hashWorker = new Worker(new URL('./hash-worker.mjs', import.meta.url));
    hashWorker.on('message', m => { if (m.hash) { if (state.currentHash && state.currentHash !== m.hash) feed.version++; state.currentHash = m.hash; } hashBusy = false; });
    hashWorker.on('error', () => { hashBusy = false; });
  } catch { hashWorker = null; }
  const hashTick = () => {
    if (!hashWorker || hashBusy) return;
    hashBusy = true;
    hashWorker.postMessage({ cwd, roots: ['.'] });
  };

  // ---- harness watcher: newest report.json + plan.d2 under .harness/<sessionId>/
  const readHarness = () => {
    if (!state.sessionId) return;
    try {
      const base = join(cwd, '.harness', state.sessionId);
      if (!existsSync(base)) return;
      let best = null;
      for (const run of readdirSync(base)) {
        const rp = join(base, run, 'report.json');
        try { const mt = statSync(rp).mtimeMs; if (!best || mt > best.mt) best = { mt, dir: join(base, run), rp }; } catch { }
      }
      if (!best) return;
      const report = JSON.parse(readFileSync(best.rp, 'utf8'));
      const d2p = join(best.dir, 'plan.d2');
      const d2 = existsSync(d2p) ? readFileSync(d2p, 'utf8') : (report.plan ? planD2(report.plan) : '');
      const prevStatus = state.delivery?.status;
      state.delivery = report;
      if (d2 && d2 !== state.d2Source) { state.d2Source = d2; state.d2Graph = parseD2(d2); state.planScroll = PLAN_FOLLOW; }
      if (report.status !== prevStatus) state.lastActivity = Date.now();
      if (report.status === 'verified' && prevStatus !== 'verified') state.reviewPendingVerified = true;
      feed.version++;
    } catch { /* transient parse while file being written */ }
  };

  // ---- instant plan preview from delivery_plan tool call args
  const previewPlan = planArgs => {
    try {
      const d2 = planD2(planArgs);
      if (d2 && d2 !== state.d2Source) { state.d2Source = d2; state.d2Graph = parseD2(d2); state.planScroll = PLAN_FOLLOW; }
      if (!state.delivery || !state.delivery.plan) state.delivery = { status: 'implementing', plan: planArgs, evidence: {} };
      state.lastActivity = Date.now();
    } catch { }
  };

  // ---- RPC event handling
  rpc.onEvent(ev => {
    if (ev.type === '__exit__') {
      notice(feed, `agent process exited (code ${ev.code}${ev.sig ? `, ${ev.sig}` : ''})${rpc.stderrTail ? ` — ${rpc.stderrTail.split('\n').filter(Boolean).pop()}` : ''} — /restart respawns`, 'error');
      state.running = false;
      state.abortAt = 0;
      return;
    }
    if (ev.type === '__error__') { notice(feed, `agent process error: ${ev.error.message}`, 'error'); return; }
    applyEvent(feed, ev);
    if (isCloudCreditExhaustion(ev, state.model) && Date.now() - state.cloudRecoveryOfferedAt > 2_000) {
      state.cloudRecoveryOfferedAt = Date.now();
      notice(feed, 'Carthagent Cloud credit is exhausted — /billing checkout adds Builder credit; /login connects a direct BYOK provider.', 'warn');
    }
    if (ev.type === 'tool_execution_start') {
      if (ev.toolName === 'delivery_plan') previewPlan(ev.args);
      if (ev.toolName === 'delivery_check') { state.checkToolRunning = true; state.checkRunId = ev.args?.id; }
      if (ev.toolName === 'write' || ev.toolName === 'edit') state.runWrites++;
    }
    if (ev.type === 'tool_execution_end') {
      if (ev.toolName === 'delivery_check') { state.checkToolRunning = false; readHarness(); }
      if (ev.toolName === 'delivery_finish' && !ev.isError) {
        try {
          const r = JSON.parse((ev.result?.content || []).find(c => c.type === 'text')?.text || '{}');
          feed.blocks.push({ kind: 'banner', title: r.status === 'verified' ? 'verified' : 'blocked', tone: r.status === 'verified' ? 'ok' : 'warn', text: r.report || '', t: Date.now() });
          feed.version++;
        } catch { }
      }
      if (ev.toolName === 'delivery_plan') readHarness();
    }
    if (ev.type === 'agent_start') { state.running = true; state.abortAt = 0; state.runStarted = Date.now(); state.runEnded = 0; state.runWrites = 0; state.reviewOffer = null; }
    if (ev.type === 'agent_end' || ev.type === 'agent_settled') { state.running = false; state.abortAt = 0; state.runEnded = Date.now(); }
    if (ev.type === 'agent_settled') maybeOfferReview();
    if (ev.type === 'extension_ui_request') {
      if (['select', 'confirm', 'input', 'editor'].includes(ev.method)) {
        rpc.replyExtensionUi(ev.id, {});
        notice(feed, `extension dialog ${ev.method} auto-dismissed (TUI)`, 'warn');
      }
      if (ev.method === 'notify') state.toast = { text: ev.message, tone: ev.notifyType === 'warning' ? 'warn' : ev.notifyType || 'info', until: Date.now() + 4000 };
    }
    state.lastActivity = Date.now();
  });

  // ---- session state sync + restart/resume helpers
  const refreshState = () => rpc.send({ type: 'get_state' }).then(s => {
    state.sessionId = s.sessionId;
    state.sessionFile = s.sessionFile || null;
    state.sessionName = s.sessionName || null;
    syncActiveModel(state, feed, s.model);
    if (s.thinkingLevel) state.thinking = s.thinkingLevel;
    state.running = !!s.isStreaming;
    if (!s.isStreaming) state.abortAt = 0;
    return s;
  });

  /** Parse a session .jsonl into an entry list (tolerant of a partial tail line). */
  const readSessionEntries = file => {
    try {
      return readFileSync(file, 'utf8').split('\n')
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
    } catch { return []; }
  };

  /** Rebuild the feed from a session file (resume/switch/continue). */
  const hydrateFrom = file => {
    const entries = readSessionEntries(file);
    if (entries.length) { hydrateFeed(feed, entries); state.hydrated = true; }
  };

  /** Kill the agent child and respawn it on the same session file — the escape
   *  hatch when the process ignores `abort` (wedged stream, deadlocked tool). */
  const restartPi = async (why = 'restart') => {
    const resumeFile = !opts.demo && (state.sessionFile || mostRecentSession(cwd));
    notice(feed, `${why === 'force' ? 'agent unresponsive — force restarting' : 'restarting agent'}${resumeFile ? ' (resuming session)' : ''}…`, 'warn');
    state.running = false; state.abortAt = 0; state.checkToolRunning = false; state.isCompacting = false;
    feed.currentAssistant = feed.currentThinking = null;
    spawnEngine(resumeFile && existsSync(resumeFile) ? ['--session', resumeFile] : []);
    try {
      const s = await refreshState();
      notice(feed, `agent restarted · session ${String(state.sessionId || 'new').slice(0, 8)} · ${s.messageCount ?? 0} messages`, 'info');
      readHarness();
      feed.version++;
    } catch (e) {
      notice(feed, `agent restart failed: ${e.message}`, 'error');
    }
  };

  /** Soft abort: cancel the run and any queued steers/follow-ups (queued text
   *  returns to the editor). A second esc/^c while still running force-restarts. */
  const abortRun = () => {
    state.abortAt = Date.now();
    rpc.send({ type: 'clear_queue' }).then(q => {
      const queued = [...(q?.steering || []), ...(q?.followUp || [])].filter(Boolean);
      if (queued.length && !editor.buf) { editor.buf = queued[0]; editor.cur = editor.buf.length; }
    }).catch(() => { });
    rpc.send({ type: 'abort_retry' }).catch(() => { });
    rpc.send({ type: 'abort' }).catch(() => { });
    notice(feed, 'aborting… esc/^c again force-restarts agent', 'warn');
  };

  // ---- connect-provider popup (in-console auth; see lib/tui/auth.mjs)
  let authRuntime = null;
  let authAbort = null;
  let authPrompt = null; // { resolve, reject } for the pending engine prompt

  const authVisible = () => state.auth ? filterLoginProviders(state.auth.providers, state.auth.filter) : [];

  const authFinish = (error) => {
    const a = state.auth;
    authAbort = null; authPrompt = null;
    if (!a) return; // popup already closed (e.g. user cancelled)
    state.auth = null;
    if (error) notice(feed, `login failed: ${error.message}`, 'error');
    else if (opts.loginOnly) { screen.exit(); process.exit(0); }
    else if (a.provider) {
      notice(feed, `connected ${a.provider.name} — restarting agent`, 'info');
      state.modelList = null; // new provider may add models
      for (const block of feed.blocks) if (block.kind === 'welcome') { block.noProvider = false; block.model = state.model || block.model; }
      feed.version++;
      restartPi('auth').then(() => fetchModels()).catch(() => { });
    }
    feed.version++;
  };

  const authStart = (type) => {
    const a = state.auth;
    if (!a?.provider || !type) return;
    a.type = type; a.phase = 'waiting'; a.prompt = null; a.input = ''; a.error = '';
    a.message = type === 'oauth' ? 'Starting authorization…' : 'Enter your API key'; a.busy = true;
    authAbort = new AbortController();
    loginAndRefresh(authRuntime, a.provider.id, type, {
      signal: authAbort.signal,
      prompt: prompt => new Promise((resolve, reject) => {
        a.prompt = prompt; a.phase = 'prompt'; a.promptSel = 0; a.input = ''; a.busy = false;
        a.message = prompt.message || '';
        authPrompt = { resolve, reject };
        feed.version++;
      }),
      notify: event => { applyAuthEvent(a, event); feed.version++; },
    }).then(() => authFinish()).catch(error => {
      if (String(error?.message || '').includes('cancel')) authFinish(new Error('cancelled'));
      else authFinish(error);
    });
  };

  const authChooseProvider = row => {
    const a = state.auth;
    if (!row) return;
    a.provider = row; a.error = '';
    if (row.types.length > 1) { a.phase = 'type'; a.typeSel = 0; a.sel = 0; }
    else authStart(row.types[0]);
    feed.version++;
  };

  const authSubmitPrompt = value => {
    const pending = authPrompt;
    if (!pending) return;
    authPrompt = null;
    state.auth.prompt = null; state.auth.phase = 'waiting';
    state.auth.message = 'Verifying…'; state.auth.busy = true; state.auth.input = '';
    pending.resolve(value);
    feed.version++;
  };

  /** Ctrl+V in a text/secret prompt: read the OS clipboard and append it. */
  const authPasteClipboard = () => {
    readClipboard().then(text => {
      const a = state.auth;
      if (!a || a.phase !== 'prompt' || a.prompt?.type === 'select') return;
      a.input += sanitizePaste(text);
      feed.version++;
    });
  };

  const authCancel = () => {
    const a = state.auth;
    if (!a) return;
    const pending = authPrompt;
    authPrompt = null;
    if (pending) pending.reject(new Error('Login cancelled'));
    try { authAbort?.abort(); } catch { }
    authAbort = null;
    state.auth = null;
    if (opts.loginOnly) { screen.exit(); process.exit(0); }
    notice(feed, 'login cancelled', 'warn');
    feed.version++;
  };

  const openAuth = async ({ focusProviderId } = {}) => {
    if (opts.demo) { notice(feed, 'login is unavailable in demo mode', 'warn'); return; }
    if (state.auth) {
      if (!focusProviderId) { state.auth = null; feed.version++; return; }
      const visible = filterLoginProviders(state.auth.providers || [], state.auth.filter || '');
      const focused = visible.findIndex(provider => provider.id === focusProviderId);
      if (focused >= 0) { state.auth.sel = focused; feed.version++; }
      return;
    }
    state.auth = newAuthState();
    state.auth.message = 'Loading providers…';
    state.auth.busy = true;
    feed.version++;
    try {
      authRuntime = await loadAuthRuntime();
      const a = state.auth;
      if (!a) return; // closed while loading
      const activeProviderId = String(state.model || '').split('/')[0] || undefined;
      a.providers = loginProviderList(authRuntime, { activeProviderId });
      // When no provider is configured, always focus on Carthagent Cloud (the recommended row).
      const noProviderConfigured = !hasConfiguredProvider();
      a.sel = loginProviderFocus(a.providers, noProviderConfigured ? 'experiential-labs' : (focusProviderId || activeProviderId));
      a.busy = false; a.message = '';
    } catch (error) {
      if (state.auth) { state.auth.error = error.message; state.auth.busy = false; state.auth.message = ''; }
    }
    feed.version++;
  };

  const ensureAuthRuntime = async () => {
    authRuntime ||= await loadAuthRuntime();
    return authRuntime;
  };

  const showCloudAccount = async () => {
    try {
      const account = await loadCloudAccount(await ensureAuthRuntime());
      push2(formatCloudAccount(account));
      const active = (account.sessions || []).filter(session => !session.revoked_at);
      if (active.length) push2(active.map(session => `${session.id} · ${session.client_name || 'Carthagent CLI'} · last used ${session.last_used_at || session.created_at}`).join('\n'));
    } catch (error) {
      if (error.message === 'cloud_login_required') { notice(feed, 'Carthagent Cloud sign-in required — opening /login', 'warn'); openAuth({ focusProviderId: 'experiential-labs' }); }
      else notice(feed, `Cloud account: ${error.message}`, 'error');
    }
  };

  const openCloudBilling = async action => {
    try {
      const result = await createCloudBillingLink(await ensureAuthRuntime(), action);
      const opened = await openBrowser(result.url).catch(() => false);
      notice(feed, `${action === 'portal' ? 'billing portal' : 'Builder checkout'}${opened ? ' opened' : ''}: ${result.url}`, 'info');
      writeClipboard(result.url).then(() => { state.toast = { text: `billing URL ${opened ? 'opened and ' : ''}copied`, tone: 'info', until: Date.now() + 3000 }; }).catch(() => { });
    } catch (error) {
      if (error.message === 'cloud_login_required') { notice(feed, 'Carthagent Cloud sign-in required — opening /login', 'warn'); openAuth({ focusProviderId: 'experiential-labs' }); }
      else notice(feed, `Cloud billing: ${error.message}`, 'error');
    }
  };

  const revokeCloud = async sessionId => {
    if (!sessionId) { notice(feed, 'usage: /logout-cloud <session-id> — use /account to list sessions', 'warn'); return; }
    try {
      await revokeCloudSession(await ensureAuthRuntime(), sessionId);
      notice(feed, `revoked Cloud session ${sessionId}`, 'info');
    } catch (error) { notice(feed, `Cloud session: ${error.message}`, 'error'); }
  };

  // ---- slash-command autocomplete
  /** Recompute the popup from the editor buffer. Active only while the buffer
   *  is a single command token (starts with '/', no space yet). */
  const updateSlash = () => {
    const items = matchSlash(editor.buf);
    if (!items.length) { state.slash = null; return; }
    const prev = state.slash;
    state.slash = { items, sel: prev ? Math.min(prev.sel, items.length - 1) : 0 };
  };

  /** Replace the editor's command token with the selected command + trailing
   *  space, then dismiss the popup. Returns true if it acted. */
  const completeSlash = () => {
    if (!state.slash) return false;
    const item = state.slash.items[state.slash.sel];
    if (!item) return false;
    editor.buf = item.name + ' ';
    editor.cur = editor.buf.length;
    state.slash = null;
    return true;
  };

  // ---- resume picker
  const openSessionPicker = () => {
    if (opts.demo) { notice(feed, 'no saved sessions in demo mode', 'warn'); return; }
    const items = listSessions(cwd);
    if (!items.length) { notice(feed, `no saved sessions for ${cwd}`, 'warn'); return; }
    state.sessions = { items, sel: 0, search: '' };
  };

  const filteredSessions = () => {
    const p = state.sessions;
    if (!p) return [];
    const q = p.search.trim().toLowerCase();
    if (!q) return p.items;
    return p.items.filter(s => `${s.name || ''} ${s.firstMessage} ${s.id}`.toLowerCase().includes(q));
  };

  const switchSession = async item => {
    if (opts.demo) { notice(feed, 'no saved sessions in demo mode', 'warn'); return; }
    if (state.running) { notice(feed, 'run in progress — esc aborts first, then /resume', 'warn'); return; }
    try {
      const r = await rpc.send({ type: 'switch_session', sessionPath: item.path });
      if (r?.cancelled) { notice(feed, 'session switch cancelled by extension', 'warn'); return; }
      hydrateFrom(item.path);
      state.stats = null;
      rpc.send({ type: 'get_session_stats' }).then(st => { state.stats = st; }).catch(() => { });
      const s = await refreshState().catch(() => null);
      state.delivery = null; state.d2Source = ''; state.d2Graph = null;
      state.scroll = 0; state.planScroll = PLAN_FOLLOW;
      readHarness();
      notice(feed, `resumed ${item.name || item.firstMessage?.slice(0, 60) || String(item.id || '').slice(0, 8)} · ${s?.messageCount ?? '?'} messages`, 'info');
      feed.version++;
    } catch (e) { notice(feed, `resume failed: ${e.message}`, 'error'); }
  };

  // initial state + polls
  refreshState().then(s => {
    // `ctg -c/--session` loaded history before the console attached — rebuild
    // the feed from the session file so it shows where things stand.
    if ((opts.session || opts.continue) && s.sessionFile && !state.hydrated) {
      hydrateFrom(s.sessionFile);
      state.scroll = 0;
      if (state.hydrated) notice(feed, `resumed session ${String(s.sessionId || '').slice(0, 8)}`, 'info');
    }
  }).catch(() => { });

  /** Fetch available models via RPC, cache in state.modelList. Returns the list or []. */
  // Only cache a successful, non-empty result: caching [] would make a fetch
  // that races an agent restart poison the list until the app is relaunched.
  let modelsPromise = null;
  const fetchModels = () => {
    if (state.modelList?.length) return Promise.resolve(state.modelList);
    if (modelsPromise) return modelsPromise; // in-flight: share the one (large) response
    modelsPromise = rpc.send({ type: 'get_available_models' }).then(r => {
      const list = (r?.models || []).map(m => ({ provider: m.provider, id: m.id, name: m.name || '', full: `${m.provider}/${m.id}` }));
      if (list.length) state.modelList = list;
      return list;
    }).catch(() => state.modelList || []).finally(() => { modelsPromise = null; });
    return modelsPromise;
  };
  // Warm the model cache so the settings provider toggle / picker is instant.
  fetchModels();

  const choiceItems = (p) => {
    let items;
    if (p.row === 0) items = THEME_NAMES.map(value => ({ value, label: value }));
    else if (p.row === 1) items = [{ value: '', label: 'All providers' }, ...providersFromModels(state.modelList).map(value => ({ value, label: value }))];
    else if (p.row === 2) items = (state.modelList || []).filter(m => !p.provider || m.provider === p.provider).map(m => ({ ...m, value: m.full, label: `${m.provider} · ${m.name || m.id}`, description: m.name && m.name !== m.id ? m.id : '' }));
    else items = (p.levels || []).map(value => ({ value, label: value }));
    const q = p.search || '';
    return p.row === 2
      ? items.filter(item => modelMatchesQuery(item, q))
      : items.filter(it => `${it.label} ${it.value}`.toLowerCase().includes(q.toLowerCase()));
  };
  const openOverlay = (row, direct = false) => {
    const p = state.overlay = { row, provider: null, direct, search: direct ? '' : undefined, sel: 0, loading: true };
    if (row === 0 && direct) {
      p.originalTheme = currentThemeName();
      const current = choiceItems(p).findIndex(item => item.value === p.originalTheme);
      p.sel = current < 0 ? 0 : current;
    }
    fetchModels().then(() => { p.loading = false; feed.version++; });
    rpc.send({ type: 'get_available_thinking_levels' }).then(r => { p.levels = r.levels || []; }).catch(e => { p.error = e.message; });
  };
  const applyModel = async (m) => {
    if (state.running) throw Error('Stop the active response before switching models.');
    if (state.model === m.full) return;
    const r = await rpc.send({ type: 'set_model', provider: m.provider, modelId: m.id });
    if (!r?.provider || !r?.id) throw Error('Model switch returned no model.');
    syncActiveModel(state, feed, r);
    saveCarthagentConfig({ model: state.model });
    notice(feed, `model → ${state.model}`, 'info');
  };
  const previewThemeChoice = (p, items = choiceItems(p)) => {
    if (p.row !== 0 || p.search === undefined) return;
    const item = items[p.sel];
    if (!item) return;
    p.previewTheme = item.value;
    T.theme = getTheme(item.value, termMode);
    screen.prev = [];
  };
  const restoreThemePreview = p => {
    if (!p.originalTheme) return;
    T.theme = getTheme(p.originalTheme, termMode);
    screen.prev = [];
    p.previewTheme = null;
  };
  const commitChoice = (p, item) => commitPicker(p, async () => {
    if (p.row === 0) {
      T.theme = getTheme(item.value, termMode); screen.prev = [];
      p.originalTheme = item.value;
      p.previewTheme = null;
      saveCarthagentConfig({ theme: item.value });
    } else if (p.row === 1) p.provider = item.value;
    else if (p.row === 2) await applyModel(item);
    else {
      await rpc.send({ type: 'set_thinking_level', level: item.value });
      await refreshState();
    }
  }, () => {
    if (state.overlay !== p) return;
    if (p.direct) state.overlay = null;
    else { p.search = undefined; p.sel = 0; }
  });

  const statePoll = setInterval(() => {
    rpc.send({ type: 'get_state' }).then(s => {
      state.sessionId = s.sessionId;
      state.sessionFile = s.sessionFile || state.sessionFile;
      state.sessionName = s.sessionName ?? state.sessionName;
      syncActiveModel(state, feed, s.model);
      state.running = s.isStreaming;
      if (!s.isStreaming && !state.runEnded) state.runEnded = Date.now();
      if (!s.isStreaming) state.abortAt = 0;
      state.isCompacting = s.isCompacting;
    }).catch(() => { });
    rpc.send({ type: 'get_session_stats' }).then(s => { state.stats = s; }).catch(() => { });
  }, 2500);
  const harnessPoll = setInterval(readHarness, 450);
  const hashPoll = setInterval(() => { if (state.running || state.delivery) hashTick(); }, 1600);
  hashTick();

  // ---- self-review offer (ask mode) — the engine's extension dialogs can't
  // reach rpc clients, so the console renders the prompt itself. 'yes' mode is
  // kicked by the delivery extension; 'no' suppresses this entirely.
  const reviewMode = () => resolveReviewMode(opts.review);
  const maybeOfferReview = () => {
    const verified = state.reviewPendingVerified;
    const writes = state.runWrites;
    state.reviewPendingVerified = false;
    const runKey = `${state.sessionId}@${state.runStarted}`;
    if (!shouldOfferReview({ mode: opts.demo ? 'no' : reviewMode(), verified, writes, loopActive: state.reviewLoop, offeredRuns: state.reviewOfferedRuns, runKey })) return;
    if (state.reviewOfferedRuns.size > 200) state.reviewOfferedRuns.clear();
    state.reviewOfferedRuns.add(runKey);
    state.reviewOffer = { reason: verified ? 'delivery verified' : `${writes} file${writes === 1 ? '' : 's'} changed` };
    notice(feed, `${state.reviewOffer.reason} — self-review? ^y start PR ↔ review ↔ fixes loop · esc skip · /review <ask|yes|no> sets default`, 'info');
    feed.version++;
  };
  const startReview = () => {
    state.reviewOffer = null;
    state.reviewLoop = true;
    runline(feed);
    echoUser(feed, 'self-review loop', false);
    rpc.send({ type: 'prompt', message: reviewKickoff(CTG_BIN) }).catch(e => notice(feed, e.message, 'error'));
    state.scroll = 0;
  };

  // ---- submit helpers
  const submit = text => {
    const v = text.trim();
    if (!v) return;
    state.reviewOffer = null;
    state.reviewLoop = false;
    if (v.startsWith('/')) return slash(v);
    if (v.startsWith('!')) {
      const cmd = v.slice(1).trim();
      if (!cmd) return;
      const b = echoBash(feed, cmd);
      rpc.send({ type: 'bash', command: cmd }).then(r => {
        b.status = 'done'; b.code = r?.exitCode; b.live = ''; b.tail = String(r?.output ?? '').split('\n');
        feed.version++;
      }).catch(e => { b.status = 'done'; b.code = 1; b.tail = [String(e.message)]; feed.version++; });
      return;
    }
    if (state.running) { echoUser(feed, v, true); rpc.send({ type: 'steer', message: v }).catch(e => notice(feed, e.message, 'error')); }
    else {
      // Phased delivery framing (the carthagent default): the feed shows the
      // task as typed; the engine receives the expanded delivery prompt.
      const expanded = shouldFrame(v, { enabled: state.autoFraming, delivery: opts.delivery !== false || opts.demo })
        ? framePrompt(v) : null;
      runline(feed);
      echoUser(feed, v, false, expanded || undefined);
      rpc.send({ type: 'prompt', message: expanded || v }).catch(e => notice(feed, e.message, 'error'));
    }
    state.scroll = 0;
  };

  const slash = v => {
    const [cmd, ...rest] = v.split(/\s+/);
    const arg = rest.join(' ');
    const done = t => notice(feed, t, 'info');
    switch (cmd) {
      case '/login': case '/auth': openAuth(); break;
      case '/account': case '/cloud': showCloudAccount(); break;
      case '/billing': {
        const action = arg.trim().toLowerCase() || 'checkout';
        if (!['checkout', 'portal'].includes(action)) done('usage: /billing [checkout|portal]');
        else openCloudBilling(action);
        break;
      }
      case '/logout-cloud': revokeCloud(arg.trim()); break;
      case '/q': case '/quit': case '/exit': cleanup(0); break;
      case '/help': push2(`${BOLD}keys${RESET}  enter send/steer · esc abort (again = force-restart agent) · ^r resume session · tab focus · ${G.shift}tab view · pgup/pgdn/wheel scroll focused pane · drag-select copies · ^t settings · ^n new session · ^x expand · ^l clear · ^c quit
${BOLD}input${RESET} type / for command autocomplete (↑↓ select · tab complete) · plain text runs phased delivery (${state.autoFraming ? 'on' : 'off'}) · /raw <text> bypasses · /guide [task] toggles or runs · ^v pastes · !<cmd> bash
${BOLD}cmds${RESET}  /login · /account · /billing [checkout|portal] · /logout-cloud <session> · /resume [id|name] · /restart · /theme [${THEME_NAMES.join('|')}] · /model [name] · /thinking · /compact · /new · /export [file] · /stats · /clear · /quit
${BOLD}review${RESET} /review starts a PR ↔ fresh-review ↔ fixes loop · /review ask|yes|no sets the default · ^y accepts a pending offer`); break;
      case '/raw': {
        const v2 = arg.trim();
        if (!v2) { done('usage: /raw <prompt> — send without delivery framing'); break; }
        if (state.running) { echoUser(feed, v2, true); rpc.send({ type: 'steer', message: v2 }).catch(e => notice(feed, e.message, 'error')); }
        else { runline(feed); echoUser(feed, v2); rpc.send({ type: 'prompt', message: v2 }).catch(e => notice(feed, e.message, 'error')); }
        state.scroll = 0;
        break;
      }
      case '/guide': {
        if (!arg) {
          state.autoFraming = !state.autoFraming;
          done(`phased delivery framing → ${state.autoFraming ? 'on' : 'off'}`); break;
        }
        const expanded = framePrompt(arg);
        runline(feed);
        echoUser(feed, arg, false, expanded !== arg ? expanded : undefined);
        rpc.send({ type: state.running ? 'steer' : 'prompt', message: expanded }).catch(e => notice(feed, e.message, 'error'));
        state.scroll = 0;
        break;
      }
      case '/theme': {
        if (arg && THEME_NAMES.includes(arg.toLowerCase())) {
          const name = arg.toLowerCase();
          T.theme = getTheme(name, termMode); screen.prev = [];
          saveCarthagentConfig({ theme: name });
          done(`theme → ${name}`);
        }
        else openOverlay(0);
        break;
      }
      case '/model': {
        if (!arg) { openOverlay(2, true); break; }
        // /model <name> — resolve and set directly
        fetchModels().then(list => {
          const ql = arg.toLowerCase();
          const m = list.find(x => x.full.toLowerCase() === ql)
            || list.find(x => x.id.toLowerCase() === ql)
            || list.find(x => modelMatchesQuery(x, arg));
          if (m) applyModel(m).catch(e => notice(feed, e.message, 'error'));
          else notice(feed, `no model matching "${arg}"`, 'error');
        });
        break;
      }
      case '/thinking': openOverlay(3); break;
      case '/compact': rpc.send({ type: 'compact', customInstructions: arg || undefined }).then(() => done('context compacted')).catch(e => notice(feed, e.message, 'error')); break;
      case '/new': rpc.send({ type: 'new_session' }).then(() => {
        resetFeed(feed);
        state.delivery = null;
        state.d2Source = '';
        state.d2Graph = null;
        state.sessionId = null;
        state.sessionFile = null;
        state.sessionName = null;
        state.stats = null;
        state.runStarted = 0;
        state.runEnded = 0;
        state.scroll = 0;
        state.planScroll = null;
        refreshState().catch(() => { });
        rpc.send({ type: 'get_session_stats' }).then(s => { state.stats = s; }).catch(() => { });
        done('new session');
        feed.version++;
      }).catch(e => notice(feed, e.message, 'error')); break;
      case '/resume': case '/sessions': {
        if (!arg) { openSessionPicker(); break; }
        const q = arg.toLowerCase();
        const it = listSessions(cwd).find(s => s.id === arg || s.id.startsWith(q) || (s.name || '').toLowerCase().includes(q));
        if (it) switchSession(it);
        else notice(feed, `no session matching "${arg}"`, 'error');
        break;
      }
      case '/restart': case '/kill': restartPi('restart'); break;
      case '/review': case '/review-mode': {
        const a = arg.trim().toLowerCase();
        if (!a) { startReview(); break; }
        if (a === 'status') { done(`self-review mode: ${reviewMode()}${opts.review ? ' (--review flag)' : ''}`); break; }
        if (normalizeReviewMode(a)) { saveCarthagentConfig({ review: a }); done(`self-review default → ${a} (saved to ${carthagentConfigPath()})`); break; }
        done('usage: /review [ask|yes|no|status] — bare /review starts a loop now');
        break;
      }
      case '/export': rpc.send({ type: 'export_html', outputPath: arg || undefined }).then(r => done(`exported → ${r?.path}`)).catch(e => notice(feed, e.message, 'error')); break;
      case '/stats': rpc.send({ type: 'get_session_stats' }).then(r => done(JSON.stringify(r))).catch(e => notice(feed, e.message, 'error')); break;
      case '/clear': feed.blocks = []; feed.version++; break;
      case '/abort': abortRun(); break;
      default:
        // unknown slash → forward as prompt (the engine resolves extension commands, skills)
        if (state.running) { echoUser(feed, v, true); rpc.send({ type: 'steer', message: v }).catch(e => notice(feed, e.message, 'error')); }
        else { echoUser(feed, v); rpc.send({ type: 'prompt', message: v }).catch(e => notice(feed, e.message, 'error')); }
    }
  };
  const push2 = text => { feed.blocks.push({ kind: 'notice', tone: 'info', text, t: Date.now() }); feed.version++; };

  /** Extract the dragged screen region from the last rendered frame and write
   * it to the clipboard via native OS tool (e.g. pbcopy on macOS) and OSC 52
   * (for compatible / remote terminals, with tmux pass-through). */
  const copySelection = sel => {
    const plain = screen.plain || [];
    const a = { x: sel.ax, y: sel.ay }, b = { x: sel.bx, y: sel.by };
    const top = (a.y < b.y || (a.y === b.y && a.x <= b.x)) ? a : b;
    const bot = top === a ? b : a;
    const rows = [];
    for (let y = top.y; y <= bot.y; y++) {
      const c0 = y === top.y ? top.x - 1 : 0;
      const c1 = y === bot.y ? bot.x : screen.w;
      rows.push(sliceCols(plain[y - 1] || '', Math.max(0, c0), Math.max(0, c1)).replace(/\s+$/, ''));
    }
    const text = rows.join('\n').replace(/^\n+|\n+$/g, '');
    if (!text) return;
    const buf = Buffer.from(text, 'utf8');
    const clipped = buf.subarray(0, 50000); // OSC 52 size limits vary by terminal
    const b64 = clipped.toString('base64');
    const osc52 = `\x1b]52;c;${b64}\x07`;
    if (process.env.TMUX) {
      process.stdout.write(`\x1bPtmux;\x1b${osc52}\x1b\\`);
    } else {
      process.stdout.write(osc52);
    }
    writeClipboard(text).catch(() => {});
    state.toast = {
      text: `copied ${clipped.length < buf.length ? `${clipped.length} of ` : ''}${buf.length} chars`,
      tone: 'info', until: Date.now() + 1500
    };
  };

  function currentThemeName() {
    return THEME_NAMES.find(k => getTheme(k, termMode) === T.theme) || resolveThemeName();
  }

  /** Stamp a centered settings card over the rendered frame. */
  function stampOverlay(lines, W, H, frame) {
    const t = T_();
    const baseBg = t.background || '#0f0f0f';
    const elemBg = t.backgroundElement || baseBg;
    const paintCard = l => bgLine(l, W, elemBg);
    const searching = state.overlay.search !== undefined;
    const matches = searching ? choiceItems(state.overlay) : [];
    const maxListRows = Math.min(matches.length, Math.max(3, H - 12));
    const rows = searching ? [
      { label: 'search', value: state.overlay.search + '\u2588' },
      { label: 'current', value: state.overlay.row === 2 ? state.model : state.overlay.row === 0 ? currentThemeName() : state.overlay.row === 1 ? (state.overlay.provider || 'All providers') : state.thinking },
    ] : [
      { label: 'theme', value: currentThemeName() },
      { label: 'provider', value: state.overlay.provider || 'All providers' },
      { label: 'model', value: state.model || '—' },
      { label: 'thinking', value: state.thinking || '—' },
    ];
    const cardW = Math.min(W - 4, 70);
    const innerW = cardW - 2;
    const x0 = Math.floor((W - cardW) / 2);
    const cardH = 3 + rows.length + 1 + (searching ? maxListRows + 1 : 0); // top + rows + hints + [list + sep] + bottom
    const y0 = Math.floor((H - cardH) / 2);
    const accent = t.primary || t.accent;
    const faint = t.textMuted || t.faint, muted = t.muted || faint;
    const bc = accent;
    const card = [];
    const title = searching ? ` Select ${['theme', 'provider filter', 'model', 'thinking'][state.overlay.row]} ` : ' settings ';
    const topFill = Math.max(0, innerW - 2 - title.length);
    card.push(fg(bc) + '╭' + '─'.repeat(2) + RESET + fg(muted) + title + RESET + fg(bc) + '─'.repeat(topFill) + '╮' + RESET);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const sel = i === state.overlay.row;
      const marker = sel ? fg(accent) + G.active + RESET : fg(faint) + ' ' + RESET;
      const label = (sel ? fg(accent) + BOLD : fg(muted)) + r.label.padEnd(9) + RESET;
      const val = fg(t.text) + (r.value || '—') + RESET;
      const core = truncate(' ' + marker + ' ' + label + ' ' + val, innerW);
      const padN = Math.max(0, innerW - width(core));
      card.push(fg(bc) + '│' + RESET + core + ' '.repeat(padN) + fg(bc) + '│' + RESET);
    }
    if (searching) {
      // Separator above the model list
      card.push(fg(bc) + '├' + '─'.repeat(innerW) + '┤' + RESET);
      const selIdx = state.overlay.sel ?? 0;
      const scrollOff = Math.max(0, selIdx - maxListRows + 1);
      for (let i = 0; i < maxListRows; i++) {
        const idx = scrollOff + i;
        const m = matches[idx];
        if (!m) { card.push(fg(bc) + '│' + RESET + ' '.repeat(innerW) + fg(bc) + '│' + RESET); continue; }
        const isSel = idx === selIdx;
        const prefix = isSel ? fg(accent) + G.active + RESET : fg(faint) + ' ' + RESET;
        const current = state.overlay.row === 2 ? state.model : state.overlay.row === 0 ? currentThemeName() : state.overlay.row === 1 ? (state.overlay.provider || '') : state.thinking;
        const suffix = m.description ? ` · ${m.description}` : '';
        const name = truncate((m.value === current ? '[current] ' : '') + m.label + suffix, innerW - 4);
        const nameCol = isSel ? fg(accent) + BOLD + name + RESET : fg(t.text) + name + RESET;
        const core = ' ' + prefix + ' ' + nameCol;
        const padN = Math.max(0, innerW - width(core));
        card.push(fg(bc) + '│' + RESET + core + ' '.repeat(padN) + fg(bc) + '│' + RESET);
      }
    }
    const hints = state.overlay.pending ? ' Applying… please wait ' : state.overlay.error ? ` ${state.overlay.error} ` : searching && !matches.length ? (state.overlay.loading ? ' Loading… ' : ' No matches · type to filter · Esc cancel ') : searching ? ` ${(state.overlay.sel || 0) + 1}/${matches.length} · Enter ${state.overlay.row === 2 ? 'switch' : 'apply'} · Esc cancel ` : ' ↑↓ browse · Enter open · Esc close ';
    const hintText = truncate(hints, innerW);
    const hpad = Math.max(0, innerW - width(hintText));
    card.push(fg(bc) + '│' + RESET + fg(faint) + hintText + RESET + ' '.repeat(hpad) + fg(bc) + '│' + RESET);
    card.push(fg(bc) + '╰' + '─'.repeat(innerW) + '╯' + RESET);
    for (let i = 0; i < card.length; i++) {
      const y = y0 + i;
      if (y < 0 || y >= H) continue;
      lines[y] = paintCard(padEnd(truncate(' '.repeat(x0) + card[i], W), W));
    }
  }

  const fmtAgo = ms => {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    return s < 90 ? 'now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
  };

  /** Session picker card: filterable list of this cwd's saved sessions. */
  function stampSessions(lines, W, H) {
    const t = T_();
    const baseBg = t.background || '#0f0f0f';
    const elemBg = t.backgroundElement || baseBg;
    const paintCard = l => bgLine(l, W, elemBg);
    const p = state.sessions;
    const items = filteredSessions();
    const cardW = Math.min(W - 4, 78);
    const innerW = cardW - 2;
    const maxRows = Math.min(Math.max(items.length, 1), Math.max(4, H - 10));
    const cardH = 1 + 1 + 1 + maxRows + 1 + 1; // top + search + sep + list + hints + bottom
    const x0 = Math.floor((W - cardW) / 2);
    const y0 = Math.floor((H - cardH) / 2);
    const accent = t.primary || t.accent;
    const faint = t.textMuted || t.faint, muted = t.muted || faint;
    const bc = accent;
    const row = core => fg(bc) + '│' + RESET + core + ' '.repeat(Math.max(0, innerW - width(core))) + fg(bc) + '│' + RESET;
    const card = [];
    const title = ' resume session ';
    card.push(fg(bc) + '╭' + '─'.repeat(2) + RESET + fg(muted) + title + RESET + fg(bc) + '─'.repeat(Math.max(0, innerW - 2 - title.length)) + '╮' + RESET);
    card.push(row(` ${fg(faint)}filter${RESET} ${fg(t.text)}${p.search}${fg(accent)}▌${RESET}`));
    card.push(fg(bc) + '├' + '─'.repeat(innerW) + '┤' + RESET);
    const selIdx = Math.min(p.sel, Math.max(0, items.length - 1));
    const scrollOff = Math.max(0, selIdx - maxRows + 1);
    for (let i = 0; i < maxRows; i++) {
      const s = items[scrollOff + i];
      if (!s) { card.push(row(items.length ? '' : ` ${fg(faint)}${ITALIC}no matches${RESET}`)); continue; }
      const isSel = scrollOff + i === selIdx;
      const meta = `${fmtAgo(s.modified)} · ${s.messageCount} msg · ${s.id.slice(0, 8)}`;
      const room = Math.max(8, innerW - 4 - strip(meta).length - 1);
      const name = s.name || s.firstMessage || '(empty session)';
      const marker = isSel ? fg(accent) + G.active + RESET : ' ';
      const label = (isSel ? fg(accent) + BOLD : fg(t.text)) + padEnd(truncate(name, room), room) + RESET;
      card.push(row(` ${marker} ${label} ${fg(faint)}${meta}${RESET}`));
    }
    const hints = ' type to filter · ↑↓ navigate · enter resume · esc close ';
    card.push(row(fg(faint) + hints + RESET));
    card.push(fg(bc) + '╰' + '─'.repeat(innerW) + '╯' + RESET);
    for (let i = 0; i < card.length; i++) {
      const y = y0 + i;
      if (y < 0 || y >= H) continue;
      lines[y] = paintCard(padEnd(truncate(' '.repeat(x0) + card[i], W), W));
    }
  }

  /** Connect-provider popup: pick a provider (and auth method), then answer
   *  the engine's login prompts inline — no terminal hand-off. */
  function stampAuth(lines, W, H) {
    const t = T_();
    const baseBg = t.background || '#0f0f0f';
    const elemBg = t.backgroundElement || baseBg;
    const paintCard = l => bgLine(l, W, elemBg);
    const a = state.auth;
    const cardW = Math.min(W - 4, 76);
    const innerW = cardW - 2;
    const accent = t.primary || t.accent;
    const accent2 = t.secondary || t.accent2 || accent;
    const faint = t.textMuted || t.faint, muted = t.muted || faint;
    const ok = t.success || t.ok;
    const bc = accent;
    const row = core => fg(bc) + '│' + RESET + core + ' '.repeat(Math.max(0, innerW - width(core))) + fg(bc) + '│' + RESET;
    const wrapText = (text, cols) => {
      const out = []; let line = '';
      for (const w of String(text).split(/\s+/)) {
        if (width(line) + w.length + 1 > cols && line) { out.push(line); line = w; }
        else line = line ? line + ' ' + w : w;
      }
      if (line) out.push(line);
      return out;
    };
    const card = [];
    const title = a.phase === 'type' ? ' auth method ' : a.phase === 'providers' ? ' connect a provider ' : ` ${a.provider?.name || 'provider'} `;
    card.push(fg(bc) + '╭' + '─'.repeat(2) + RESET + fg(muted) + title + RESET + fg(bc) + '─'.repeat(Math.max(0, innerW - 2 - title.length)) + '╮' + RESET);
    if (a.phase === 'providers') for (const l of wrapText("Carthagent's managed gateway is recommended; direct providers remain available.", innerW - 2)) card.push(row(` ${fg(accent2)}${l}${RESET}`));

    if (a.phase === 'providers' || a.phase === 'type') {
      const items = a.phase === 'type'
        ? (a.provider?.types || []).map(ty => ({ id: ty, name: authTypeLabel(ty, a.provider?.id) }))
        : authVisible();
      if (a.phase === 'providers') {
        card.push(row(` ${fg(faint)}filter${RESET} ${fg(t.text)}${a.filter}${fg(accent)}▌${RESET}`));
        card.push(fg(bc) + '├' + '─'.repeat(innerW) + '┤' + RESET);
      }
      const maxRows = Math.min(Math.max(items.length, 1), Math.max(4, H - 12));
      const selIdx = Math.min(a.sel, Math.max(0, items.length - 1));
      const scrollOff = Math.max(0, selIdx - maxRows + 1);
      for (let i = 0; i < maxRows; i++) {
        const it = items[scrollOff + i];
        if (!it) { card.push(row(items.length ? '' : ` ${fg(faint)}${a.busy ? 'loading…' : 'no matches'}${RESET}`)); continue; }
        const isSel = scrollOff + i === selIdx;
        const marker = isSel ? fg(accent) + G.active + RESET : ' ';
        if (a.phase === 'type') {
          card.push(row(` ${marker} ${(isSel ? fg(accent) + BOLD : fg(t.text)) + it.name + RESET}`));
        } else {
          const meta = it.types.map(type => authTypeLabel(type, it.id)).join(' · ');
          const configuredBadge = it.configured ? ` ${G.done} connected` : '';
          const recommendedBadge = it.recommended ? ' Recommended' : '';
          const badgeWidth = configuredBadge.length + recommendedBadge.length;
          const room = Math.max(8, innerW - 5 - meta.length - badgeWidth);
          const labelColor = it.recommended || isSel ? accent : t.text;
          const label = fg(labelColor) + (it.recommended || isSel ? BOLD : '') + padEnd(truncate(it.name, room), room) + RESET;
          card.push(row(` ${marker} ${label} ${it.recommended ? fg(accent) + recommendedBadge + RESET : ''} ${fg(faint)}${meta}${RESET}${it.configured ? fg(ok) + configuredBadge + RESET : ''}`));
        }
      }
      const hints = a.phase === 'type'
        ? ' ↑↓ select · enter connect · esc back '
        : ' type to filter · ^v paste · ↑↓ select · enter connect · esc close ';
      card.push(row(fg(faint) + hints + RESET));
    } else {
      const wrap = (text, cols) => {
        const out = []; let line = '';
        for (const w of String(text).split(/\s+/)) {
          if (width(line) + w.length + 1 > cols && line) { out.push(line); line = w; }
          else line = line ? line + ' ' + w : w;
        }
        if (line) out.push(line);
        return out.length ? out : [''];
      };
      if (a.message) for (const l of wrap(a.message, innerW - 2)) card.push(row(' ' + fg(t.text) + l + RESET));
      if (a.deviceCode?.userCode) {
        card.push(row(' ' + fg(faint) + 'code' + RESET + '  ' + fg(accent) + BOLD + a.deviceCode.userCode + RESET));
        if (a.deviceCode.verificationUri) card.push(row(' ' + fg(faint) + 'url' + RESET + '   ' + fg(t.text) + truncate(a.deviceCode.verificationUri, innerW - 8) + RESET));
      } else if (a.url) {
        card.push(row(' ' + fg(t.text) + truncate(a.url, innerW - 2) + RESET));
      }
      if (a.instructions) for (const l of wrap(a.instructions, innerW - 2)) card.push(row(' ' + fg(faint) + l + RESET));
      if (Array.isArray(a.links)) for (const link of a.links) card.push(row(' ' + fg(faint) + truncate(link.url || '', innerW - 2) + RESET));
      if (a.phase === 'prompt') {
        card.push(fg(bc) + '├' + '─'.repeat(innerW) + '┤' + RESET);
        const p = a.prompt || {};
        if (p.type === 'select') {
          const opts = p.options || [];
          for (let i = 0; i < opts.length; i++) {
            const isSel = i === (a.promptSel || 0);
            const marker = isSel ? fg(accent) + G.active + RESET : ' ';
            card.push(row(` ${marker} ${(isSel ? fg(accent) + BOLD : fg(t.text)) + opts[i].label + RESET}`));
          }
        } else {
          const shown = p.type === 'secret' ? '•'.repeat(a.input.length) : a.input;
          const body = !shown && p.placeholder ? fg(faint) + p.placeholder + RESET : fg(t.text) + shown + RESET;
          card.push(row(` ${body}${fg(accent)}▌${RESET}`));
        }
        card.push(row(fg(faint) + (p.type === 'select' ? ' ↑↓ select · enter confirm · esc cancel ' : ' enter confirm · ^v paste · esc cancel ') + RESET));
      } else {
        card.push(row(fg(faint) + ' working… esc cancel ' + RESET));
      }
    }
    card.push(fg(bc) + '╰' + '─'.repeat(innerW) + '╯' + RESET);

    const x0 = Math.floor((W - cardW) / 2);
    const y0 = Math.floor((H - card.length) / 2);
    for (let i = 0; i < card.length; i++) {
      const y = y0 + i;
      if (y < 0 || y >= H) continue;
      lines[y] = paintCard(padEnd(truncate(' '.repeat(x0) + card[i], W), W));
    }
  }

  /** Slash-command autocomplete card: bottom-anchored above the input box.
   *  Left-justified (aligned with prompt area) with rows strictly bounded within box.
   *  Shows filtered commands; ↑↓ select, tab/enter complete, esc close. */
  function stampSlash(lines, W, H) {
    const t = T_();
    const baseBg = t.background || '#0f0f0f';
    const elemBg = t.backgroundElement || baseBg;
    const paintCard = l => bgLine(l, W, elemBg);
    const p = state.slash;
    const { card, x0 } = renderSlashCard(p.items, p.sel, W, t, G);
    const y0 = H - 4 - card.length; // sit directly above the input box (3 rows + footer)
    for (let i = 0; i < card.length; i++) {
      const y = y0 + i;
      if (y < 0 || y >= H - 4) continue; // never overwrite the input box
      lines[y] = paintCard(padEnd(truncate(' '.repeat(x0) + card[i], W), W));
    }
  }

  // ---- input
  const onKey = k => {
    state.lastActivity = Date.now();
    // Drag-select → copy, opencode-style: tracked here because mouse reporting
    // replaces the terminal's native selection. Works over any screen state.
    if (k.key === 'mousedown' || k.key === 'mousedrag' || k.key === 'mouseup') {
      // Control-click or right-click in/around the input box clears the prompt buffer
      if (k.key === 'mousedown' && (k.ctrl || k.button === 2) && k.y >= screen.h - 4 && k.y <= screen.h - 2) {
        if (editor.buf) { editor.clear(); updateSlash(); }
        return;
      }
      if (k.button === 0) {
        if (k.key === 'mousedown') state.sel = { ax: k.x, ay: k.y, bx: k.x, by: k.y, dragged: false };
        else if (k.key === 'mousedrag' && state.sel) {
          state.sel.bx = k.x; state.sel.by = k.y;
          if (k.x !== state.sel.ax || k.y !== state.sel.ay) state.sel.dragged = true;
        } else if (k.key === 'mouseup' && state.sel) {
          const sel = state.sel;
          state.sel = null;
          if (sel.dragged) copySelection(sel);
        }
      }
      return;
    }
    if (state.auth) {
      const a = state.auth;
      if (a.phase === 'prompt') {
        const p = a.prompt || {};
        if (p.type === 'select') {
          const opts = p.options || [];
          switch (k.key) {
            case 'up': a.promptSel = Math.max(0, (a.promptSel || 0) - 1); break;
            case 'down': a.promptSel = Math.min(opts.length - 1, (a.promptSel || 0) + 1); break;
            case 'enter': { const o = opts[a.promptSel || 0]; if (o) authSubmitPrompt(o.id); break; }
            case 'esc': authCancel(); break;
            case 'ctrl-c': cleanup(0); break;
          }
        } else {
          switch (k.key) {
            case 'enter': if (a.input.trim()) authSubmitPrompt(a.input.trim()); break;
            case 'esc': authCancel(); break;
            case 'ctrl-c': cleanup(0); break;
            case 'ctrl-v': authPasteClipboard(); break;
            case 'backspace': a.input = a.input.slice(0, -1); break;
            case 'char': a.input += k.ch; break;
            case 'paste': a.input += sanitizePaste(k.text); break;
          }
        }
        feed.version++;
        return;
      }
      if (a.phase === 'waiting') {
        if (k.key === 'esc') authCancel();
        else if (k.key === 'ctrl-c') cleanup(0);
        return;
      }
      // provider / auth-method list
      const items = a.phase === 'type'
        ? (a.provider?.types || []).map(ty => ({ id: ty, name: authTypeLabel(ty, a.provider?.id) }))
        : authVisible();
      a.sel = Math.max(0, Math.min(a.sel, Math.max(0, items.length - 1)));
      switch (k.key) {
        case 'esc':
          if (a.phase === 'type') { a.phase = 'providers'; a.sel = 0; a.type = null; }
          else state.auth = null;
          break;
        case 'ctrl-c': cleanup(0); break;
        case 'up': a.sel = Math.max(0, a.sel - 1); break;
        case 'down': a.sel = Math.min(items.length - 1, a.sel + 1); break;
        case 'pgup': a.sel = Math.max(0, a.sel - 8); break;
        case 'pgdn': a.sel = Math.min(items.length - 1, a.sel + 8); break;
        case 'backspace': if (a.phase === 'providers') { a.filter = a.filter.slice(0, -1); a.sel = 0; } break;
        case 'char': if (a.phase === 'providers' && k.ch) { a.filter += k.ch; a.sel = 0; } break;
        case 'paste': if (a.phase === 'providers') { a.filter += k.text; a.sel = 0; } break;
        case 'enter':
          if (a.phase === 'type') authStart(items[a.sel]?.id);
          else authChooseProvider(items[a.sel]);
          break;
      }
      feed.version++;
      return;
    }
    if (state.sessions) {
      const p = state.sessions;
      const items = filteredSessions();
      p.sel = Math.max(0, Math.min(p.sel, items.length - 1));
      switch (k.key) {
        case 'esc': case 'ctrl-r': case 'tab': state.sessions = null; break;
        case 'ctrl-c': cleanup(0); break;
        case 'up': p.sel = Math.max(0, p.sel - 1); break;
        case 'down': p.sel = Math.min(items.length - 1, p.sel + 1); break;
        case 'pgup': p.sel = Math.max(0, p.sel - 8); break;
        case 'pgdn': p.sel = Math.min(items.length - 1, p.sel + 8); break;
        case 'backspace': p.search = p.search.slice(0, -1); p.sel = 0; break;
        case 'enter': {
          const it = items[p.sel];
          state.sessions = null;
          if (it) switchSession(it);
          break;
        }
        case 'char': p.search += k.ch; p.sel = 0; break;
        case 'paste': p.search += k.text; p.sel = 0; break;
      }
      return;
    }
    if (state.overlay) {
      const p = state.overlay;
      if (k.key === 'ctrl-c') { cleanup(0); return; }
      if (p.pending) return;
      if (p.search !== undefined) {
        const items = choiceItems(p);
        const action = pickerKey(p, k.key, items.length);
        if (action === 'cancel') {
          restoreThemePreview(p);
          if (p.direct) state.overlay = null;
          else { p.search = undefined; p.error = ''; }
        } else if (action === 'commit') commitChoice(p, items[p.sel]);
        else if (k.key === 'char' || k.key === 'paste') {
          p.search += k.ch ?? k.text; p.sel = 0; p.error = '';
          previewThemeChoice(p);
        } else if (k.key === 'backspace') {
          p.search = p.search.slice(0, -1); p.sel = 0; p.error = '';
          previewThemeChoice(p);
        } else previewThemeChoice(p, items);
      } else {
        if (k.key === 'esc' || k.key === 'ctrl-t') state.overlay = null;
        else if (k.key === 'up') p.row = (p.row + 3) % 4;
        else if (k.key === 'down') p.row = (p.row + 1) % 4;
        else if (k.key === 'enter') {
          p.search = ''; p.sel = 0; p.error = '';
          if (p.row === 0) {
            p.originalTheme = currentThemeName();
            const themes = choiceItems(p);
            const current = themes.findIndex(item => item.value === p.originalTheme);
            p.sel = current < 0 ? 0 : current;
            previewThemeChoice(p, themes);
          }
        }
      }
      return;
    }
    // Which pane do scroll keys target? Single-pane views scroll what's
    // visible; in split, wheel routes by column when coords are present,
    // otherwise the focused pane (tab) wins.
    const scrollTarget = k => {
      if (state.view === 'plan') return 'plan';
      if (state.view === 'feed') return 'feed';
      if ((k.key === 'wheelup' || k.key === 'wheeldown') && typeof k.x === 'number') {
        const sideW = planSideWidth(screen.w);
        const feedW = screen.w - sideW - 1;
        if (k.x > feedW + 1) return 'plan';
        return 'feed';
      }
      return state.focusPane === 'plan' ? 'plan' : 'feed';
    };
    const scrollPlan = (d, abs) => {
      if (abs != null) { state.planScroll = abs; return; }
      state.planScroll = (state.planScroll ?? PLAN_FOLLOW) + d;
    };
    // ---- slash-command autocomplete popup: navigate/select while active.
    // Intercepts up/down/pgup/pgdn/tab/enter/esc before the main switch so the
    // popup owns those keys; all other keys fall through to edit the buffer
    // and then updateSlash() recomputes the matches.
    if (state.slash) {
      const p = state.slash;
      switch (k.key) {
        case 'up': p.sel = Math.max(0, p.sel - 1); return;
        case 'down': p.sel = Math.min(p.items.length - 1, p.sel + 1); return;
        case 'pgup': p.sel = Math.max(0, p.sel - 8); return;
        case 'pgdn': p.sel = Math.min(p.items.length - 1, p.sel + 8); return;
        case 'tab': case 'stab': if (completeSlash()) return; break; // fall through to pane-focus tab on no-op
        case 'enter': {
          const item = p.items[p.sel];
          if (item) { state.slash = null; editor.take(); submit(item.name); }
          return;
        }
        case 'esc': state.slash = null; return;
      }
    }
    switch (k.key) {
      case 'char': editor.insert(k.ch); updateSlash(); break;
      case 'paste': editor.insert(k.text); updateSlash(); break;
      case 'ctrl-v': readClipboard().then(text => { if (state.auth) return; editor.insert(sanitizePaste(text, { multiline: true })); updateSlash(); }); break;
      case 'backspace': editor.backspace(); updateSlash(); break;
      case 'delete': editor.del(); updateSlash(); break;
      case 'left': editor.cur = Math.max(0, editor.cur - 1); break;
      case 'right': editor.cur = Math.min(editor.buf.length, editor.cur + 1); break;
      case 'home': editor.cur = 0; break;
      case 'end': editor.cur = editor.buf.length; break;
      case 'ctrl-u': case 'cmd-delete': editor.clear(); updateSlash(); break;
      case 'ctrl-w': case 'alt-backspace': case 'ctrl-backspace': editor.wordBack(); updateSlash(); break;
      case 'ctrl-k': case 'ctrl-delete': case 'alt-delete': editor.killEnd(); updateSlash(); break;
      case 'up': if (editor.buf === '' || editor.hi !== -1) editor.up(); else (scrollTarget(k) === 'plan' ? scrollPlan(-2) : state.scroll += 3); break;
      case 'down': if (editor.hi !== -1) editor.down(); else (scrollTarget(k) === 'plan' ? scrollPlan(2) : state.scroll = Math.max(0, state.scroll - 3)); break;
      case 'pgup': scrollTarget(k) === 'plan' ? scrollPlan(-8) : state.scroll += 12; break;
      case 'pgdn': scrollTarget(k) === 'plan' ? scrollPlan(8) : state.scroll = Math.max(0, state.scroll - 12); break;
      case 'wheelup': scrollTarget(k) === 'plan' ? scrollPlan(-3) : state.scroll += 3; break;
      case 'wheeldown': scrollTarget(k) === 'plan' ? scrollPlan(3) : state.scroll = Math.max(0, state.scroll - 3); break;
      case 'tab': {
        const narrow = screen.w < 96;
        if (narrow) {
          state.view = state.view === 'plan' ? 'feed' : 'plan';
        } else if (state.view === 'split') {
          // tab moves scroll focus between panes; shift+tab cycles views.
          state.focusPane = state.focusPane === 'plan' ? 'feed' : 'plan';
        } else {
          state.view = 'split';
        }
        screen.prev = [];
        break;
      }
      case 'stab': {
        const narrow = screen.w < 96;
        state.view = narrow ? (state.view === 'plan' ? 'feed' : 'plan') : (state.view === 'split' ? 'feed' : 'split');
        screen.prev = [];
        break;
      }
      case 'enter': submit(editor.take()); break;
      case 'ctrl-y':
        if (state.reviewOffer) startReview();
        else notice(feed, 'no pending self-review offer — /review starts a loop manually', 'info');
        break;
      case 'esc':
        if (state.running) { state.abortAt ? restartPi('force') : abortRun(); }
        else if (state.reviewOffer) state.reviewOffer = null;
        else if (editor.buf) editor.clear();
        else if (state.planScroll != null && state.planScroll !== PLAN_FOLLOW) state.planScroll = PLAN_FOLLOW;
        break;
      case 'ctrl-t': if (state.overlay) state.overlay = null; else openOverlay(0); break;
      case 'ctrl-r': openSessionPicker(); break;
      case 'ctrl-n': slash('/new'); break;
      case 'ctrl-l': feed.blocks = []; feed.version++; break;
      case 'x': state.expand = !state.expand; feed.version++; break;
      case 'ctrl-c':
        if (state.running) { state.abortAt ? restartPi('force') : abortRun(); editor.clear(); break; }
        if (editor.buf) { editor.clear(); break; }
        cleanup(0);
        break;
    }
  };
  const parseKeys = makeKeyParser(onKey);
  process.stdin.on('data', d => parseKeys(d.toString('utf8')));

  // ---- cleanup
  let cleaned = false;
  const cleanup = code => {
    if (cleaned) return; cleaned = true;
    clearInterval(statePoll); clearInterval(harnessPoll); clearInterval(hashPoll);
    hashWorker?.terminate();
    rpc.kill();
    screen.exit();
    process.exit(code);
  };
  process.on('SIGINT', () => cleanup(130));
  process.on('SIGTERM', () => cleanup(143));
  screen.onResize = () => { if (screen.w < 96 && state.view === 'split') state.view = 'feed'; };

  // ---- render pieces
  const T_ = () => T.theme;
  const accent0 = () => { const t = T_(); return t.primary || t.accent; };
  const fmtDur = ms => { const s = Math.floor(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}`; };
  const fmtTok = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);

  function headerLines(W, frame) {
    const t = T_();
    const warn = t.warning || t.warn, err = t.error || t.err;
    const logo = fg(t.primary || t.accent) + BOLD + '𐤀 carthagent' + RESET;
    const spinChar = state.running ? ` ${fg(t.primary || t.accent)}${spin(frame)}${RESET}` : '';
    const elapsed = state.runStarted ? fmtDur((state.running ? Date.now() : state.runEnded || Date.now()) - state.runStarted) : '';
    let model = state.model || '';
    if (model && W < 130) model = model.split('/').at(-1);
    const ctxp = state.stats?.contextUsage?.percent;
    const ctxTxt = typeof ctxp === 'number' ? (ctxp < 10 ? ctxp.toFixed(1) : String(Math.round(ctxp))) : '';
    const ctxCol = typeof ctxp !== 'number' ? (t.textMuted || t.faint) : ctxp > 80 ? err : ctxp > 55 ? warn : (t.textMuted || t.faint);
    const ctxChip = typeof ctxp === 'number' ? `${fg(ctxCol)}ctx ${ctxTxt}%${RESET}  ` : '';
    const truecolorOff = colorDepth !== 24;
    const tcChip = truecolorOff ? fg(warn) + `${G.stale} 256` + RESET + '  ' : '';
    const info = t.info || t.accent2 || t.secondary;
    const faint = t.textMuted || t.faint;
    const right = `${fg(faint)}${model}${state.thinking ? ':' + state.thinking : ''}  ${ctxChip}${tcChip}${fg(faint)}${elapsed}${elapsed ? '  ' : ''}${feed.tokens ? fg(info) + fmtTok(feed.tokens) + ' tok' + RESET + '  ' : ''}${feed.cost ? fg(info) + '$' + feed.cost.toFixed(3) + RESET + '  ' : ''}${RESET}`;
    // Working directory is always in the header, right after the logo.
    const home = os.homedir();
    const shownCwd = cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;
    const head = `${logo}${spinChar}  `;
    const cwdRoom = Math.max(8, W - width(head) - width(right) - 2);
    const left = head + truncate(fg(faint) + shownCwd + RESET, cwdRoom);
    const gap = Math.max(1, W - width(left) - width(right) - 1);
    return [truncate(left + ' '.repeat(gap) + right, W)];
  }

  function dividerLine(W, t) {
    return fg(t.borderSubtle || t.border) + '─'.repeat(W) + RESET;
  }

  /** Rail status: revision + fresh check count (the phase tracker was
   * removed from the panel header). */
  function phaseLines(W, t) {
    const faint = t.textMuted || t.faint;
    const ok = t.success || t.ok, warn = t.warning || t.warn, err = t.error || t.err;
    const { phase, index, revision } = computePhase(state.delivery, state.currentHash, state.checkToolRunning);
    const { fresh, total } = freshChecks(state.delivery, state.currentHash);
    const stale = total - fresh;
    const freshTxt = total
      ? (stale > 0 ? fg(warn) + `${fresh}/${total} fresh` + RESET : fg(ok) + `${fresh}/${total} fresh` + RESET)
      : fg(faint) + 'no checks' + RESET;
    const revTxt = fg(faint) + `rev ${revision}` + RESET;
    const errMark = state.delivery && Object.values(state.delivery.evidence || {}).some(e => !e.passed)
      ? ` ${fg(err)}${G.fail} failing${RESET}` : '';
    return { lines: [truncate(` ${revTxt}  ${fg(faint)}·${RESET}  ${freshTxt}${errMark}`, W)], phase, index };
  }

  function sideLines(W, H, frame) {
    const t = T_();
    const faint = t.textMuted || t.faint;
    const out = [];
    const pad = l => padEnd(truncate(l, W), W);
    const phases = phaseLines(W, t);
    out.push(...phases.lines.map(pad));
    out.push(pad(''));
    if (!state.d2Graph) {
      out.push(pad(`${fg(faint)}No active plan.${RESET}`));
      out.push(...statLines(W, t).map(pad));
      while (out.length < H) out.push(pad(''));
      return out;
    }
    const { states, checkRows, status, allFresh } = computeNodeStates(state.delivery, state.checkToolRunning, state.checkRunId, state.currentHash);
    const { phase: _phase, index: phaseIndex } = computePhase(state.delivery, state.currentHash, state.checkToolRunning);
    const stats = statLines(W, t, frame);
    const cov = coverageLine(W, t);
    const full = renderD2(state.d2Graph, { width: W - 1, theme: t, states, packet: null, flash: new Set(), frame, phaseIndex, glyphs: G });
    const graph = full;
    const { lines, hotRow, boxes = [] } = graph;

    // Allocate height without starving the D2 graph
    const minGraphH = lines.length > 0 && H >= 12 ? Math.min(lines.length, 5) : 0;
    const availForChecks = Math.max(2, Math.min(checkRows.length, H - out.length - minGraphH - stats.length - cov.length - 4));
    const activeCheckRows = checkRows.slice(0, Math.min(checkRows.length, Math.max(2, availForChecks)));
    const chHeight = checkRowsHeight(activeCheckRows, state.delivery);

    let graphH = Math.max(0, H - out.length - chHeight - stats.length - cov.length - 3);
    if (graphH < 3 && lines.length > 0 && H >= 12) {
      graphH = Math.min(lines.length, Math.max(3, H - out.length - chHeight - 2));
    }

    // Clamp manual scroll every frame; new graphs reset to follow.
    const maxStart = Math.max(0, lines.length - Math.max(0, graphH));
    if (state.planScroll != null && state.planScroll !== PLAN_FOLLOW) {
      state.planScroll = Math.min(Math.max(0, state.planScroll), maxStart);
    }
    const win = windowLines(lines, graphH, hotRow, state.planScroll ?? PLAN_FOLLOW, boxes);
    const startRow = win._start ?? 0;
    const graphTop = out.length;
    out.push(...win.map(pad));

    // Show frontier detail only when frontier node is not already fully visible in the graph window
    const frontierBox = boxes.find(b => b.id === graph.frontierId);
    const frontierVisible = win.length > 0 && frontierBox && frontierBox.top >= startRow && frontierBox.bottom < startRow + win.length;
    let detail = frontierVisible ? [] : frontierDetail(W, t, states, graph.frontierId, graph.frontierLabel);

    if (win.length > 0 && detail.length > 0) out.push(pad(''));
    out.push(...detail.map(pad));
    out.push(pad(''));
    out.push(...checkLines(activeCheckRows, W, t, frame).map(pad));
    out.push(...cov.map(pad));
    out.push(pad(''));
    out.push(...stats.map(pad));
    out.push(pad(''));
    const fp = state.currentHash ? state.currentHash.slice(0, 12) : '…';
    const ok = t.success || t.ok, warn = t.warning || t.warn;
    const fpColor = !state.delivery ? faint : allFresh ? ok : warn;
    out.push(pad(`${fg(faint)}fp ${RESET}${fg(fpColor)}${fp}${RESET}  ${fg(faint)}${status || ''}${state.delivery?.revision ? ` · rev ${state.delivery.revision}` : ''}${state.delivery?.runId ? ` · run ${state.delivery.runId.slice(0, 6)}` : ''}${RESET}`));
    while (out.length < H) out.push(pad(''));
    const result = out.slice(0, H);
    // Scrollbar cells line up with the graph window only: the detail/check/stat
    // rows below it are pinned, not part of the scrolling region.
    const br = barRange(win.length, lines.length, startRow);
    if (br) {
      const bar = new Array(H).fill(null);
      for (let i = 0; i < win.length; i++) bar[graphTop + i] = (i >= br.pos && i < br.pos + br.len) ? 'thumb' : 'track';
      result._bar = bar;
    }
    return result;
  }

  /** 1–2 pinned lines under the graph: full frontier label (untruncated).
   *  Active frontier gets a bold "CURRENT" tag so the live step is unambiguous
   *  even before the swirl/pulse animations draw the eye. */
  function frontierDetail(W, t, states, frontierId, frontierLabel) {
    if (!frontierId || !frontierLabel) return [];
    const faint = t.textMuted || t.faint, muted = t.muted || faint;
    const st = states.get(frontierId) || 'pending';
    const accent = t.primary || t.accent;
    const ok = t.success || t.ok, warn = t.warning || t.warn, err = t.error || t.err;
    const dot = st === 'done' ? fg(ok) + G.done + RESET
      : st === 'fail' ? fg(err) + G.fail + RESET
      : st === 'stale' ? fg(warn) + G.stale + RESET
      : st === 'blocked' ? fg(warn) + G.blocked + RESET
      : st === 'active' ? fg(accent) + G.active + RESET
      : fg(faint) + G.pending + RESET;
    const tag = st === 'active' ? `${fg(accent)}${BOLD}CURRENT${RESET} ` : st === 'fail' ? `${fg(err)}${BOLD}STUCK${RESET} ` : st === 'blocked' ? `${fg(warn)}${BOLD}BLOCKED${RESET} ` : '';
    const head = `${tag}${dot} ${fg(muted)}${frontierId}${RESET} `;
    const avail = Math.max(8, W - width(head));
    const text = String(frontierLabel).replace(/\s+/g, ' ').trim();
    if (width(text) <= avail) return [truncate(head + fg(t.text) + text + RESET, W)];
    return wrapFrontier(head, text, avail, W, t);
  }

  function wrapFrontier(head, text, avail, W, t) {
    // Cheap word wrap on plain text (labels carry no ANSI).
    const words = text.split(/\s+/);
    const rows = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? cur + ' ' + w : w;
      let ww = 0;
      ww += [...next].length;
      if (ww > avail && cur) { rows.push(cur); cur = w; if (rows.length === 2) break; }
      else cur = next;
    }
    if (cur && rows.length < 2) rows.push(cur);
    const stillOver = text.length > rows.join(' ').length + 1;
    const out = [truncate(head + fg(t.text) + (rows[0] || '') + RESET, W)];
    if (rows[1] != null) {
      let second = rows[1] + (stillOver ? '…' : '');
      while (second.length && second.length + 2 > avail) second = second.slice(0, -2) + (stillOver ? '…' : '');
      out.push(truncate('  ' + fg(t.text) + second + RESET, W));
    }
    return out;
  }

  /** One line summarizing acceptance-criteria evidence coverage. Flags
   * criteria with no fresh passing check and those backed only by static
   * probes — the white-screen case the checks list alone never surfaced. */
  function coverageLine(W, t) {
    const delivery = state.delivery;
    if (!delivery?.plan?.acceptance?.length) return [];
    const faint = t.textMuted || t.faint;
    const ok = t.success || t.ok, warn = t.warning || t.warn;
    const report = coverageReport(delivery.plan, delivery.evidence, state.currentHash, delivery);
    const covered = report.filter(r => r.covered).length;
    const staticOnly = report.filter(r => r.staticOnly).length;
    const uncovered = report.length - covered;
    const parts = [`${covered}/${report.length} criteria`];
    if (uncovered) parts.push(`${uncovered} uncovered`);
    if (staticOnly) parts.push(`${staticOnly} static-only`);
    const tone = uncovered || staticOnly ? warn : ok;
    return [truncate(`${fg(faint)} COVERAGE${RESET}  ${fg(tone)}${parts.join(' · ')}${RESET}`, W)];
  }

  function statLines(W, t) {
    const faint = t.textMuted || t.faint, muted = t.muted || faint;
    if (!state.stats && !feed.tokens && !feed.cost) return [];
    const tokens = state.stats?.tokens?.total ?? feed.tokens;
    const context = state.stats?.contextUsage?.percent;
    const cost = state.stats?.cost ?? feed.cost;
    if (!tokens && !cost && (typeof context !== 'number' || context === 0)) return [];
    const parts = [];
    if (tokens) parts.push(`tokens ${fmtTok(tokens)}`);
    if (typeof context === 'number' && context > 0) parts.push(`context ${Math.round(context)}%`);
    if (cost) parts.push(`cost $${cost.toFixed(3)}`);
    if (!parts.length) return [];
    return [truncate(`${fg(faint)} USAGE${RESET}  ${fg(muted)}${parts.join('  ')}${RESET}`, W)];
  }

  function checkRowsHeight(rows, delivery) {
    return Math.min(rows.length, 8) + 2 + (delivery?.handoff ? 1 : 0);
  }

  function checkLines(rows, W, t, frame) {
    const faint = t.textMuted || t.faint, muted = t.muted || faint;
    const ok = t.success || t.ok, warn = t.warning || t.warn, err = t.error || t.err;
    const accent = t.primary || t.accent, hot = t.accent || t.hot;
    const doneN = rows.filter(r => r.st === 'done').length;
    const prog = rows.length
      ? ` ${fg(doneN === rows.length ? ok : accent)}${bar(doneN / rows.length, Math.min(10, W - 12), { filled: '▓', empty: '░' })}${RESET} ${fg(muted)}${doneN}/${rows.length}${RESET}`
      : '';
    const out = [`${fg(faint)} CHECKS${RESET}${prog}`];
    for (const r of rows.slice(0, 8)) {
      const icon =
        r.st === 'done' ? fg(ok) + G.done + RESET :
        r.st === 'fail' ? fg(err) + G.fail + RESET :
        r.st === 'stale' ? fg(warn) + G.stale + RESET :
        r.st === 'running' ? fg(accent) + spin(frame) + RESET :
        r.st === 'queued' ? fg(faint) + G.queued + RESET :
        fg(faint) + G.pending + RESET;
      const meta = r.st === 'fail' ? `exit ${r.code}` : r.st === 'running' ? 'running' : r.st === 'stale' ? `stale` : r.ms != null ? `${(r.ms / 1000).toFixed(1)}s` : r.kind;
      const staleMark = r.st === 'stale' ? fg(warn) + ' stale' + RESET : '';
      out.push(` ${icon} ${fg(r.st === 'pending' ? faint : t.text)}${r.id}${RESET} ${fg(faint)}${meta}${staleMark}${r.required ? fg(hot) + ' req' + RESET : ''}${RESET}`);
    }
    if (rows.length > 8) out.push(` ${fg(faint)}… ${rows.length - 8} more${RESET}`);
    const h = state.delivery?.handoff;
    if (h) out.push(`${fg(faint)} handoff ${RESET}${fg(h.status === 'verified' ? ok : warn)}${h.status}${RESET}`);
    return out;
  }

  function windowLines(lines, h, hot, manual = PLAN_FOLLOW, boxes = []) {
    if (h < 3) return [];
    if (lines.length <= h) {
      const win = lines.slice();
      win._start = 0;
      return win;
    }
    let start;
    if (manual != null && manual !== PLAN_FOLLOW) {
      start = Math.min(Math.max(0, manual), lines.length - h);
      for (const b of boxes) {
        if (b.top < start && start <= b.bottom) {
          start = b.top;
          break;
        }
      }
    } else {
      const target = boxes.find(b => b.top <= hot && b.bottom >= hot) || boxes.find(b => b.top === hot);
      if (target && h >= target.h) {
        start = target.top - Math.floor((h - target.h) / 2);
      } else {
        start = hot - Math.floor(h * 0.4);
      }
      start = Math.min(Math.max(0, start), lines.length - h);
      for (const b of boxes) {
        if (b.top < start && start <= b.bottom) {
          if (target && b.top + h >= target.bottom + 1) {
            start = b.top;
          } else {
            start = b.bottom + 1;
          }
          break;
        }
      }
    }
    start = Math.min(Math.max(0, start), lines.length - h);
    const win = lines.slice(start, start + h);
    win._start = start;
    return win;
  }

  function inputBox(W, frame) {
    const t = T_();
    const faint = t.textMuted || t.faint;
    const hot = state.running;
    const bc = hot ? (t.borderActive || t.primary || t.accent) : t.border;
    const framingOn = state.autoFraming && opts.delivery !== false;
    // Phased delivery is the carthagent default — the pill stays empty so the
    // product stays clean of mode badges. Steering keeps its label.
    const mode = state.running ? 'steer' : '';
    const titleTxt = mode ? ` ${mode}${opts.demo ? ' · demo' : ''} `
      : state.reviewOffer ? ' self-review? ^y start · esc skip ' : '';
    const fill = Math.max(0, W - 3 - width(titleTxt));
    const top = titleTxt
      ? fg(bc) + '╭' + RESET + fg(hot ? (t.primary || t.accent) : faint) + BOLD + titleTxt + RESET + fg(bc) + '─'.repeat(fill) + '╮' + RESET
      : fg(bc) + '╭' + '─'.repeat(Math.max(0, W - 2)) + '╮' + RESET;
    const prompt = state.running ? fg(t.warning || t.warn) + G.active + RESET : fg(t.primary || t.accent) + '›' + RESET;
    const hint = state.running
      ? 'steer the run…'
      : framingOn ? frameHint(frame) : 'message carthagent…';
    const hintLine = fg(faint) + ITALIC + hint + '  /help' + RESET;
    // horizontal scroll: keep the cursor visible when the buffer overflows
    const avail = Math.max(4, W - 6);
    let off = 0;
    while (width(editor.buf.slice(0, editor.cur).slice(off)) >= avail) off++;
    const view = editor.buf.slice(off);
    const shown = editor.buf ? fg(t.text) + view + RESET : hintLine;
    const midCore = ` ${prompt} ${shown}`;
    const mid = fg(bc) + '│' + RESET + padEnd(truncate(midCore, W - 2), W - 2) + fg(bc) + '│' + RESET;
    const bot = fg(bc) + '╰' + '─'.repeat(Math.max(0, W - 2)) + '╯' + RESET;
    const cx = Math.min(W - 1, 5 + width(editor.buf.slice(0, editor.cur).slice(off)));
    return { rows: [top, mid, bot], cx };
  }

  function footerLine(W, frame) {
    const t = T_();
    const faint = t.textMuted || t.faint;
    const escLabel = state.running ? (state.abortAt ? 'force restart' : 'abort') : 'clear';
    const keys = ` ${fg(faint)}enter${RESET} ${state.running ? 'steer' : 'send'} ${fg(t.border)}·${RESET} ${fg(faint)}esc${RESET} ${escLabel} ${fg(t.border)}·${RESET} ${fg(faint)}tab${RESET} focus ${fg(t.border)}·${RESET} ${fg(faint)}${G.shift}tab${RESET} view ${fg(t.border)}·${RESET} ${fg(faint)}^r${RESET} resume ${fg(t.border)}·${RESET} ${fg(faint)}^t${RESET} settings ${fg(t.border)}·${RESET} ${fg(faint)}^x${RESET} expand ${fg(faint)}^c${RESET} quit`;
    const toast = state.toast && Date.now() < state.toast.until ? state.toast : null;
    if (toast) {
      const tone = toast.tone === 'error' ? (t.error || t.err) : toast.tone === 'warning' ? (t.warning || t.warn) : (t.info || t.accent2 || t.secondary);
      const chip = fg(tone) + toast.text + RESET;
      return truncate(chip + ' '.repeat(Math.max(1, W - width(chip) - width(strip(keys)) - 1)), W);
    }
    return truncate(keys, W);
  }

  // ---- main render
  let cachedFeed = { v: -1, w: -1, expand: null, lines: [], blockRows: [] };
  function render(frame) {
    const W = screen.w, H = screen.h, t = T_();
    const faint = t.textMuted || t.faint;
    const baseBg = t.background || '#0f0f0f';
    const panelBg = t.backgroundPanel || baseBg;
    const paintBase = l => bgLine(l, W, baseBg);
    screen.bgHex = baseBg;
    if (W < 30 || H < 8) {
      screen.frame([paintBase(fg(t.warning || t.warn) + 'terminal too small — resize' + RESET)], null);
      return;
    }
    const lines = new Array(H).fill('');
    lines[0] = headerLines(W, frame)[0];
    lines[1] = dividerLine(W, t);

    const contentH = H - 6; // header2 + input box3 + footer1
    const narrow = W < 96;
    const planOnly = state.view === 'plan';
    const showSide = planOnly || (state.view === 'split' && !narrow);
    // Wider terminals get a wider PLAN rail (d2 text breathes); planOnly is
    // already full-width. Guard the feed so it never collapses below 36 cols.
    let sideW = planOnly ? W : showSide ? planSideWidth(W) : 0;
    if (showSide && !planOnly && W - sideW - 1 < 36) sideW = Math.max(0, W - 37);
    const feedW = planOnly ? 0 : W - sideW - (showSide ? 1 : 0);
    // Each pane reserves its rightmost column for a scrollbar; the PLAN rail
    // reclaims the spare column between it and the feed separator.
    const feedContentW = planOnly ? 0 : feedW - 1;
    const planContentW = planOnly ? W - 1 : sideW - 1;
    const planAreaW = planOnly ? W : sideW;

    // pane titles — MESSAGES only now; the PLAN rail no longer carries a
    // title or phase tracker. In split, the focused feed pane gets ●.
    const feedDot = state.view === 'split' ? (state.focusPane === 'feed' ? fg(accent0()) + G.phaseDone + RESET + ' ' : fg(faint) + G.phasePending + RESET + ' ') : '';
    const feedTitle = `${feedDot}${fg(faint)}MESSAGES${RESET}`;
    lines[2] = planOnly ? '' : truncate(feedTitle, feedW);
    // feed body (base surface)
    const bodyTop = 3, bodyH = contentH - 1;
    if (state.view !== 'plan') {
      if (cachedFeed.v !== feed.version || cachedFeed.w !== feedContentW || cachedFeed.expand !== state.expand || frame % 4 === 0) {
        cachedFeed = { v: feed.version, w: feedContentW, expand: state.expand, ...renderFeed(feed, feedContentW, t, { expandResults: state.expand, frame, glyphs: G }) };
      }
      const fl = cachedFeed.lines;
      const maxScroll = Math.max(0, fl.length - bodyH);
      state.scroll = Math.min(state.scroll, maxScroll);
      const start = Math.max(0, fl.length - bodyH - state.scroll);
      const fr = barRange(bodyH, fl.length, start);
      const feedFocused = state.focusPane === 'feed';
      for (let i = 0; i < bodyH; i++) {
        const bar = !fr ? null : (i >= fr.pos && i < fr.pos + fr.len) ? 'thumb' : 'track';
        lines[bodyTop + i] = paintBase(padEnd(truncate(fl[start + i] || '', feedContentW), feedContentW) + scrollCell(G, bar, feedFocused, t));
      }
      if (state.scroll > 0) lines[2] = paintBase(truncate(feedTitle + fg(faint) + `   ↑ ${state.scroll} above` + RESET, feedW));
      else lines[2] = planOnly ? lines[2] : paintBase(truncate(feedTitle, feedW));
    } else {
      lines[2] = paintBase(lines[2]);
    }
    lines[0] = paintBase(lines[0]);
    lines[1] = paintBase(lines[1]);

    // side panel — always visible in split view; the d2 phase graph is core.
    // Painted on backgroundPanel so the rail reads as a distinct surface.
    // The whole composed row keeps the base fill; the panel cell content
    // carries its own panel fill via bgLine inside sideLines-less paintPanel.
    const panelFill = bg(panelBg);
    const paintPanel = l => bgLine(l, planAreaW > 0 ? planAreaW : W, panelBg);
    if (showSide) {
      const planOnly = state.view === 'plan';
      const sl = sideLines(planContentW, bodyH, frame);
      const planBar = sl._bar || [];
      const planFocused = state.focusPane === 'plan';
      const borderColor = state.focusPane === 'plan' ? (t.borderActive || t.borderHot || t.border) : t.border;
      const sep = planOnly ? '' : fg(borderColor) + panelFill + '│' + RESET;
      if (!planOnly) lines[2] = paintBase(padEnd(truncate(lines[2] || '', feedW), feedW) + sep + paintPanel(''));
      for (let i = 0; i < sl.length && bodyTop + i < H - 4; i++) {
        const row = bodyTop + i;
        const body = padEnd(truncate(sl[i] || '', planContentW), planContentW) + scrollCell(G, planBar[i], planFocused, t);
        lines[row] = planOnly
          ? paintBase(body)
          : paintBase(padEnd(truncate((lines[row] || ''), feedW), feedW) + sep + paintPanel(body));
      }
    }

    // boxed input
    const box = inputBox(W, frame);
    lines[H - 4] = paintBase(box.rows[0]);
    lines[H - 3] = paintBase(box.rows[1]);
    lines[H - 2] = paintBase(box.rows[2]);
    lines[H - 1] = paintBase(footerLine(W, frame));
    // fill untouched body rows so no default-bg gaps remain
    for (let i = 0; i < H; i++) if (!lines[i]) lines[i] = paintBase('');

    if (state.overlay) stampOverlay(lines, W, H, frame);
    if (state.sessions) stampSessions(lines, W, H);
    if (state.slash) stampSlash(lines, W, H);
    if (state.auth) stampAuth(lines, W, H);
    // inverse-video the dragged region so selection is visible while held
    if (state.sel) {
      const { ax, ay, bx, by } = state.sel;
      const top = (ay < by || (ay === by && ax <= bx)) ? { x: ax, y: ay } : { x: bx, y: by };
      const bot = (top.x === ax && top.y === ay) ? { x: bx, y: by } : { x: ax, y: ay };
      for (let y = Math.max(1, top.y); y <= Math.min(bot.y, lines.length); y++) {
        const c0 = y === top.y ? top.x - 1 : 0;
        const c1 = y === bot.y ? bot.x : W;
        lines[y - 1] = inverseCols(lines[y - 1] || '', Math.max(0, c0), Math.max(0, c1));
      }
    }
    screen.frame(lines, (state.overlay || state.sessions || state.slash || state.auth) ? null : { y: H - 2, x: box.cx });
  }

  screen.enter();
  let frame = 0;
  let renderWarned = false;
  setInterval(() => {
    try { render(frame++); } catch (e) {
      if (process.env.CARTHAGENT_DEBUG && !renderWarned) { renderWarned = true; try { notice(feed, `render: ${e.stack?.split('\n')[0] || e.message}`, 'error'); } catch { } }
    }
  }, 66);
  // Welcome card doubles as the feed's empty state.
  const noProvider = !opts.demo && !hasConfiguredProvider();
  const welcome = { kind: 'welcome', model: state.model || opts.model || '', cwd, mode: opts.demo ? 'demo' : 'extension', noProvider, t: Date.now() };
  feed.blocks.push(welcome); feed.version++;
  rpc.send({ type: 'get_state' }).then(s => { syncActiveModel(state, feed, s.model); }).catch(() => { });
  if (opts.prompt) submit(opts.prompt);
  if (opts.resume) openSessionPicker();
  if (opts.openAuth) {
    await refreshState().catch(() => null);
    await openAuth();
  } else if (noProvider) {
    // First run with no credentials: auto-open the provider picker focused on Carthagent Cloud.
    await refreshState().catch(() => null);
    await openAuth({ focusProviderId: 'experiential-labs' });
  }
}
