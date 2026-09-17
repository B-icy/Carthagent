import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseD2, layoutD2, renderD2 } from '../lib/tui/d2.mjs';
import { planSideWidth, makeKeyParser, matchSlash, slashCardDimensions, renderSlashCard, computeNodeStates, barRange, scrollCell } from '../lib/tui/app.mjs';
import { UNICODE_GLYPHS, ASCII_GLYPHS, detectGlyphMode, resolveGlyphs } from '../lib/tui/glyphs.mjs';
import { planD2, computePhase, freshChecks, PHASES } from '../lib/delivery.mjs';
import { createFeed, resetFeed, applyEvent, summarizeArgs, renderFeed, hydrateFeed } from '../lib/tui/feed.mjs';
import { strip, width, wrap, truncate, hasTruecolor, sliceCols, inverseCols, mix, fg } from '../lib/tui/ansi.mjs';
import { getTheme, resolveThemeName, flattenTheme, THEME_NAMES } from '../lib/tui/theme.mjs';
import { framePrompt, shouldFrame, unframe, frameHint, FRAME_HINTS } from '../lib/tui/framing.mjs';
import { listSessions, mostRecentSession, sessionDirFor, buildPiArgs } from '../lib/pi.mjs';
import { loadScenario, listScenarios, expandPlaceholders } from '../lib/scenarios.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SAMPLE_PLAN = {
  goal: 'Build a task CLI',
  assumptions: ['stdlib only'],
  artifacts: ['.'],
  steps: ['slice', 'persist', 'tests'],
  acceptance: [{ requirement: 'commands work', checks: ['tests'] }],
  checks: [{ id: 'tests', kind: 'test', argv: ['node', '--test'], timeoutSeconds: 30 }],
};

test('parseD2 parses planD2 output into nodes and edges', () => {
  const g = parseD2(planD2(SAMPLE_PLAN));
  const ids = g.nodes.map(n => n.id);
  for (const id of ['goal', 'step0', 'step1', 'step2', 'verify', 'review', 'repair', 'deliver']) assert.ok(ids.includes(id), `missing ${id}`);
  assert.equal(g.nodes.find(n => n.id === 'goal').label, 'Build a task CLI');
  assert.ok(g.edges.some(e => e.from === 'verify' && e.to === 'repair' && e.label === 'failure'));
  assert.ok(g.edges.some(e => e.from === 'repair' && e.to === 'verify'));
});

test('layoutD2 ranks spine linearly and puts repair in the side column', () => {
  const g = parseD2(planD2(SAMPLE_PLAN));
  const { rank, col, back } = layoutD2(g);
  assert.equal(rank.get('goal'), 0);
  assert.equal(rank.get('step0'), 1);
  assert.equal(rank.get('verify'), 4);
  assert.equal(rank.get('review'), 5);
  assert.equal(rank.get('deliver'), 6);
  assert.equal(col.get('repair'), 1);
  assert.equal(back.size, 1);
  assert.ok([...back][0].from === 'repair' && [...back][0].to === 'verify');
});

test('renderD2 emits styled lines that fit the requested width', () => {
  const g = parseD2(planD2(SAMPLE_PLAN));
  const states = new Map([['goal', 'done'], ['step0', 'active']]);
  const { lines, hotRow, frontierId, frontierLabel } = renderD2(g, { width: 44, theme: getTheme('opencode'), states, frame: 2 });
  assert.ok(lines.length >= 7 * 3); // variable-height boxes: >=3 rows per rank
  for (const l of lines) assert.ok(width(l) <= 44, `overflow: ${JSON.stringify(l)}`);
  const plain = strip(lines.join('\n'));
  assert.match(plain, /goal|task CLI/i);
  assert.ok(hotRow > 0);
  assert.equal(frontierId, 'step0');
  assert.match(frontierLabel, /slice/);
});

test('renderD2 breathes the arrowhead into the active node', () => {
  const g = parseD2(planD2(SAMPLE_PLAN));
  const theme = getTheme('mono');
  const states = new Map([['goal', 'done'], ['step0', 'active'], ['verify', 'active']]);
  const plain = f => strip(renderD2(g, { width: 44, theme, states, frame: f }).lines.join('\n'));
  // Hollow ~1/4 of the cycle, solid the rest — forward ▼ and back-edge ◀ alike.
  assert.ok(plain(0).includes('▽'));
  assert.ok(plain(0).includes('◁'));
  assert.ok(!plain(2).includes('▽'));
  assert.ok(!plain(2).includes('◁'));
  assert.ok(plain(2).includes('▼'));
  assert.ok(plain(2).includes('◀'));
  // No active target → arrowheads stay solid at every frame.
  const idle = new Map([['goal', 'done'], ['step0', 'done']]);
  for (const f of [0, 1, 2]) {
    const p = strip(renderD2(g, { width: 44, theme, states: idle, frame: f }).lines.join('\n'));
    assert.ok(!p.includes('▽') && !p.includes('◁'), `frame ${f}`);
  }
});

