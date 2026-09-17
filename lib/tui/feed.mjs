/**
 * Event → feed reducer for the pi2 TUI. Pure data: blocks describe what the
 * run terminal shows, derived stats describe the side panel. Rendering turns
 * blocks into styled lines (see renderFeed).
 */
import { fg, BOLD, DIM, ITALIC, RESET, width, wrap, paint, mix, truncate } from './ansi.mjs';
import { unframe } from './framing.mjs';
import { UNICODE_GLYPHS, spinnerFrame } from './glyphs.mjs';

/** Unicode tool icons, kept for backwards compatibility with callers that
 * imported the constant. Rendering resolves the active tier via `TOOL_ICON_KEYS`. */
export const TOOL_ICONS = {
  read: '◈', bash: '▸', powershell: '▸', write: '✎', edit: '✎', grep: '⌕', find: '⌕', ls: '▤',
  delivery_plan: '◇', delivery_check: '⚑', delivery_finish: '⚑', delivery_status: '·',
};

const TOOL_ICON_KEYS = {
  read: 'read', bash: 'run', powershell: 'run', write: 'write', edit: 'write',
  grep: 'search', find: 'search', ls: 'list',
  delivery_plan: 'plan', delivery_check: 'check', delivery_finish: 'check', delivery_status: 'status',
};

export function toolIcon(glyphs, name) {
  return glyphs[TOOL_ICON_KEYS[name]] || glyphs.bullet;
}

export function createFeed() {
  return {
    blocks: [],            // ordered render units
    toolBlocks: new Map(), // toolCallId -> block
    running: false,
    settled: true,
    turns: 0,
    tokens: 0,
    cost: 0,
    toolCalls: 0,
    currentAssistant: null,
    currentThinking: null,
    version: 0,            // bumped on any mutation (for render caching)
  };
}

export function resetFeed(S) {
  S.blocks = [];
  S.toolBlocks.clear();
  S.running = false;
  S.settled = true;
  S.turns = 0;
  S.tokens = 0;
  S.cost = 0;
  S.toolCalls = 0;
  S.currentAssistant = null;
  S.currentThinking = null;
  S.deliveryStatusText = null;
  S.userBash = null;
  S.version++;
  return S;
}

function push(S, block) {
  block.t = Date.now();
  S.blocks.push(block);
  if (S.blocks.length > 800) S.blocks.splice(0, S.blocks.length - 800);
  S.version++;
  return block;
}

export function textOf(content) {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : '';
  return content.filter(c => c?.type === 'text').map(c => c.text).join('\n');
}

function resultText(result) {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  if (Array.isArray(result.content)) return textOf(result.content);
  try { return JSON.stringify(result); } catch { return String(result); }
}

export function tailLines(s, n) {
  const lines = String(s).replace(/\n+$/, '').split('\n');
  return lines.slice(-n);
}

