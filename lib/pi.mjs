/**
 * Locating the pi CLI + building its argument list — shared by the console
 * (bin/pi2.mjs, lib/tui/app.mjs) and the evaluation runner (evaluate.mjs).
 */
import { existsSync, readFileSync, realpathSync, readdirSync, statSync, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { join, dirname, resolve, delimiter, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function which(bin) {
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    for (const ext of exts) {
      const p = join(dir, bin + ext);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

export function locatePi(explicit) {
  const candidates = [explicit, process.env.PI2_CLI, process.env.PI_CLI].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return { cmd: process.execPath, args: [c] };
  }
  const pi = which('pi');
  if (pi) {
    let real = pi;
    try { real = realpathSync(pi); } catch { /* keep link path */ }
    // Shell wrappers (pi.cmd/pi.bat on Windows, non-js shims) can't run under
    // `node` — only use a PATH hit when it resolves to a JS entry point;
    // otherwise fall through to the node_modules lookup below.
    if (/\.(js|mjs|cjs)$/.test(real)) return { cmd: process.execPath, args: [real] };
    if (process.platform !== 'win32' && !/\.(cmd|bat|ps1)$/i.test(real)) {
      // POSIX `pi` could be a standalone binary — spawn it directly
      return { cmd: pi, args: [] };
    }
  }
  // last resort: sibling global node_modules layouts
  const dirs = new Set([dirname(process.execPath)]);
  try { dirs.add(dirname(realpathSync(process.execPath))); } catch { /* keep exec dir only */ }
  for (const dir of dirs) {
    for (const rel of ['node_modules', join('..', 'lib', 'node_modules')]) {
      for (const entry of ['dist/cli.js', join('dist', 'bundle', 'cli.js')]) {
        const p = join(dir, rel, '@earendil-works', 'pi-coding-agent', entry);
        if (existsSync(p)) return { cmd: process.execPath, args: [p] };
      }
    }
  }
  throw new Error('Cannot find the pi CLI. Install @earendil-works/pi-coding-agent or pass --pi-cli /path/to/cli.js');
}

/** Build pi CLI args for both the TUI (rpc) and headless (-p) paths. */
export function buildPiArgs(opts, { installed = packageInstalled() } = {}) {
  const args = [];
  if (opts.provider) args.push('--provider', opts.provider);
  if (opts.model) args.push('--model', opts.model);
  if (opts.thinking) args.push('--thinking', opts.thinking);
  // Session selection: --session <path|id> or --continue for the most recent.
  // (--resume is intentionally not forwarded — pi's picker is interactive.)
  if (opts.session) args.push('--session', opts.session);
  else if (opts.continue) args.push('--continue');
  if (opts.isolate) args.push('--no-extensions', '--no-skills', '--no-prompt-templates');
  if (opts.delivery !== false) {
    if (!installed || opts.isolate) {
      args.push('-e', join(ROOT, 'extensions', 'delivery.ts'),
        '--skill', join(ROOT, 'skills'),
        '--prompt-template', join(ROOT, 'prompts'));
    }
    if (opts.strict !== false) args.push('--delivery-strict');
    if (opts.validators) args.push('--delivery-validators', resolve(opts.cwd || process.cwd(), opts.validators));
    if (opts.context) args.push('--delivery-context', resolve(opts.cwd || process.cwd(), opts.context));
    if (opts.bashCap) args.push('--delivery-bash-cap', String(opts.bashCap));
  }
  return args;
}

// ------------------------------------------------------------- session files

/** pi's per-cwd session dir: <agentDir>/sessions/--a-b-c--/ — mirrors pi's encoding. */
export function sessionDirFor(cwd = process.cwd(), agentDir = process.env.PI_CODING_AGENT_DIR || join(os.homedir(), '.pi', 'agent')) {
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

/** True when pi2 is already installed as a pi package (resources auto-load). */
export function packageInstalled() {
  try {
    const dir = process.env.PI_CODING_AGENT_DIR || join(os.homedir(), '.pi', 'agent');
    const settings = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
    const rootReal = realpathSync(ROOT);
    return (settings.packages || []).some(p => {
      const r = resolve(dir, p);
      try { return realpathSync(r) === rootReal; } catch { return r === ROOT; }
    });
  } catch { return false; }
}