test('renderD2 swirls a comet around the active node border', () => {
  const g = parseD2(planD2(SAMPLE_PLAN));
  const theme = getTheme('opencode');
  const accent = theme.primary || theme.accent;
  // The comet head is the only border cell mixed toward pure white, so its
  // exact SGR sequence is a stable fingerprint the base border pulse never hits.
  const head = fg(mix(accent, '#ffffff', 0.55));
  const pos = (f, states) => {
    const { lines } = renderD2(g, { width: 44, theme, states, frame: f });
    for (let y = 0; y < lines.length; y++) {
      const at = lines[y].indexOf(head);
      if (at < 0) continue;
      const ch = lines[y].slice(at + head.length).replace(/\x1b\[[\d;]*m/g, '')[0];
      if (/[=\u250c-\u257f]/.test(ch)) return `${y}:${strip(lines[y].slice(0, at)).length}`;
    }
    return null;
  };
  const active = new Map([['goal', 'done'], ['step0', 'active']]);
  assert.ok(pos(0, active) != null, 'comet head present on the active node');
  assert.notEqual(pos(0, active), pos(7, active), 'comet orbits the perimeter between frames');
  const idle = new Map([['goal', 'done'], ['step0', 'done']]);
  const { lines } = renderD2(g, { width: 44, theme, states: idle, frame: 0 });
  assert.ok(!lines.join('\n').includes(head), 'no comet when no active node');
});


test('renderD2 works at tiny widths without crashing', () => {
  const g = parseD2(planD2(SAMPLE_PLAN));
  for (const w of [12, 20, 30, 34, 44, 60, 80]) {
    const { lines, hotRow } = renderD2(g, { width: w, theme: getTheme('mono'), states: new Map(), frame: 0 });
    for (const l of lines) assert.ok(width(l) <= w, `overflow w=${w}`);
    assert.ok(hotRow >= 0 && hotRow < lines.length);
  }
});

test('renderD2 light themes use plain panel fills (text stays readable)', () => {
  const g = parseD2(planD2(SAMPLE_PLAN));
  for (const name of ['paper', 'daylight', 'solarized-light', 'contrast-light', 'okabe-light']) {
    const theme = getTheme(name, 'light');
    const states = new Map([['goal', 'done'], ['step0', 'active'], ['verify', 'fail']]);
    const { lines } = renderD2(g, { width: 60, theme, states, frame: 0 });
    // The fill for every state on a light theme is the panel background —
    // text on the fill is text on the panel, which passes WCAG AA by design.
    assert.ok(lines.length > 0, `${name} rendered`);
  }
});

test('renderD2 wraps long labels across rows instead of truncating', () => {
  const plan = { ...SAMPLE_PLAN, steps: ['inspect and probe the existing runtime and APIs before writing any code'] };
  const g = parseD2(planD2(plan));
  const { lines } = renderD2(g, { width: 44, theme: getTheme('opencode'), states: new Map(), frame: 0 });
  const plain = strip(lines.join('\n'));
  // First wrapped row is ellipsis-free; full words survive across rows.
  assert.match(plain, /inspect and probe/);
  assert.match(plain, /before writing/);
  for (const l of lines) assert.ok(width(l) <= 44);
});

test('renderD2 exposes the frontier for the rail detail line', () => {
  const g = parseD2(planD2(SAMPLE_PLAN));
  const r = renderD2(g, { width: 44, theme: getTheme('opencode'), states: new Map([['goal', 'done'], ['verify', 'fail']]), frame: 0 });
  assert.equal(r.frontierId, 'verify');
  assert.ok(r.frontierLabel.length > 0);
  assert.ok(Array.isArray(r.boxes), 'boxes metadata should be returned');
  assert.ok(r.boxes.length > 0, 'boxes should contain nodes');
  for (const b of r.boxes) {
    assert.ok(b.id, 'box has id');
    assert.ok(typeof b.top === 'number' && typeof b.bottom === 'number');
    assert.ok(b.bottom >= b.top + 2, `box ${b.id} must be at least 3 rows tall`);
    assert.equal(b.h, b.bottom - b.top + 1);
  }
});

test('renderD2 preserves complete box borders and does not overflow width', () => {
  const g = parseD2(planD2(SAMPLE_PLAN));
  for (const w of [20, 30, 44, 60]) {
    const r = renderD2(g, { width: w, theme: getTheme('opencode'), states: new Map(), frame: 0 });
    for (const l of r.lines) {
      assert.ok(width(l) <= w, `line width ${width(l)} must not exceed ${w}`);
    }
    for (const b of r.boxes) {
      // Top border of box b must contain top corner characters and horizontal line
      const topRow = strip(r.lines[b.top]);
      const botRow = strip(r.lines[b.bottom]);
      assert.ok(topRow.includes('╭') || topRow.includes('╔'), `top border exists for ${b.id}`);
      assert.ok(botRow.includes('╰') || botRow.includes('╚'), `bottom border exists for ${b.id}`);
    }
  }
});

test('planSideWidth tiers widen the rail on wide terminals', () => {
  // Tier boundaries: <120 legacy, 120/160/200 steps up. Feed guard keeps 36.
  assert.equal(planSideWidth(100), Math.max(34, Math.min(56, Math.floor(100 * 0.36))));
  assert.equal(planSideWidth(120), Math.min(64, Math.floor(120 * 0.38)));
  assert.equal(planSideWidth(160), Math.min(72, Math.floor(160 * 0.40)));
  assert.equal(planSideWidth(200), Math.min(84, Math.floor(200 * 0.42)));
  assert.ok(planSideWidth(200) > planSideWidth(100));
});

test('renderD2 works with legacy theme aliases via opencode tokens', () => {
  const g = parseD2(planD2(SAMPLE_PLAN));
  for (const name of ['opencode', 'tokyonight', 'nebula', 'ember', 'forest', 'mono']) {
    const theme = getTheme(name);
    assert.ok(theme.primary && theme.text && theme.border, `missing tokens: ${name}`);
    assert.ok(theme.diffAdded && theme.diffRemoved, `missing diff tokens: ${name}`);
    assert.ok(theme.markdownCode && theme.syntaxKeyword, `missing md/syntax tokens: ${name}`);
    const { lines } = renderD2(g, { width: 40, theme, states: new Map(), frame: 0 });
    for (const l of lines) assert.ok(width(l) <= 40, `overflow ${name}`);
  }
});

test('feed reducer handles a full run lifecycle', () => {
  const S = createFeed();
  applyEvent(S, { type: 'agent_start' });
  applyEvent(S, { type: 'turn_start' });
  applyEvent(S, { type: 'message_start', message: { role: 'user', content: [{ type: 'text', text: 'build x' }] } });
  applyEvent(S, { type: 'message_start', message: { role: 'assistant', content: [] } });
  applyEvent(S, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'working ' } });
  applyEvent(S, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'on it' } });
  applyEvent(S, { type: 'message_update', assistantMessageEvent: { type: 'toolcall_start', contentIndex: 1, id: 't1', toolName: 'bash' } });
  applyEvent(S, { type: 'tool_execution_start', toolCallId: 't1', toolName: 'bash', args: { command: 'npm test' } });
  applyEvent(S, { type: 'tool_execution_end', toolCallId: 't1', toolName: 'bash', isError: false, result: { content: [{ type: 'text', text: 'ok\npassed' }] } });
  applyEvent(S, { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'working on it' }], usage: { totalTokens: 100, cost: { total: 0.01 } }, stopReason: 'stop' } });
  applyEvent(S, { type: 'agent_end', messages: [], willRetry: false });
  applyEvent(S, { type: 'agent_settled' });

  assert.equal(S.turns, 1);
  assert.equal(S.tokens, 100);
  assert.ok(!S.running);
  assert.ok(S.settled);
  const tool = S.blocks.find(b => b.kind === 'tool');
  assert.equal(tool.status, 'done');
  assert.deepEqual(tool.tail.slice(-1), ['passed']);
  const user = S.blocks.find(b => b.kind === 'user');
  assert.equal(user.text, 'build x');
});