/** Reduce one JSON-mode session event into the feed model. */
export function applyEvent(S, ev) {
  const ase = ev.assistantMessageEvent;
  switch (ev.type) {
    case 'agent_start':
      S.running = true; S.settled = false;
      // Visual separator between runs — the local echo path pushes one before
      // the user block, so here we only need it for extension-driven resumes.
      if (S.blocks.length && !['runline', 'user'].includes(S.blocks[S.blocks.length - 1].kind)) {
        push(S, { kind: 'runline' });
      }
      S.version++;
      break;
    case 'agent_settled':
      S.settled = true; S.running = false;
      if (S.currentAssistant) S.currentAssistant.streaming = false;
      if (S.currentThinking) S.currentThinking.streaming = false;
      S.version++;
      break;
    case 'turn_start':
      S.turns++; S.version++;
      break;
    case 'message_start':
      if (ev.message?.role === 'user') {
        const text = textOf(ev.message.content);
        const last = S.blocks[S.blocks.length - 1];
        // dedupe our local echo (same text just submitted shows up again via events)
        if (last?.kind === 'user' && (last.text === text || last.expanded === text) && Date.now() - last.t < 15000) {
          last.queued = false; S.version++;
        } else {
          push(S, { kind: 'user', text });
        }
      }
      // assistant blocks are created lazily on the first text delta so
      // tool-call-only messages don't leave an empty '●' line in the feed
      break;
    case 'message_update':
      if (!ase) break;
      if (ase.type === 'text_delta' || ase.type === 'thinking_delta') {
        const isThink = ase.type === 'thinking_delta';
        let b = isThink ? S.currentThinking : S.currentAssistant;
        if (!b) {
          b = push(S, { kind: isThink ? 'thinking' : 'assistant', text: '', streaming: true });
          if (isThink) S.currentThinking = b; else S.currentAssistant = b;
        }
        b.text += ase.delta;
        b.streaming = true;
        S.version++;
      } else if (ase.type === 'toolcall_start') {
        const b = push(S, { kind: 'tool', id: ase.id, name: ase.toolName || 'tool', args: null, status: 'calling', tail: [], live: '' });
        if (ase.id) S.toolBlocks.set(ase.id, b);
      } else if (ase.type === 'toolcall_end' && ase.toolCall) {
        const b = S.toolBlocks.get(ase.toolCall.id);
        if (b) { b.args = ase.toolCall.arguments; S.version++; }
      }
      break;
    case 'message_end':
      if (ev.message?.role === 'assistant') {
        if (S.currentAssistant) S.currentAssistant.streaming = false;
        if (S.currentThinking) S.currentThinking.streaming = false;
        S.currentAssistant = null; S.currentThinking = null;
        const u = ev.message.usage;
        if (u) { S.tokens += u.totalTokens || 0; S.cost += u.cost?.total || 0; }
        if (ev.message.stopReason === 'error') {
          push(S, { kind: 'notice', tone: 'error', text: `provider error: ${ev.message.errorMessage || 'unknown'}` });
        }
        S.version++;
      }
      break;
    case 'tool_execution_start': {
      let b = S.toolBlocks.get(ev.toolCallId);
      if (!b) {
        b = push(S, { kind: 'tool', id: ev.toolCallId, name: ev.toolName, args: ev.args, status: 'running', tail: [], live: '' });
        S.toolBlocks.set(ev.toolCallId, b);
      }
      b.name = ev.toolName; b.args = ev.args; b.status = 'running';
      S.toolCalls++; S.version++;
      break;
    }
    case 'tool_execution_update': {
      const b = S.toolBlocks.get(ev.toolCallId);
      if (b) { b.live = resultText(ev.partialResult) || b.live; S.version++; }
      break;
    }
    case 'tool_execution_end': {
      const b = S.toolBlocks.get(ev.toolCallId);
      if (!b) break;
      b.status = ev.isError ? 'error' : 'done';
      b.end = Date.now();
      const out = resultText(ev.result);
      b.tail = tailLines(out, 40);
      b.rawResult = out;
      S.version++;
      break;
    }
    case 'auto_retry_start':
      push(S, { kind: 'notice', tone: 'warn', text: `provider error — retry ${ev.attempt}/${ev.maxAttempts} in ${Math.round((ev.delayMs || 0) / 1000)}s${ev.errorMessage ? ` · ${ev.errorMessage}` : ''}` });
      break;
    case 'auto_retry_end':
      if (!ev.success) push(S, { kind: 'notice', tone: 'error', text: `retry failed${ev.finalError ? `: ${ev.finalError}` : ''}` });
      break;
    case 'compaction_start':
      push(S, { kind: 'notice', tone: 'info', text: `compacting context (${ev.reason})…` });
      break;
    case 'compaction_end':
      push(S, { kind: 'notice', tone: 'info', text: ev.aborted ? 'compaction aborted' : `context compacted${ev.errorMessage ? ` — ${ev.errorMessage}` : ''}` });
      break;
    case 'agent_end':
      S.running = false; S.version++;
      break;
    case 'extension_ui_request':
      if (ev.method === 'notify') {
        push(S, { kind: 'notice', tone: ev.notifyType === 'warning' ? 'warn' : ev.notifyType || 'info', text: ev.message });
      } else if (ev.method === 'setStatus' && ev.statusKey === 'delivery') {
        S.deliveryStatusText = ev.statusText; S.version++;
      }
      break;
    case 'bash_execution_update': {
      const b = S.userBash;
      if (b) { b.live = (b.live || '') + (ev.delta || ''); S.version++; }
      break;
    }
    case 'response':
      if (ev.success === false) push(S, { kind: 'notice', tone: 'error', text: `${ev.command || 'rpc'}: ${ev.error}` });
      break;
  }
  return S;
}

