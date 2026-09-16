/**
 * Parse + render D2 flowchart sources (the `planD2` shape emitted by the
 * delivery extension) as a Unicode box-drawing graph for terminal display.
 *
 * Layout: longest-path ranks on the forward-edge DAG; edges that point back
 * to an earlier rank ("back edges", e.g. repair -> verify) are drawn as a
 * side channel. Straight edges render as │ + ▼ connectors, side branches as
 * elbows, and the active edge carries an animated packet.
 */
import { fg, bg, mix, width, wrap, truncate } from './ansi.mjs';
import { UNICODE_GLYPHS } from './glyphs.mjs';

/** Clip plain text to a display width (no ANSI — canvas cells are raw chars). */
function clip(s, w, ellipsis = '\u2026') {
  let out = '', used = 0;
  for (const ch of String(s)) {
    const cw = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u.test(ch) ? 2 : 1;
    if (used + cw > w) return out + ellipsis;
    out += ch; used += cw;
  }
  return out;
}

/** Parse planD2-style source into { nodes:[{id,label}], edges:[{from,to,label}] }. */
export function parseD2(src) {
  const nodes = new Map();
  const edges = [];
  const ensure = id => {
    if (!nodes.has(id)) nodes.set(id, { id, label: id });
    return nodes.get(id);
  };
  for (const rawLine of String(src).split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line === 'direction: down' || line.startsWith('direction:')) continue;
    const edge = line.match(/^([\w.-]+)\s*-+>\s*([\w.-]+)\s*(?::\s*(.*))?$/);
    if (edge) {
      ensure(edge[1]); ensure(edge[2]);
      edges.push({ from: edge[1], to: edge[2], label: (edge[3] || '').replace(/^"|"$/g, '') });
      continue;
    }
    const decl = line.match(/^([\w.-]+)\s*:\s*(.+)$/);
    if (decl && !decl[2].startsWith('{')) {
      const n = ensure(decl[1]);
      let label = decl[2].trim();
      try { if (label.startsWith('"')) label = JSON.parse(label); } catch { label = label.replace(/^"|"$/g, ''); }
      n.label = label;
    }
  }
  return { nodes: [...nodes.values()], edges };
}

/** Compute ranks (rows) and columns; returns Map<id,{rank,col}> + backEdges. */
export function layoutD2(graph) {
  const ids = graph.nodes.map(n => n.id);
  const back = new Set();
  // Back edge = target already on the DFS path (creates a cycle).
  const adj = new Map(ids.map(id => [id, []]));
  for (const e of graph.edges) adj.get(e.from)?.push(e);
  const stack = new Set(), seen = new Set();
  const dfs = id => {
    if (stack.has(id) || seen.has(id)) return;
    stack.add(id);
    for (const e of adj.get(id) || []) {
      if (stack.has(e.to)) { back.add(e); continue; }
      dfs(e.to);
    }
    stack.delete(id); seen.add(id);
  };
  const roots = ids.filter(id => !graph.edges.some(e => e.to === id));
  (roots.length ? roots : ids.slice(0, 1)).forEach(dfs);
  ids.forEach(dfs); // disconnected leftovers

  // Longest-path ranks over forward edges.
  const rank = new Map(ids.map(id => [id, 0]));
  for (let i = 0; i < ids.length; i++) {
    let moved = false;
    for (const e of graph.edges) {
      if (back.has(e)) continue;
      const want = rank.get(e.from) + 1;
      if (rank.get(e.to) < want) { rank.set(e.to, want); moved = true; }
    }
    if (!moved) break;
  }
  // Back-edge sources go to the side column (1 = right of spine).
  const col = new Map(ids.map(id => [id, 0]));
  for (const e of back) col.set(e.from, 1);
  return { rank, col, back, ranks: Math.max(0, ...rank.values()) + 1 };
}

/**
 * Render the graph to styled lines.
 * opts: { width, theme, states:Map<id,state>, packet:{from,to,phase}, now,
 *   phaseIndex?: number (current PHASES index for rank tinting) }
 * states: pending|active|done|fail|stale|blocked. Returns { lines, hotRow }.
 */