test('feed dedupes a locally echoed user prompt', () => {
  const S = createFeed();
  S.blocks.push({ kind: 'user', text: 'hi', t: Date.now() });
  applyEvent(S, { type: 'message_start', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } });
  assert.equal(S.blocks.filter(b => b.kind === 'user').length, 1);
});

test('resetFeed clears blocks, tools, and resets tokens and cost counters', () => {
  const S = createFeed();
  applyEvent(S, { type: 'agent_start' });
  applyEvent(S, { type: 'turn_start' });
  applyEvent(S, { type: 'message_start', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } });
  applyEvent(S, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'done' } });
  applyEvent(S, { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }], usage: { totalTokens: 350, cost: { total: 0.05 } }, stopReason: 'stop' } });
  assert.equal(S.tokens, 350);
  assert.equal(S.cost, 0.05);
  assert.ok(S.blocks.length > 0);

  resetFeed(S);
  assert.equal(S.tokens, 0);
  assert.equal(S.cost, 0);
  assert.equal(S.toolCalls, 0);
  assert.equal(S.turns, 0);
  assert.equal(S.blocks.length, 0);
  assert.equal(S.toolBlocks.size, 0);
  assert.equal(S.currentAssistant, null);
  assert.equal(S.currentThinking, null);
  assert.equal(S.running, false);
  assert.equal(S.settled, true);
});

test('renderFeed produces width-bounded lines', () => {
  const S = createFeed();
  applyEvent(S, { type: 'message_start', message: { role: 'assistant', content: [] } });
  applyEvent(S, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'A '.repeat(200) } });
  const { lines } = renderFeed(S, 60, getTheme('opencode'), { frame: 0 });
  for (const l of lines) assert.ok(width(l) <= 60);
});

test('renderFeed stays width-bounded across all themes', () => {
  for (const name of THEME_NAMES) {
    const S = createFeed();
    applyEvent(S, { type: 'message_start', message: { role: 'assistant', content: [] } });
    applyEvent(S, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'B '.repeat(120) } });
    applyEvent(S, { type: 'tool_execution_start', toolCallId: 't1', toolName: 'delivery_check', args: { id: 'all' } });
    applyEvent(S, { type: 'tool_execution_end', toolCallId: 't1', toolName: 'delivery_check', isError: true, result: { content: [{ type: 'text', text: 'fail line 1\nfail line 2' }] } });
    const { lines } = renderFeed(S, 60, getTheme(name), { frame: 0 });
    for (const l of lines) assert.ok(width(l) <= 60, `overflow ${name}`);
  }
});