/** Local echo helpers (things we send, so the feed shows them instantly). */
export function echoUser(S, text, queued, expanded) {
  // Phased delivery is the pi2 default — no badge on framed prompts.
  push(S, { kind: 'user', text, queued, expanded, via: undefined });
}
/** Run separator, pushed before a user echo so the feed reads runline → user → …. */
export function runline(S) {
  if (S.blocks.length && S.blocks[S.blocks.length - 1].kind !== 'runline') push(S, { kind: 'runline' });
}
export function echoBash(S, command) {
  S.userBash = push(S, { kind: 'bash', command, status: 'running', live: '', tail: [] });
  return S.userBash;
}
export function notice(S, text, tone = 'info') {
  push(S, { kind: 'notice', tone, text });
}

/**
 * Rebuild the feed from a saved session's entries (parsed session .jsonl lines).
 * Replaces S.blocks so a resumed session shows its history. Framed prompts
 * are unwrapped back to the task text the user originally typed.
 */
export function hydrateFeed(S, entries, { max = 400 } = {}) {
  const blocks = [];
  const tools = new Map();
  const put = b => { b.t = Date.now(); blocks.push(b); return b; };
  let tokens = 0, cost = 0, toolCalls = 0;
  for (const e of entries) {
    if (e?.type !== 'message' || !e.message) continue;
    const m = e.message;
    if (m.role === 'user') {
      const raw = textOf(m.content).trim();
      if (!raw) continue;
      const task = unframe(raw);
      put({ kind: 'user', text: task || raw, via: undefined, expanded: task ? raw : undefined });
    } else if (m.role === 'assistant') {
      for (const c of m.content || []) {
        if (c?.type === 'text' && c.text) put({ kind: 'assistant', text: c.text, streaming: false });
        else if (c?.type === 'thinking' && (c.thinking || c.text)) put({ kind: 'thinking', text: c.thinking || c.text, streaming: false });
        else if (c?.type === 'toolCall') {
          const b = put({ kind: 'tool', id: c.id, name: c.name || 'tool', args: c.arguments || null, status: 'done', tail: [] });
          if (c.id) tools.set(c.id, b);
          toolCalls++;
        }
      }
      if (m.usage) { tokens += m.usage.totalTokens || 0; cost += m.usage.cost?.total || 0; }
    } else if (m.role === 'toolResult') {
      const b = tools.get(m.toolCallId);
      if (b) {
        b.status = m.isError ? 'error' : 'done';
        const out = textOf(m.content);
        b.tail = tailLines(out, 40);
        b.rawResult = out;
      }
    }
  }
  S.blocks = blocks.slice(-max);
  S.toolBlocks = tools;
  S.tokens = tokens;
  S.cost = cost;
  S.toolCalls = toolCalls;
  S.currentAssistant = null;
  S.currentThinking = null;
  S.version++;
}

// ---------------------------------------------------------------- rendering

export function summarizeArgs(name, args) {
  if (!args || typeof args !== 'object') return '';
  const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  switch (name) {
    case 'read': return clip(`${args.path ?? ''}${args.offset ? ` :${args.offset}` : ''}`, 80);
    case 'write': return clip(`${args.path ?? ''} · ${(args.content ?? '').length}B`, 80);
    case 'edit': return clip(`${args.path ?? ''} · ${Array.isArray(args.edits) ? args.edits.length : '?'} edits`, 80);
    case 'bash': case 'powershell': return clip(String(args.command ?? '').split('\n')[0], 90);
    case 'grep': return clip(`/${args.pattern ?? ''}/ ${args.path ?? ''}`, 80);
    case 'find': return clip(`${args.pattern ?? ''} ${args.path ?? ''}`, 80);
    case 'ls': return clip(args.path ?? '.', 80);
    case 'delivery_plan': return clip(args.goal ?? '', 90);
    case 'delivery_check': return `id=${args.id ?? 'all'}`;
    case 'delivery_finish': return `status=${args.status ?? '?'}`;
    case 'delivery_status': return '';
    default: {
      try { return clip(JSON.stringify(args), 80); } catch { return ''; }
    }
  }
}