export function renderD2(graph, opts) {
  const { width: W, theme: T, states = new Map(), packet = null, flash = new Set(), frame = 0, phaseIndex = -1, glyphs = UNICODE_GLYPHS } = opts;
  const G = glyphs, B = glyphs.box;
  const { rank, col, back, ranks } = layoutD2(graph);
  // Narrow rails (<40 cols) skip the side channel: repair renders as an
  // inline "↩ failure" badge under verify instead of right-column elbows.
  const narrow = W < 40;
  const sideNodes = !narrow && [...col.values()].includes(1);
  const sideW = sideNodes ? Math.min(14, Math.floor(W * 0.34)) : 0;
  const channelW = sideNodes ? 3 : 0;
  const spineW = W - sideW - channelW;

  // Full node labels, word-wrapped up to 3 text rows — no more 28-char
  // truncation. Boxes go full rail width so text has room to breathe.
  const MAX_TEXT_ROWS = 3;
  const wrapLabel = (label, inner) => {
    const rows = wrap(String(label), Math.max(4, inner)).slice(0, MAX_TEXT_ROWS);
    if (rows.length === MAX_TEXT_ROWS) {
      let last = rows[rows.length - 1];
      if (width(last) >= Math.max(4, inner)) {
        while (width(last + '…') > Math.max(4, inner) && last.length) last = last.slice(0, -1);
        rows[rows.length - 1] = last + '…';
      }
    }
    return rows.length ? rows : [''];
  };

  // Box sizing per node: full available width (spine or side column).
  const boxW = new Map();
  for (const n of graph.nodes) {
    if (narrow && col.get(n.id) === 1) { boxW.set(n.id, 0); continue; } // hidden in narrow mode
    const avail = (col.get(n.id) === 1 ? sideW : spineW) - 2;
    boxW.set(n.id, Math.max(9, avail));
  }

  const centerX = new Map();
  const info = new Map();
  // Variable-height layout: each node measures its wrapped text rows first,
  // then rank tops stack cumulatively (box + 2-row edge gap).
  const EDGE_GAP = 2;
  const nodeRows = new Map(); // id -> wrapped text rows
  for (const n of graph.nodes) {
    const bw = boxW.get(n.id) || 0;
    const inner = Math.max(4, bw - 2);
    nodeRows.set(n.id, wrapLabel(n.label, inner - 2));
  }
  const boxH = id => 2 + (nodeRows.get(id)?.length || 1);
  const rankTop = new Map(); // rank -> top row
  let H = 0;
  {
    let y = 0;
    const maxRank = Math.max(0, ...rank.values());
    for (let r = 0; r <= maxRank; r++) {
      rankTop.set(r, y);
      let tallest = 3;
      for (const n of graph.nodes) {
        if (narrow && col.get(n.id) === 1) continue;
        if (rank.get(n.id) === r) tallest = Math.max(tallest, boxH(n.id));
      }
      y += tallest + EDGE_GAP;
    }
  }
  for (const n of graph.nodes) {
    const r = rank.get(n.id), c = col.get(n.id);
    const bw = boxW.get(n.id);
    const left = c === 1 ? W - bw - 1 : Math.round((spineW - bw) / 2);
    const top = rankTop.get(r) ?? r * (3 + EDGE_GAP);
    const h = boxH(n.id);
    centerX.set(n.id, left + Math.floor(bw / 2));
    info.set(n.id, { left, top, right: left + bw - 1, mid: top + 1, bottom: top + h - 1, bw, rows: nodeRows.get(n.id) || [n.label], h });
  }
  const _H = Math.max(1, ...[...info.values()].map(v => v.bottom + 1));
  const canvas = Array.from({ length: _H }, () => Array.from({ length: W }, () => null));
  const put = (x, y, ch, color, bgc = null, mods = '') => {
    if (x >= 0 && x < W && y >= 0 && y < _H && ch) canvas[y][x] = { ch, color, bg: bgc, mods };
  };
  const hline = (x0, x1, y, ch, color, bgc = null, mods = '') => { for (let x = x0; x <= x1; x++) put(x, y, ch, color, bgc, mods); };

  // Opencode token set with legacy pi2 fallbacks (accent/ok/err/warn/muted/faint/hot).
  const ok = T.diffAdded || T.success || T.ok;
  const err = T.diffRemoved || T.error || T.err;
  const warn = T.warning || T.warn;
  const accent = T.primary || T.accent;
  const hot = T.accent || T.hot || accent;
  const muted = T.muted || T.textMuted || T.faint;
  const faint = T.textMuted || T.faint || muted;
  const panelBg = T.backgroundPanel || T.background;
  const warnTok = T.diffHunkHeader || T.diffContext || warn;
  // Node interior fills: tint the panel with the status color so boxes read
  // as colored surfaces. On dark themes the diff bg variants (diffAddedBg etc.)
  // are pre-tinted and blend nicely at 0.45–0.82. On light themes any tint
  // dark enough to keep text readable is too saturated to look like a tint,
  // so light themes use the plain panel and let the colored border carry the
  // state — the standard light-UI convention.
  const panelLum = (() => {
    const h = (panelBg || '#000').replace('#', '');
    const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  })();
  const isLight = panelLum > 0.5;
  const fillFor = st => {
    if (isLight) return panelBg;
    if (st === 'done') return mix(T.diffAddedBg || ok, panelBg, 0.55);
    if (st === 'fail') return mix(T.diffRemovedBg || err, panelBg, 0.45);
    if (st === 'stale') return mix(warn, panelBg, 0.82);
    if (st === 'active') return mix(accent, panelBg, 0.82);
    if (st === 'blocked') return mix(warn, panelBg, 0.75);
    return panelBg;
  };
  const edgeColor = e => {
    const st = states.get(e.to) || 'pending';
    if (st === 'fail') return err;
    if (st === 'active') return accent;
    if (st === 'done') return ok;
    return T.border;
  };
  const isHot = e => packet && packet.from === e.from && packet.to === e.to;
  const milestone = id => id === 'goal' || id === 'verify' || id === 'deliver';
  const topJoin = id => milestone(id) ? B.topJoinM : B.topJoin;
  const botJoin = id => milestone(id) ? B.botJoinM : B.botJoin;

  // Narrow-mode repair badge rows: the verify->review edge skips its first
  // row so the inline "↩ failure" badge owns it (computed here, stamped below).
  const skippedBadgeRows = new Set();
  if (narrow && info.get('verify')) skippedBadgeRows.add(info.get('verify').bottom + 1);

  // --- nodes first; edges stamped on top so junctions replace border chars ---
  // Phase tint: current-rank borders go primary, prior ranks success, future border.
  for (const n of graph.nodes) {
    if (narrow && col.get(n.id) === 1) continue; // hidden in narrow mode
    const v = info.get(n.id);
    const { left, top, right, bw } = v;
    const rows = v.rows;
    const bottom = v.bottom;
    const st = states.get(n.id) || 'pending';
    const fill = fillFor(st);
    let border = T.border, mods = '', label = muted;
    if (st === 'active') { const p = (Math.sin(frame / 12) + 1) / 2; border = mix(accent, hot, 0.2 + p * 0.55); mods = BOLDM; label = T.text; }
    else if (st === 'done') { border = ok; label = T.text; }
    else if (st === 'fail') { border = err; label = err; }
    else if (st === 'stale') { border = warn; label = T.text; }
    else if (st === 'blocked') { border = warn; label = warn; }
    else if (phaseIndex >= 0) {
      const r = rank.get(n.id);
      if (r < phaseIndex) border = mix(ok, T.border, 0.5);
      else if (r === phaseIndex) border = mix(accent, T.border, 0.25);
    }
    if (flash.has(n.id)) { border = mix(border, '#ffffff', 0.65); mods = BOLDM; }
    const isMilestone = n.id === 'goal' || n.id === 'verify' || n.id === 'deliver';
    const [tl, hz, tr, vt, bl, br] = isMilestone ? [B.mtl, B.mh, B.mtr, B.mv, B.mbl, B.mbr] : [B.tl, B.h, B.tr, B.v, B.bl, B.br];
    const inner = bw - 2;
    put(left, top, tl, border, fill, mods); hline(left + 1, right - 1, top, hz, border, fill, mods); put(right, top, tr, border, fill, mods);
    const glyph = st === 'active' ? G.active : st === 'done' ? G.done : st === 'fail' ? G.fail : st === 'stale' ? G.stale : st === 'blocked' ? G.blocked : G.pending;
    const glyphCol = st === 'pending' ? faint : border;
    const gpad = inner >= 12 ? 2 : 0; // glyph + space, dropped when boxes get tight
    rows.forEach((rowText, ri) => {
      const y = top + 1 + ri;
      put(left, y, vt, border, fill, mods); put(right, y, vt, border, fill, mods);
      for (let x = left + 1; x <= right - 1; x++) put(x, y, ' ', label, fill, mods);
      const tw = width(rowText) + (ri === 0 ? gpad : 0);
      const tx = left + 1 + Math.max(0, Math.floor((inner - tw) / 2));
      let cx = tx;
      if (ri === 0 && gpad) { put(cx, y, glyph, glyphCol, fill, mods); cx += gpad; }
      [...rowText].forEach(ch => { put(cx, y, ch, label, fill, st === 'active' ? BOLDM : ''); cx += width(ch) || 1; });
    });
    put(left, bottom, bl, border, fill, mods); hline(left + 1, right - 1, bottom, hz, border, fill, mods); put(right, bottom, br, border, fill, mods);
    // Swirl: a bright comet of 3 cells orbits the active box's perimeter,
    // overdrawing border chars with a hot→accent gradient so the box stays
    // intact while a light visibly travels around it (the "current step").
    if (st === 'active') {
      const perim = [];
      for (let x = left; x <= right; x++) perim.push([x, top]);
      for (let y = top + 1; y <= bottom; y++) perim.push([right, y]);
      for (let x = right - 1; x >= left; x--) perim.push([x, bottom]);
      for (let y = bottom - 1; y >= top + 1; y--) perim.push([left, y]);
      const len = perim.length;
      if (len > 0) {
        const head = Math.floor(frame * 1.5) % len;
        const comet = [mix(accent, '#ffffff', 0.55), mix(hot, accent, 0.5), mix(accent, hot, 0.3)];
        for (let k = 0; k < comet.length; k++) {
          const [sx, sy] = perim[(head - k + len) % len];
          const cell = canvas[sy]?.[sx];
          if (cell?.ch) put(sx, sy, cell.ch, comet[k], fill, BOLDM);
        }
      }
    }
  }
  // Narrow-mode repair badge: inline "↩ failure" on the reserved row.
  if (narrow) {
    const v = info.get('verify');
    if (v && skippedBadgeRows.has(v.bottom + 1)) {
      const badge = G.back + ' failure';
      const row = v.bottom + 1;
      const bx = Math.max(0, Math.min(W - width(badge), v.left - 1));
      [...badge].forEach((ch, i) => put(bx + i, row, ch, (states.get('repair') === 'fail' || states.get('verify') === 'fail') ? err : warnTok));
    }
  }

  // --- edges ---
  // Repair back-edges render dashed in the failure color; the hot edge
  // carries a two-cell packet. Edges into stale targets go warning.
  for (const e of graph.edges) {
    const a = info.get(e.from), b = info.get(e.to);
    if (!a || !b) continue;
    if (narrow && (col.get(e.from) === 1 || col.get(e.to) === 1)) continue;
    let c = edgeColor(e);
    if (back.has(e)) c = err;
    else if ((states.get(e.to) || 'pending') === 'stale') c = warn;
    const dashed = back.has(e);
    const vch = dashed ? B.dashV : B.v, hch = dashed ? B.dashH : B.h;
    const backEdge = back.has(e);
    const sameCol = col.get(e.from) === col.get(e.to) && !backEdge;
    if (sameCol && narrow && e.from === 'verify') {
      // narrow mode: reserved for the badge (see skippedBadgeRows above).
    }
    if (sameCol) {
      const x = centerX.get(e.from), tx = centerX.get(e.to);
      put(x, a.bottom, botJoin(e.from), c);
      const drop = b.top - a.bottom - 1;
      if (x === tx) {
        const hotEdge = isHot(e);
        const toActive = (states.get(e.to) || 'pending') === 'active';
        const pulse = toActive ? (Math.sin(frame / 12) + 1) / 2 : 0;
        for (let y = a.bottom + 1; y < b.top - 1; y++) {
          if (skippedBadgeRows.has(y) && x >= 0) {
            // narrow badge row: keep the badge, skip the spine cell only
            // where they would overlap (badge owns its run).
            continue;
          }
          const step = Math.max(1, drop);
          const pk = hotEdge && ((y - a.bottom + frame) % step) < 2 && drop > 1;
          // Slow brightness pulse on the connector into the active node so the
          // arrow's "stem" breathes in sync with its head (not just the packet).
          const lineCol = toActive && !pk ? mix(c, hot, 0.15 + pulse * 0.5) : c;
          put(x, y, pk ? (frame % 2 ? G.packetOn : G.packetOff) : vch, pk ? hot : lineCol);
        }
        // Arrowhead into the active node breathes slowly: hollow ~1/8 cycle,
        // color pulsed toward hot on the active-border phase.
        put(tx, b.top - 1, toActive && frame % 16 < 2 ? G.arrowDownHollow : G.arrowDown,
          hotEdge ? hot : toActive ? mix(c, hot, 0.2 + pulse * 0.6) : c);
        put(tx, b.top, topJoin(e.to), states.get(e.to) === 'pending' ? T.border : c);
      } else {
        for (let y = a.bottom + 1; y < b.top - 1; y++) put(x, y, vch, c);
        put(x, b.top - 1, x < tx ? B.elbowUR : B.elbowUL, c);
        hline(Math.min(x, tx) + 1, Math.max(x, tx) - 1, b.top - 1, hch, c);
        put(tx, b.top - 1, x < tx ? B.elbowDL : B.elbowDR, c);
        put(tx, b.top, topJoin(e.to), c);
      }
      if (e.label) {
        const lx = x + 2;
        [...e.label].slice(0, Math.max(0, W - lx - 1)).forEach((ch, i) => put(lx + i, a.bottom + 1, ch, warnTok));
      }
    } else if (backEdge) {
      const chX = W - 1;
      // Attach at the vertical middle text row of the (possibly tall) boxes.
      const aMid = a.top + 1 + Math.floor(((a.rows?.length || 1) - 1) / 2);
      const bMid = b.top + 1 + Math.floor(((b.rows?.length || 1) - 1) / 2);
      hline(a.right + 1, chX - 1, aMid, B.h, c);
      put(chX, aMid, B.elbowUL, c);
      for (let y = bMid + 1; y < aMid; y++) put(chX, y, B.v, c);
      put(chX, bMid, B.elbowDL, c);
      hline(b.right + 1, chX - 1, bMid, B.h, c);
      // Same slow blink on the side-channel arrowhead when it lands on the
      // active node — color stays (back-edges are the failure channel).
      put(b.right, bMid, (states.get(e.to) || 'pending') === 'active' && frame % 16 < 2 ? G.arrowLeftHollow : G.arrowLeft, c);
    } else {
      // forward edge into the side column: drop near parent's right, elbow over, land on child top
      const x = Math.min(a.right - 1, a.left + Math.floor(a.bw * 0.7));
      put(x, a.bottom, botJoin(e.from), c);
      for (let y = a.bottom + 1; y < b.top - 1; y++) put(x, y, B.v, c);
      const tx = centerX.get(e.to);
      put(x, b.top - 1, B.elbowUR, c);
      hline(x + 1, tx - 1, b.top - 1, B.h, c);
      put(tx, b.top - 1, B.elbowDL, c);
      put(tx, b.top, topJoin(e.to), c);
      if (e.label) {
        const lx = x + 2;
        [...e.label].slice(0, Math.max(0, W - lx - 1)).forEach((ch, i) => put(lx + i, a.bottom + 1, ch, warnTok));
      }
    }
  }

  // --- emit (per-cell fg+bg; bg falls back to the panel so fills survive) ---
  const lines = canvas.map(row => {
    let out = '', cur = null;
    for (const cell of row) {
      if (!cell) { if (cur !== null) { out += RST; cur = null; } out += ' '; continue; }
      const key = cell.color + '|' + (cell.bg || '') + '|' + cell.mods;
      if (key !== cur) { out += (cell.mods || '') + fg(cell.color) + bg(cell.bg || panelBg); cur = key; }
      out += cell.ch;
    }
    if (cur !== null) out += RST;
    return out;
  });
  // hotRow = top row of the frontier node (for viewport follow).
  // Also return the frontier id + full label so the rail can print an
  // untruncated detail line for labels that exceed even 3 wrapped rows.
  const ordered = [...graph.nodes].sort((a, b) => rank.get(a.id) - rank.get(b.id));
  let hotRow = 0;
  const firstPending = ordered.find(n => (states.get(n.id) || 'pending') === 'pending');
  const frontier = ordered.find(n => ['active', 'fail', 'stale', 'blocked'].includes(states.get(n.id))) || firstPending;
  if (frontier && info.get(frontier.id)) hotRow = info.get(frontier.id).top;
  return { lines, hotRow, frontierId: frontier?.id || null, frontierLabel: frontier ? String(frontier.label) : '' };
}