test('summarizeArgs gives concise tool summaries', () => {
  assert.equal(summarizeArgs('read', { path: 'a/b.ts' }), 'a/b.ts');
  assert.match(summarizeArgs('write', { path: 'x', content: 'abcd' }), /x · 4B/);
  assert.equal(summarizeArgs('bash', { command: 'ls -la' }), 'ls -la');
  assert.equal(summarizeArgs('delivery_check', { id: 'all' }), 'id=all');
});

test('ansi helpers measure and clip styled text', () => {
  assert.equal(width('héllo'), 5);
  assert.equal(width('\x1b[31mred\x1b[0m'), 3);
  const w = wrap('the quick brown fox jumps', 10);
  assert.ok(w.length >= 3);
  for (const l of w) assert.ok(width(l) <= 10);
  assert.equal(strip(truncate('\x1b[31mabcdef\x1b[0m', 3)), 'abc');
});

test('themes resolve by name and label, defaulting to opencode', () => {
  assert.equal(resolveThemeName('EMBER'), 'ember');
  assert.equal(resolveThemeName('Opencode'), 'opencode');
  assert.equal(resolveThemeName('Tokyonight'), 'tokyonight');
  assert.equal(resolveThemeName('nope'), 'opencode');
  assert.equal(resolveThemeName(), 'opencode');
  assert.ok(THEME_NAMES.includes('opencode') && THEME_NAMES.includes('tokyonight'));
  // opencode-ripped default: dark bg, purple primary, cyan success.
  const t = getTheme('opencode');
  assert.equal(t.background, '#0f0f0f');
  assert.equal(t.primary, '#a277ff');
  assert.equal(t.success, '#61ffca');
  // legacy aliases still resolve through the flattened palette.
  assert.ok(t.accent && t.ok && t.err && t.faint && t.muted);
  // light mode flattens {dark,light} pairs to the light variant.
  const light = flattenTheme({ defs: { a: '#111111', b: '#222222' }, theme: { primary: { dark: 'a', light: 'b' } } }, 'light');
  assert.equal(light.primary, '#222222');
  assert.equal(typeof hasTruecolor(), 'boolean');
});

test('framing expands the delivery template behind the scenes', () => {
  const out = framePrompt('build a cli');
  assert.match(out, /in phases.*build a cli/);
  assert.match(out, /delivery_plan/);
  assert.match(out, /delivery_progress/);
  // fallback: empty template returns the task
  assert.equal(framePrompt('build a cli', ''), 'build a cli');
  assert.equal(framePrompt('task', 'Do $@ now'), 'Do task now');
  assert.deepEqual(FRAME_HINTS, ['Message pi…']);
  assert.equal(frameHint(0), 'Message pi…');
  assert.equal(frameHint(500), 'Message pi…');
});

test('shouldFrame gates framing to substantial prompts', () => {
  assert.ok(shouldFrame('build a task cli with tests'));
  assert.ok(!shouldFrame('/compact'));
  assert.ok(!shouldFrame('!ls'));
  assert.ok(!shouldFrame('what does index.ts do?'));
  assert.ok(!shouldFrame('what does index.ts do'));
  assert.ok(shouldFrame('what cache layer should I add — implement it'));
  assert.ok(!shouldFrame('build x', { enabled: false }));
  assert.ok(!shouldFrame('build x', { delivery: false }));
});

test('scenario manifests load and expand placeholders', () => {
  const names = listScenarios(ROOT);
  assert.ok(names.includes('cli') && names.includes('game'));
  const cli = loadScenario(ROOT, 'cli');
  assert.match(cli.prompt, /task tracker/i);
  assert.equal(cli.developmentChecks[0].id, 'acceptance');
  const argv = expandPlaceholders(cli.developmentChecks[0].argv, { python: '/py', cwd: '/w', scenario: cli.dir });
  assert.equal(argv[0], '/py');
  assert.ok(argv[1].endsWith('grade_cli.py'));
  assert.equal(argv[2], '/w');
  const game = loadScenario(ROOT, 'game');
  assert.ok(game.seeds.length && game.developmentChecks.length === 2 && game.holdoutChecks.length === 1);
  assert.ok(game.context.includes('game-development'));
  assert.ok(game.needsPython);
  assert.throws(() => loadScenario(ROOT, 'nonexistent'), /Unknown scenario/);
  assert.throws(() => loadScenario(ROOT, '../outside'), /Invalid scenario name/);
});

test('unframe recovers the typed task from framed prompts', () => {
  const expanded = framePrompt('build a cli');
  assert.equal(unframe(expanded), 'build a cli');
  assert.equal(unframe('just a plain prompt'), null);
  assert.equal(unframe(''), null);
});