/** Tiny inline markdown: **bold**, `code`, headings. Returns styled string.
 * Uses opencode markdown tokens with legacy pi2 fallbacks (accent2/accent). */
export function mdInline(text, T) {
  const code = T.markdownCode || T.accent2 || T.secondary;
  const accent = T.markdownHeading || T.accent || T.primary;
  const link = T.markdownLink || accent;
  let s = String(text);
  s = s.replace(/`([^`\n]+)`/g, (_, c) => fg(code) + c + RESET + fg(T.text));
  s = s.replace(/\*\*([^*\n]+)\*\*/g, (_, c) => BOLD + c + RESET + fg(T.text));
  s = s.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (_, t, u) => fg(link) + t + RESET + fg(T.textMuted || T.faint) + ` (${u})` + RESET + fg(T.text));
  s = s.replace(/^#{1,4}\s*(.*)$/, (_, c) => BOLD + fg(accent) + c + RESET + fg(T.text));
  return s;
}

const BLOCK_GAP = 1;

/**
 * Render all blocks to styled lines for the feed pane.
 * Returns { lines, blockRows } — blockRows[i] = starting row of block i.
 */
export function renderFeed(S, W, T, { now = Date.now(), expandResults = false, frame = 0, glyphs = UNICODE_GLYPHS } = {}) {
  const G = glyphs;
  const spin = f => spinnerFrame(G, f);
  const lines = [];
  const blockRows = [];
  const inner = Math.max(10, W - 4);
  const fade = (styled, block) => (now - block.t < 350 ? DIM + styled : styled);

  for (const b of S.blocks) {
    blockRows.push(lines.length);
    const body = [];
    const faint = T.textMuted || T.faint, muted = T.muted || faint;
    const accent = T.primary || T.accent, accent2 = T.secondary || T.accent2 || accent;
    const codeTok = T.markdownCode || accent2;
    switch (b.kind) {
      case 'runline': {
        const label = ` run${b.n != null ? ` ${b.n}` : ''} `;
        const side = Math.max(2, Math.floor((inner - label.length - 2) / 2));
        body.push(`${fg(T.borderSubtle || faint)}${'─'.repeat(side)}${RESET}${fg(muted)}${label}${RESET}${fg(T.borderSubtle || faint)}${'─'.repeat(Math.max(0, inner - side - label.length))}${RESET}`);
        break;
      }
      case 'user': {
        body.push(`${fg(accent2)}${BOLD}▌ you${RESET}${b.via ? `  ${fg(faint)}${G.right} ${b.via}${RESET}` : ''}`);
        for (const l of wrap(b.text, inner)) body.push(`${fg(T.text)}${l}${RESET}`);
        if (b.queued) body.push(`${fg(faint)}${ITALIC}queued while agent is running…${RESET}`);
        break;
      }
      case 'assistant': {
        const inFence = { v: false };
        let first = true;
        for (const raw of b.text.split('\n')) {
          if (/^```/.test(raw.trim())) { inFence.v = !inFence.v; body.push(`${fg(T.borderSubtle || faint)}│${RESET}`); continue; }
          const styled = inFence.v ? `${fg(codeTok)}  ${raw}${RESET}` : fg(T.text) + mdInline(raw, T) + RESET;
          for (const l of wrap(styled, inner)) {
            if (first && !inFence.v) { body.push(`${fg(accent)}${G.phaseDone}${RESET} ${l}`); first = false; }
            else body.push(l);
          }
          if (first && inFence.v) first = false;
        }
        if (!b.text && b.streaming) { /* spinner below */ }
        if (b.streaming) body.push(`${fg(accent)}${spin(frame)}${RESET}`);
        break;
      }
      case 'thinking': {
        body.push(`${fg(faint)}${ITALIC}${G.info} thinking${RESET}`);
        const t = tailLines(b.text, expandResults ? 40 : 4).join('\n');
        for (const l of wrap(t, inner)) body.push(`${fg(faint)}${ITALIC}${l}${RESET}`);
        if (b.streaming) body.push(`${fg(faint)}${ITALIC}${spin(frame)}${RESET}`);
        break;
      }
      case 'tool': {
        const icon = toolIcon(G, b.name);
        const accentHot = T.accent || accent;
        const status = b.status === 'running' ? `${fg(accent)}${spin(frame)}${RESET}`
          : b.status === 'done' ? `${fg(T.diffAdded || T.ok)}${G.done}${RESET}`
          : b.status === 'error' ? `${fg(T.diffRemoved || T.err)}${G.fail}${RESET}`
          : `${fg(faint)}${G.ellipsis}${RESET}`;
        const summary = summarizeArgs(b.name, b.args);
        body.push(`${fg(accentHot)}${icon}${RESET} ${fg(accent)}${BOLD}${b.name}${RESET} ${fg(muted)}${summary}${RESET} ${status}`);
        if (b.live && b.status === 'running') {
          for (const l of tailLines(b.live, 3)) for (const w of wrap(l, inner - 2)) body.push(`  ${fg(muted)}${w}${RESET}`);
        }
        const show = expandResults ? b.tail : b.tail.slice(-3);
        if (b.status !== 'running' && show.length) {
          const color = b.status === 'error' ? (T.diffRemoved || T.error || T.err) : (T.diffContext || faint);
          // Error tails get an opencode-style tinted gutter.
          const gutterBg = b.status === 'error' && T.diffRemovedBg ? true : false;
          let firstTail = true;
          for (const l of show) for (const w of wrap(l, inner - 2)) {
            const mark = firstTail ? fg(faint) + G.tail + ' ' + RESET : '  ';
            const line = gutterBg ? fg(T.diffRemoved || T.error || T.err) + '▌' + RESET + ' ' + fg(color) + w + RESET : `${fg(color)}${w}${RESET}`;
            body.push(`${mark}${line}`);
            firstTail = false;
          }
          if (!expandResults && b.tail.length > 3) {
            for (const w of wrap(`… ${b.tail.length - 3} more lines (^x to expand)`, inner - 2)) body.push(`  ${fg(faint)}${w}${RESET}`);
          }
        }
        break;
      }
      case 'bash': {
        body.push(`${fg(T.warning || T.warn)}${BOLD}$${RESET} ${fg(T.text)}${b.command}${RESET}`);
        const out = b.status === 'running' ? (b.live || '') : (b.tail?.join('\n') || '');
        for (const l of tailLines(out, expandResults ? 30 : 5)) for (const w of wrap(l, inner - 2)) body.push(`  ${fg(muted)}${w}${RESET}`);
        if (b.status === 'running') body.push(`  ${fg(accent)}${spin(frame)}${RESET}`);
        else if (b.code != null) body.push(`  ${fg(b.code === 0 ? (T.diffAdded || T.success || T.ok) : (T.diffRemoved || T.error || T.err))}exit ${b.code}${RESET}`);
        break;
      }
      case 'notice': {
        const c = b.tone === 'error' ? (T.error || T.err) : b.tone === 'warn' ? (T.warning || T.warn) : faint;
        const sym = b.tone === 'error' ? G.fail : b.tone === 'warn' ? G.warn : G.info;
        for (const l of wrap(b.text, inner)) body.push(`${fg(c)}${sym} ${l}${RESET}`);
        break;
      }
      case 'banner': {
        const c = b.tone === 'ok' ? (T.success || T.ok) : b.tone === 'error' ? (T.error || T.err) : (T.warning || T.warn);
        body.push(`${fg(c)}${BOLD}${'─'.repeat(4)} ${b.title} ${'─'.repeat(4)}${RESET}`);
        for (const l of (b.text || '').split('\n')) for (const w of wrap(l, inner)) body.push(`${fg(muted)}${w}${RESET}`);
        break;
      }
      case 'welcome': {
        body.push(`${fg(accent)}${BOLD}pi2${RESET}`);
        body.push(`${fg(faint)}${truncate(b.model || 'default model', inner)}${RESET}`);
        body.push(`${fg(faint)}${truncate(b.cwd || '', inner)}${RESET}`);
        body.push('');
        body.push(`${fg(muted)}Enter a message. Use /help for commands.${RESET}`);
        break;
      }
    }
    for (const l of body) lines.push(fade(l, b));
    for (let i = 0; i < BLOCK_GAP; i++) lines.push('');
  }
  return { lines, blockRows };
}