const BOLDM = '\x1b[1m';
const RST = '\x1b[0m';

/**
 * Compact one-row-per-node renderer. The box layout costs at least 5 rows per
 * rank, so even a 6-step plan overflows a split-pane rail (measured: 3 steps =
 * 40 rows, 6 = 61, 12 = 103 at width 44). This keeps the whole plan visible by
 * drawing each node as a single line in rank order — a tree rail for the spine
 * and a back-arrow indent for the side channel (repair) — while preserving the
 * frontier fields the rail's detail line depends on.
 * Returns the same { lines, hotRow, frontierId, frontierLabel } shape.
 */
export function renderD2Compact(graph, opts) {
  const { width: W, theme: T, states = new Map(), glyphs = UNICODE_GLYPHS } = opts;
  const G = glyphs, B = glyphs.box;
  const { rank, col } = layoutD2(graph);
  const accent = T.primary || T.accent;
  const ok = T.diffAdded || T.success || T.ok;
  const err = T.diffRemoved || T.error || T.err;
  const warn = T.warning || T.warn;
  const faint = T.textMuted || T.faint;
  const muted = T.muted || faint;
  const ordered = [...graph.nodes].sort((a, b) => (rank.get(a.id) - rank.get(b.id)) || (col.get(a.id) - col.get(b.id)));
  const spine = ordered.filter(n => col.get(n.id) === 0);
  const idW = Math.max(4, Math.min(9, ...ordered.map(n => n.id.length)));
  const statusColor = st => st === 'active' ? accent : st === 'done' ? ok : st === 'fail' ? err : (st === 'stale' || st === 'blocked') ? warn : faint;
  const statusGlyph = st => st === 'active' ? G.active : st === 'done' ? G.done : st === 'fail' ? G.fail : st === 'stale' ? G.stale : st === 'blocked' ? G.blocked : G.pending;
  const lines = [];
  const rows = new Map();
  for (const n of ordered) {
    const st = states.get(n.id) || 'pending';
    const side = col.get(n.id) === 1;
    const spineIdx = spine.indexOf(n);
    const rail = side
      ? `${fg(faint)}  ${G.back}${RST}`
      : `${fg(faint)}${spineIdx === spine.length - 1 ? B.elbowUR : B.tee}${B.h}${RST}`;
    const id = String(n.id).padEnd(idW);
    const label = clip(String(n.label).replace(/\s+/g, ' ').trim(), Math.max(4, W - idW - 6), G.ellipsis);
    const labelColor = st === 'fail' ? err : st === 'pending' ? muted : T.text;
    rows.set(n.id, lines.length);
    lines.push(truncate(`${rail} ${fg(statusColor(st))}${statusGlyph(st)}${RST} ${fg(statusColor(st))}${BOLDM}${id}${RST} ${fg(labelColor)}${label}${RST}`, W));
  }
  const firstPending = ordered.find(n => (states.get(n.id) || 'pending') === 'pending');
  const frontier = ordered.find(n => ['active', 'fail', 'stale', 'blocked'].includes(states.get(n.id))) || firstPending;
  return { lines, hotRow: frontier ? (rows.get(frontier.id) ?? 0) : 0, frontierId: frontier?.id || null, frontierLabel: frontier ? String(frontier.label) : '' };
}

/** Summary: count node states for the header strip. */
export function graphStats(states) {
  const c = { active: 0, done: 0, fail: 0, pending: 0, blocked: 0 };
  for (const s of states.values()) c[s] = (c[s] || 0) + 1;
  return c;
}