test('computePhase derives the rail tracker state', () => {
  assert.deepEqual(computePhase(null, 'abc').phase, 'inspect');
  assert.deepEqual(PHASES, ['inspect', 'plan', 'build', 'verify', 'review', 'deliver']);
  const plan = {
    goal: 'g', steps: ['s'], acceptance: [{ requirement: 'r', checks: ['tests'] }],
    checks: [{ id: 'tests', kind: 'test', argv: ['node', '--test'], timeoutSeconds: 30 }],
  };
  assert.equal(computePhase({ plan, evidence: {}, status: 'implementing', revision: 2 }, 'h1').phase, 'plan');
  assert.equal(computePhase({ plan, evidence: {}, status: 'implementing', revision: 2 }, 'h1').revision, 2);
  assert.equal(computePhase({ plan, evidence: {}, status: 'implementing', stepStatus: { step0: 'active' } }, 'h1').phase, 'build');
  assert.equal(computePhase({ plan, evidence: {}, status: 'verifying' }, 'h1', true).phase, 'verify');
  const fresh = { plan, evidence: { tests: { passed: true, fingerprint: 'h1' } }, status: 'implementing' };
  assert.equal(computePhase(fresh, 'h1').phase, 'review');
  assert.deepEqual(freshChecks(fresh, 'h1'), { fresh: 1, total: 1 });
  assert.deepEqual(freshChecks(fresh, 'h2'), { fresh: 0, total: 1 });
  assert.equal(computePhase({ ...fresh, status: 'verified' }, 'h1').phase, 'deliver');
  assert.equal(computePhase({ ...fresh, status: 'blocked' }, 'h1').phase, 'deliver');
});

test('hydrateFeed rebuilds history blocks from session entries', () => {
  const entries = [
    { type: 'session', id: 's1', timestamp: '2026-01-01T00:00:00Z' },
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: framePrompt('do the thing') }] } },
    { type: 'message', message: { role: 'assistant', content: [
      { type: 'thinking', thinking: 'hmm' },
      { type: 'text', text: 'planning' },
      { type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } },
    ], usage: { totalTokens: 10, cost: { total: 0.01 } } } },
    { type: 'message', message: { role: 'toolResult', toolCallId: 'c1', toolName: 'bash', content: [{ type: 'text', text: 'ok\nline2' }], isError: false } },
    { type: 'custom', customType: 'delivery-gate' },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }], usage: { totalTokens: 5, cost: { total: 0.005 } } } },
  ];
  const S = createFeed();
  hydrateFeed(S, entries);
  const user = S.blocks.find(b => b.kind === 'user');
  assert.equal(user.text, 'do the thing');
  // framed prompts carry no badge — delivery is the default flow.
  assert.equal(user.via, undefined);
  const tool = S.blocks.find(b => b.kind === 'tool');
  assert.equal(tool.name, 'bash');
  assert.equal(tool.status, 'done');
  assert.deepEqual(tool.tail.slice(-1), ['line2']);
  assert.ok(S.blocks.some(b => b.kind === 'thinking'));
  assert.equal(S.tokens, 15);
  assert.equal(S.toolCalls, 1);
  const { lines } = renderFeed(S, 60, getTheme('opencode'), { frame: 0 });
  for (const l of lines) assert.ok(width(l) <= 60);
});

test('hydrateFeed unwraps framed prompts without badges', () => {
  const entries = [
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: framePrompt('framed task') }] } },
  ];
  const S = createFeed();
  hydrateFeed(S, entries);
  const user = S.blocks.find(b => b.kind === 'user');
  assert.equal(user.text, 'framed task');
  assert.equal(user.via, undefined);
});

test('listSessions reads metadata newest-first and mostRecentSession picks the head', t => {
  const dir = mkdtempSync(join(tmpdir(), 'pi2 sessions '));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const mk = (file, id, userText, extra = []) => writeFileSync(join(dir, file), [
    JSON.stringify({ type: 'session', version: 3, id, timestamp: '2026-01-01T00:00:00Z', cwd: '/x' }),
    ...extra.map(e => JSON.stringify(e)),
    JSON.stringify({ type: 'message', id: 'm1', message: { role: 'user', content: [{ type: 'text', text: userText }] } }),
    '',
  ].join('\n'));
  mk('old_aaaa.jsonl', 'aaaa', 'first task', [{ type: 'session_info', name: 'alpha work' }]);
  mk('new_bbbb.jsonl', 'bbbb', 'second task');
  writeFileSync(join(dir, 'not-a-session.txt'), 'nope');
  utimesSync(join(dir, 'old_aaaa.jsonl'), new Date(1000), new Date(1000));
  utimesSync(join(dir, 'new_bbbb.jsonl'), new Date(2000), new Date(2000));
  const list = listSessions('/unused', { dir });
  assert.equal(list.length, 2);
  assert.equal(list[0].id, 'bbbb');
  assert.equal(list[1].id, 'aaaa');
  assert.equal(list[1].name, 'alpha work');
  assert.equal(list[1].firstMessage, 'first task');
  assert.equal(list[1].messageCount, 1);
  assert.equal(mostRecentSession('/unused', dir), list[0].path);
  assert.equal(sessionDirFor('/home/u/proj', '/agent'), join('/agent', 'sessions', '--home-u-proj--'));
});

