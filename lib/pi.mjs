/**
 * Locating the agent CLI + building its argument list — shared by the console
 * (bin/pi2.mjs, lib/tui/app.mjs) and the evaluation runner (evaluate.mjs).
 * pi2 uses a baked-in agent engine in vendor/agent and an isolated state directory
 * (~/.pi2/agent) to ensure it runs completely fresh without piggybacking on any
 * host pi installation.
 */
import { existsSync, readFileSync, realpathSync, readdirSync, statSync, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { join, dirname, resolve, delimiter, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { validateBudgetOptions } from './budget.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Ensure an isolated state directory (~/.pi2/agent) by default:
const DEFAULT_AGENT_DIR = process.env.PI2_AGENT_DIR || process.env.PI2_CODING_AGENT_DIR || join(os.homedir(), '.pi2', 'agent');
if (!process.env.PI2_CODING_AGENT_DIR && !process.env.PI2_AGENT_DIR) {
  process.env.PI2_CODING_AGENT_DIR = DEFAULT_AGENT_DIR;
}
if (!process.env.PI_CODING_AGENT_DIR) {
  process.env.PI_CODING_AGENT_DIR = process.env.PI2_CODING_AGENT_DIR || DEFAULT_AGENT_DIR;
}

export function locatePi(explicit) {
  const candidates = [explicit, process.env.PI2_CLI, process.env.PI_CLI].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return { cmd: process.execPath, args: [c] };
  }

  // Self-contained baked-in agent engine inside the package.
  const baked = join(ROOT, 'vendor', 'agent', 'cli.js');
  if (existsSync(baked)) return { cmd: process.execPath, args: [baked] };

  throw new Error('Cannot find the baked-in agent engine in vendor/agent/cli.js — pass --agent-cli /path/to/cli.js');
}

/** Build agent CLI args for both the TUI (rpc) and headless (-p) paths. */
export function buildPiArgs(opts) {
  validateBudgetOptions(opts);
  const args = [];
  if (opts.provider) args.push('--provider', opts.provider);
  if (opts.model) args.push('--model', opts.model);
  if (opts.thinking) args.push('--thinking', opts.thinking);
  // Session selection: --session <path|id> or --continue for the most recent.
  // (--resume is intentionally not forwarded — agent picker is interactive.)
  if (opts.session) args.push('--session', opts.session);
  else if (opts.continue) args.push('--continue');
  if (opts.isolate) args.push('--no-extensions', '--no-skills', '--no-prompt-templates');
  if (opts.delivery !== false) {
    args.push('-e', join(ROOT, 'extensions', 'delivery.ts'),
      '--skill', join(ROOT, 'skills'),
      '--prompt-template', join(ROOT, 'prompts'));
    if (opts.strict !== false) args.push('--delivery-strict');
    if (opts.validators) args.push('--delivery-validators', resolve(opts.cwd || process.cwd(), opts.validators));
    if (opts.context) args.push('--delivery-context', resolve(opts.cwd || process.cwd(), opts.context));
    for (const [key, flag] of [['maxTools', 'tools'], ['maxSeconds', 'seconds'], ['maxRepairs', 'repairs']]) {
      if (opts[key] !== undefined) args.push(`--delivery-max-${flag}`, String(opts[key]));
    }
    if (opts.bashCap) args.push('--delivery-bash-cap', String(opts.bashCap));
    // Review is orchestrated by the console, not an engine extension flag.
    // Forwarding --delivery-review makes the bundled engine reject startup.
  }
  return args;
}

// ------------------------------------------------------------- session files

/** pi2's per-cwd session dir: <agentDir>/sessions/--a-b-c--/. Defaults to ~/.pi2/agent. */
export function sessionDirFor(cwd = process.cwd(), agentDir = process.env.PI2_AGENT_DIR || process.env.PI2_CODING_AGENT_DIR || process.env.PI_CODING_AGENT_DIR || join(os.homedir(), '.pi2', 'agent')) {
  const safe = `--${resolve(cwd).replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
  return join(agentDir, 'sessions', safe);
}

function textOfContent(content) {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : '';
  return content.filter(c => c?.type === 'text').map(c => c.text).join('\n');
}

/** Read bounded metadata from one session file: header, latest name, first user message. */
function readSessionMeta(path, mtime) {
  const meta = { path, id: basename(path, '.jsonl').split('_').pop() || '', name: null, created: null, modified: mtime, messageCount: 0, firstMessage: '' };
  let fd;
  try {
    fd = openSync(path, 'r');
    const size = Math.min(4 * 1024 * 1024, fstatSync(fd).size);
    const buf = Buffer.alloc(size);
    readSync(fd, buf, 0, size, 0);
    for (const line of buf.toString('utf8').split('\n')) {
      if (!line) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.type === 'session') { meta.id = e.id || meta.id; meta.created = e.timestamp || null; }
      else if (e.type === 'session_info' && typeof e.name === 'string' && e.name.trim()) meta.name = e.name.trim();
      else if (e.type === 'message') {
        meta.messageCount++;
        if (!meta.firstMessage && e.message?.role === 'user') {
          const t = textOfContent(e.message.content).replace(/\s+/g, ' ').trim();
          if (t) meta.firstMessage = t.slice(0, 200);
        }
      }
    }
  } catch { /* corrupt/partial file — return what we have */ }
  finally { try { if (fd !== undefined) closeSync(fd); } catch { } }
  return meta;
}

/** Sessions stored for a cwd, newest first. `dir` overrides discovery (tests). */
export function listSessions(cwd = process.cwd(), { limit = 80, dir = sessionDirFor(cwd) } = {}) {
  let files;
  try { files = readdirSync(dir).filter(f => f.endsWith('.jsonl')); } catch { return []; }
  const rows = [];
  for (const f of files) {
    const path = join(dir, f);
    try { rows.push({ path, mtime: statSync(path).mtimeMs }); } catch { }
  }
  rows.sort((a, b) => b.mtime - a.mtime);
  return rows.slice(0, limit).map(r => readSessionMeta(r.path, r.mtime));
}

/** Newest session file for a cwd, or null. */
export function mostRecentSession(cwd = process.cwd(), dir) {
  return listSessions(cwd, { limit: 1, dir })[0]?.path || null;
}