test('buildPiArgs forwards session selection but never --resume', () => {
  assert.deepEqual(buildPiArgs({ session: 'abc123', delivery: false }, { installed: true }), ['--session', 'abc123']);
  assert.deepEqual(buildPiArgs({ continue: true, delivery: false }, { installed: true }), ['--continue']);
  assert.ok(!buildPiArgs({ resume: true, delivery: false }, { installed: true }).includes('--resume'));
});

test('buildPiArgs forwards the self-review mode to the delivery extension', () => {
  const args = buildPiArgs({ review: 'yes' });
  const i = args.indexOf('--delivery-review');
  assert.ok(i > -1 && args[i + 1] === 'yes');
  assert.ok(!buildPiArgs({ delivery: false, review: 'yes' }).includes('--delivery-review'), 'no extension, no flag');
  assert.ok(!buildPiArgs({}).includes('--delivery-review'), 'unset stays unset so the config default applies');
});

test('ctrl-y is parsed for accepting self-review offers', () => {
  const keys = [];
  const parse = makeKeyParser(k => keys.push(k));
  parse('\x19');
  assert.equal(keys[0].key, 'ctrl-y');
});

test('ctrl-v is parsed so the console can paste from the OS clipboard', () => {
  const keys = [];
  const parse = makeKeyParser(k => keys.push(k));
  parse('\x16');
  assert.equal(keys[0].key, 'ctrl-v');
});

test('mouse SGR events map to press, drag, release, and wheel keys', () => {
  const keys = [];
  const parse = makeKeyParser(k => keys.push(k));
  parse('\x1b[<0;10;5M');   // left press at col 10, row 5
  parse('\x1b[<32;14;5M');  // left drag to col 14
  parse('\x1b[<0;14;5m');   // release
  parse('\x1b[<64;3;3M');   // wheel up
  assert.deepEqual(keys.map(k => k.key), ['mousedown', 'mousedrag', 'mouseup', 'wheelup']);
  assert.deepEqual({ x: keys[0].x, y: keys[0].y, button: keys[0].button }, { x: 10, y: 5, button: 0 });
  assert.equal(keys[1].button, 0);
  assert.equal(keys[2].x, 14);
  // modifier bits are masked off button but preserved in flags; right-button presses don't masquerade as left
  const more = [];
  const parse2 = makeKeyParser(k => more.push(k));
  parse2('\x1b[<4;1;1M');   // shift+left press → still a left mousedown with shift: true
  parse2('\x1b[<34;2;2M');  // right-button drag → button 2
  assert.equal(more[0].button, 0);
  assert.equal(more[0].shift, true);
  assert.equal(more[1].key, 'mousedrag');
  assert.equal(more[1].button, 2);
});

test('key parser handles cmd/ctrl/alt deletion and backspace sequences', () => {
  const keys = [];
  const parse = makeKeyParser(k => keys.push(k));
  parse('\x1b[3;5~');      // ctrl-delete
  parse('\x1b[3;9~');      // cmd-delete
  parse('\x1b[27;5;127~'); // ctrl-backspace
  parse('\x1b[27;9;127~'); // cmd-backspace
  parse('\x1b[127;8u');    // cmd-backspace (Kitty)
  parse('\x1b\x7f');       // alt-backspace
  parse('\x1b[<16;12;20M'); // ctrl-click (button 0 + ctrl bit 16)
  assert.deepEqual(keys.map(k => k.key), [
    'ctrl-delete',
    'cmd-delete',
    'ctrl-backspace',
    'cmd-delete',
    'cmd-delete',
    'alt-backspace',
    'mousedown'
  ]);
  assert.equal(keys[6].ctrl, true);
  assert.equal(keys[6].button, 0);
});

test('sliceCols and inverseCols handle display-column ranges', () => {
  assert.equal(sliceCols('hello world', 0, 5), 'hello');
  assert.equal(sliceCols('hello world', 6, 11), 'world');
  assert.equal(sliceCols('he世llo', 0, 4), 'he世'); // wide char occupies 2 columns
  const marked = inverseCols('plain text', 0, 5);
  assert.equal(strip(marked), 'plain text');
  assert.match(marked, /\x1b\[7mplain\x1b\[27m/);
  // selection past end of line → inverse padding fills the requested range
  const padded = inverseCols('ab', 0, 8);
  assert.equal(strip(padded), 'ab      ');
  assert.match(padded, /\x1b\[7m {6}\x1b\[27m/);
  // short line inside a mid-selection row starting at column 0
  assert.equal(strip(inverseCols('x', 0, 4)), 'x   ');
  // styled input keeps its escapes and stays unaltered outside the range
  const styled = inverseCols('\x1b[31mred\x1b[0m plain', 4, 9);
  assert.equal(strip(styled), 'red plain');
  assert.match(styled, /\x1b\[27m/);
});

test('matchSlash filters commands by prefix and closes on args', () => {
  // bare '/' matches every command
  assert.ok(matchSlash('/').length >= 16, 'bare slash lists all commands');
  // '/h' narrows to /help
  assert.deepEqual(matchSlash('/h').map(c => c.name), ['/help']);
  // '/r' matches commands and aliases starting with r
  const r = matchSlash('/r').map(c => c.name).sort();
  assert.ok(r.includes('/resume'));
  assert.ok(r.includes('/restart'));
  assert.ok(r.includes('/raw'));
  assert.ok(r.includes('/review'));
  // alias prefix match: '/se' → /sessions (alias of /resume)
  assert.deepEqual(matchSlash('/se').map(c => c.name), ['/resume']);
  // '/q' matches /quit via alias
  assert.deepEqual(matchSlash('/q').map(c => c.name), ['/quit']);
  // '/l' narrows to /login; '/auth' is its alias
  assert.deepEqual(matchSlash('/l').map(c => c.name), ['/login']);
  assert.deepEqual(matchSlash('/auth').map(c => c.name), ['/login']);
  // unknown prefix → empty
  assert.deepEqual(matchSlash('/xyz'), []);
  // a space (args mode) closes the popup
  assert.deepEqual(matchSlash('/help '), []);
  assert.deepEqual(matchSlash('/raw foo'), []);
  // non-slash buffer → empty
  assert.deepEqual(matchSlash('hello'), []);
});

test('slashCardDimensions left justifies the commands card aligned with prompt area', () => {
  const geom80 = slashCardDimensions(80);
  assert.equal(geom80.x0, 2, 'x0 is left-justified to 2 on standard 80-col terminal');
  assert.equal(geom80.cardW, 76);
  assert.equal(geom80.innerW, 74);

  const geom120 = slashCardDimensions(120);
  assert.equal(geom120.x0, 2, 'x0 remains left-justified on wide terminal');
  assert.equal(geom120.cardW, 88, 'card width expands to comfortable cap of 88');
  assert.equal(geom120.innerW, 86);

  const geomTiny = slashCardDimensions(18);
  assert.ok(geomTiny.x0 <= 2);
  assert.equal(geomTiny.cardW, 16);
});

test('renderSlashCard contains all rows strictly within bounding box without overflow', () => {
  const allCommands = matchSlash('/');
  const widths = [40, 64, 80, 100, 120];

  for (const W of widths) {
    const { card, cardW, innerW } = renderSlashCard(allCommands, 0, W);
    for (let i = 0; i < card.length; i++) {
      const line = card[i];
      const stripped = strip(line);
      assert.equal(
        width(line),
        cardW,
        `Row ${i} width (${width(line)}) must exactly match cardW (${cardW}) for W=${W}`
      );
      assert.ok(
        stripped.startsWith('╭') || stripped.startsWith('│') || stripped.startsWith('╰'),
        `Row ${i} should start with box border`
      );
      assert.ok(
        stripped.endsWith('╮') || stripped.endsWith('│') || stripped.endsWith('╯'),
        `Row ${i} should end with box border`
      );
    }
  }
});

// ------------------------------------------------------------------ glyph tier

test('detectGlyphMode honors explicit config and stays conservative on auto', () => {
  assert.equal(detectGlyphMode({ PI2_GLYPHS: 'unicode' }, 'linux'), 'unicode');
  assert.equal(detectGlyphMode({ PI2_GLYPHS: 'ascii' }, 'linux'), 'ascii');
  assert.equal(detectGlyphMode({ PI2_ASCII: '1' }, 'linux'), 'ascii');
  assert.equal(detectGlyphMode({ PI2_ASCII: '0' }, 'linux'), 'unicode');
  // Non-UTF-8 locale or dumb terminal can never carry the symbol set.
  assert.equal(detectGlyphMode({ LC_ALL: 'C' }, 'linux'), 'ascii');
  assert.equal(detectGlyphMode({ TERM: 'dumb', LANG: 'en_US.UTF-8' }, 'linux'), 'ascii');
  // Positive evidence of a modern emulator opts in.
  assert.equal(detectGlyphMode({ LANG: 'en_US.UTF-8', WT_SESSION: '1' }, 'win32'), 'unicode');
  assert.equal(detectGlyphMode({ LANG: 'en_US.UTF-8', TERM: 'xterm-256color', COLORTERM: 'truecolor' }, 'linux'), 'unicode');
  // Unknown console with no marker defaults to ASCII so icons never render as `?`.
  assert.equal(detectGlyphMode({ LANG: 'en_US.UTF-8', TERM: 'xterm-256color' }, 'linux'), 'ascii');
  assert.equal(detectGlyphMode({}, 'win32'), 'ascii');
  assert.equal(resolveGlyphs({ mode: 'ascii' }), ASCII_GLYPHS);
  assert.equal(resolveGlyphs({ mode: 'unicode' }), UNICODE_GLYPHS);
  // `auto` and unknown values must detect, not force the Unicode tier.
  assert.equal(resolveGlyphs({ mode: 'auto', env: { LC_ALL: 'C' }, platform: 'linux' }), ASCII_GLYPHS);
  assert.equal(resolveGlyphs({ mode: 'auto', env: { LANG: 'en_US.UTF-8', WT_SESSION: '1' }, platform: 'win32' }), UNICODE_GLYPHS);
  assert.equal(resolveGlyphs({ ascii: true }), ASCII_GLYPHS);
});

test('the ASCII glyph tier is 100% ASCII', () => {
  const pure = s => [...s].every(ch => ch.codePointAt(0) < 128);
  for (const [k, v] of Object.entries(ASCII_GLYPHS)) {
    if (k === 'box') for (const b of Object.values(v)) assert.ok(pure(b), `box.${k} = ${JSON.stringify(b)}`);
    else if (k === 'spinner') for (const f of v) assert.ok(pure(f), `spinner ${JSON.stringify(f)}`);
    else assert.ok(pure(v), `${k} = ${JSON.stringify(v)}`);
  }
});

test('renderD2 ASCII output contains no non-ASCII bytes', () => {
  const g = parseD2(planD2(SAMPLE_PLAN));
  const states = new Map([['goal', 'done'], ['step0', 'done'], ['step1', 'active'], ['verify', 'fail']]);
  const graph = renderD2(g, { width: 44, theme: getTheme('opencode'), states, frame: 2, glyphs: ASCII_GLYPHS }).lines.join('\n');
  assert.ok([...strip(graph)].every(ch => ch.codePointAt(0) < 128), 'ascii graph is pure ASCII');
});

// ------------------------------------------------------------------ step states

const STEP_PLAN = {
  goal: 'Build a task CLI',
  steps: ['slice', 'persist', 'tests'],
  checks: [{ id: 't', kind: 'test', argv: ['node', 'x'], timeoutSeconds: 5 }],
  acceptance: [{ requirement: 'works', checks: ['t'] }],
};

test('computeNodeStates marks exactly one step active while implementing', () => {
  const actives = states => STEP_PLAN.steps.map((_, i) => states.get(`step${i}`)).filter(s => s === 'active');
  // Fresh plan: first step current, the rest pending — never the whole plan.
  const fresh = computeNodeStates({ status: 'implementing', plan: STEP_PLAN, evidence: {}, stepStatus: {} }, false, null, 'h').states;
  assert.equal(actives(fresh).length, 1);
  assert.equal(fresh.get('step0'), 'active');
  assert.equal(fresh.get('step1'), 'pending');
  assert.equal(fresh.get('step2'), 'pending');
  // Explicit done advances the current step.
  const mid = computeNodeStates({ status: 'implementing', plan: STEP_PLAN, evidence: {}, stepStatus: { step0: 'done' } }, false, null, 'h').states;
  assert.equal(actives(mid).length, 1);
  assert.equal(mid.get('step0'), 'done');
  assert.equal(mid.get('step1'), 'active');
  assert.equal(mid.get('step2'), 'pending');
  // An explicit active step wins even if earlier steps were never marked.
  const jumped = computeNodeStates({ status: 'implementing', plan: STEP_PLAN, evidence: {}, stepStatus: { step2: 'active' } }, false, null, 'h').states;
  assert.equal(actives(jumped).length, 1);
  assert.equal(jumped.get('step2'), 'active');
  assert.equal(jumped.get('step0'), 'done');
  assert.equal(jumped.get('step1'), 'done');
  // Finished runs light no step as active.
  const done = computeNodeStates({ status: 'verified', plan: STEP_PLAN, evidence: {}, stepStatus: {} }, false, null, 'h').states;
  assert.equal(actives(done).length, 0);
});

// ------------------------------------------------------------------ scrollbars

test('barRange maps a viewport onto the track and hides when content fits', () => {
  assert.equal(barRange(10, 10, 0), null);
  assert.equal(barRange(10, 5, 0), null);
  // Half the content visible → half-height thumb at the top.
  assert.deepEqual(barRange(10, 20, 0), { pos: 0, len: 5 });
  // Scrolled to the bottom → thumb flush with the bottom.
  assert.deepEqual(barRange(10, 20, 10), { pos: 5, len: 5 });
  // A viewport smaller than a cell still yields a one-cell thumb.
  assert.deepEqual(barRange(2, 8, 0), { pos: 0, len: 1 });
  // Out-of-range starts clamp instead of spilling past the track.
  assert.deepEqual(barRange(10, 20, 999), { pos: 5, len: 5 });
});

test('scrollCell uses the theme palette and the resolved glyph tier', () => {
  const t = getTheme('opencode');
  const thumb = scrollCell(UNICODE_GLYPHS, 'thumb', true, t);
  const track = scrollCell(ASCII_GLYPHS, 'track', false, t);
  assert.match(thumb, /\u2503/, 'unicode thumb is the heavy bar');
  assert.match(track, /\|/, 'ascii track is a pipe');
  // Foreground only: the pane paints the surface background, so no baked bg.
  assert.ok(!/\x1b\[48;/.test(thumb) && !/\x1b\[48;/.test(track));
  assert.equal(scrollCell(UNICODE_GLYPHS, null, true, t), ' ', 'no bar when nothing scrolls');
});
