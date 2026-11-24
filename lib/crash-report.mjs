import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBreadcrumbs, redactString, redactValue } from './logger.mjs';
import { shipAgentDir } from './ship-auth.mjs';

const CRASH_REPORT_SCHEMA = 1;
export const MAX_CRASH_REPORTS = 20;
const MAX_REPORTS_PER_PROCESS = 3;
const FINGERPRINT_FRAMES = 5;
const ISSUE_URL = 'https://github.com/B-icy/Carthagent/issues/new';
const MAX_ISSUE_URL = 1800;
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAFE_FLAG = /^--?[a-z][a-z0-9-]{0,39}$/;
const REPORT_FILE = /^crash-.+\.json$/;

export const crashLogDir = (env = process.env) => join(shipAgentDir(env), 'logs');

function homeAware(text, home) {
  const value = String(text ?? '');
  if (!home || home.length < 2) return value;
  return value.split(home).join('~');
}

function scrubHome(value, home) {
  if (typeof value === 'string') return homeAware(value, home);
  if (Array.isArray(value)) return value.map(item => scrubHome(item, home));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubHome(item, home)]));
  return value;
}

/**
 * Reduce argv to the subcommand and flag names. Flag values, positional task
 * text and anything after `--` are dropped.
 */
export function sanitizeArgv(argv = [], { isCommand = () => false, aliases = {} } = {}) {
  const args = argv.indexOf('--') === -1 ? argv : argv.slice(0, argv.indexOf('--'));
  const first = String(args[0] ?? '');
  const normalized = Object.hasOwn(aliases, first) ? aliases[first] : first;
  let command = null;
  if (!first) command = 'tui';
  else if (!first.startsWith('-') && isCommand(normalized)) command = normalized;
  else if (!first.startsWith('-')) command = '<task>';
  const flags = args
    .map(String)
    .filter(arg => arg.startsWith('-'))
    .map(arg => arg.split('=')[0])
    .map(flag => (SAFE_FLAG.test(flag) ? flag : '<flag>'));
  return { name: command, flags: [...new Set(flags)] };
}

export const formatCommand = command =>
  ['ctg', command?.name && command.name !== 'tui' ? command.name : '', ...(command?.flags ?? [])].filter(Boolean).join(' ');

function normalizeFrame(line) {
  const location = line.match(/\(?((?:file:\/\/|node:)?[^\s()]+?)(?::\d+){1,2}\)?$/);
  const fn = line
    .replace(/^\s*at\s+/, '')
    .replace(/\s*\(?(?:file:\/\/|node:)?[^\s()]+?(?::\d+){1,2}\)?$/, '')
    .trim();
  let file = location ? location[1].replace(/^file:\/\//, '').replace(/[?#].*$/, '') : '';
  file = file.replaceAll('\\', '/');
  const modules = file.lastIndexOf('/node_modules/');
  if (modules !== -1) file = file.slice(modules + '/node_modules/'.length);
  else if (file.startsWith(PACKAGE_ROOT.replaceAll(sep, '/'))) file = relative(PACKAGE_ROOT, file).replaceAll(sep, '/');
  else if (!file.startsWith('node:')) file = file.split('/').pop();
  return `${fn || '<anonymous>'}@${file}`;
}

/** Short stable id: error name plus the top stack frames without line numbers or machine paths. */
export function crashFingerprint(error) {
  const name = error?.name || typeof error;
  const frames = String(error?.stack ?? '')
    .split('\n')
    .filter(line => /^\s*at\s/.test(line))
    .slice(0, FINGERPRINT_FRAMES)
    .map(normalizeFrame);
  const basis = frames.length ? frames : [String(error?.message ?? error).replace(/\d+/g, 'N')];
  return createHash('sha256')
    .update([name, ...basis].join('\n'))
    .digest('hex')
    .slice(0, 12);
}

function asError(value) {
  if (value instanceof Error) return value;
  if (value && typeof value === 'object') return { name: value.name || 'NonError', message: String(value.message ?? JSON.stringify(redactValue(value))) };
  return { name: 'NonError', message: String(value) };
}

function installMethod() {
  try {
    return existsSync(join(PACKAGE_ROOT, '.git')) ? 'clone' : 'npm';
  } catch {
    return 'unknown';
  }
}

function packageVersion() {
  try {
    return JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version;
  } catch {
    return 'unknown';
  }
}

/** Build a redacted crash report. Never includes prompt text, flag values, env or file contents. */
export function buildCrashReport({
  error,
  origin = 'uncaughtException',
  argv = [],
  cli = {},
  version,
  now = new Date(),
  home = os.homedir(),
  breadcrumbs = getBreadcrumbs(),
}) {
  const err = asError(error);
  const clean = text => homeAware(redactString(text), home);
  return {
    schema: CRASH_REPORT_SCHEMA,
    timestamp: now.toISOString(),
    fingerprint: crashFingerprint(err),
    origin,
    ctg: { version: version ?? packageVersion(), installMethod: installMethod() },
    runtime: { node: process.version, platform: process.platform, arch: process.arch, osRelease: os.release() },
    command: sanitizeArgv(argv, cli),
    error: {
      name: clean(err.name || 'Error'),
      message: clean(err.message ?? ''),
      ...(err.code !== undefined ? { code: clean(err.code) } : {}),
      stack: clean(err.stack ?? ''),
    },
    breadcrumbs: breadcrumbs.map(entry => scrubHome(redactValue(entry), home)),
  };
}

function reportFiles(dir) {
  try {
    return readdirSync(dir)
      .filter(name => REPORT_FILE.test(name))
      .sort();
  } catch {
    return [];
  }
}

/** Delete all but the newest `keep` crash reports. Returns the removed paths. */
export function pruneCrashReports(dir, keep = MAX_CRASH_REPORTS) {
  const files = reportFiles(dir);
  const removed = [];
  for (const name of files.slice(0, Math.max(0, files.length - keep))) {
    try {
      rmSync(join(dir, name), { force: true });
      removed.push(join(dir, name));
    } catch {
      /* retention is best-effort */
    }
  }
  return removed;
}

/** Write the report (mode 0600) and apply retention. Returns the path, or null when it could not be written. */
export function writeCrashReport(report, { dir = crashLogDir(), keep = MAX_CRASH_REPORTS } = {}) {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stamp = report.timestamp.replace(/[:.]/g, '-');
    const file = join(dir, `crash-${stamp}-${report.fingerprint}-${randomBytes(2).toString('hex')}.json`);
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    chmodSync(file, 0o600);
    pruneCrashReports(dir, keep);
    return file;
  } catch {
    return null;
  }
}

/** The newest readable crash report as `{ path, report }`, or null. */
export function latestCrashReport(dir = crashLogDir()) {
  for (const name of reportFiles(dir).reverse()) {
    try {
      const report = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (report?.schema === CRASH_REPORT_SCHEMA) return { path: join(dir, name), report };
    } catch {
      /* skip unreadable reports */
    }
  }
  return null;
}

function issueReportText(report) {
  const frames = String(report.error?.stack ?? '')
    .split('\n')
    .filter(line => /^\s*at\s/.test(line))
    .slice(0, 8);
  const crumbs = (report.breadcrumbs ?? []).slice(-5).map(entry => `${entry.time} ${entry.level} ${entry.component ?? ''} ${entry.msg}`.replace(/\s+/g, ' '));
  return [`${report.error?.name}: ${report.error?.message}`, ...frames, '', `origin: ${report.origin}`, ...crumbs].join('\n');
}

/** Prefilled crash_report.yml issue URL, with the report excerpt truncated to keep the URL short. */
export function crashIssueUrl(report, maxLength = MAX_ISSUE_URL) {
  const params = new URLSearchParams({
    template: 'crash_report.yml',
    fingerprint: report.fingerprint,
    version: `ctg ${report.ctg?.version} (node ${report.runtime?.node}, ${report.runtime?.platform}-${report.runtime?.arch}, ${report.ctg?.installMethod})`,
    command: formatCommand(report.command),
  });
  const base = `${ISSUE_URL}?${params}`;
  const budget = maxLength - base.length - '&report='.length;
  let excerpt = issueReportText(report);
  while (excerpt && encodeURIComponent(excerpt).length > budget) {
    const chars = [...excerpt];
    excerpt = chars.slice(0, Math.floor(chars.length * 0.9)).join('');
  }
  return excerpt ? `${base}&report=${encodeURIComponent(excerpt)}` : base;
}

/**
 * Record uncaught exceptions and unhandled rejections without changing Node's
 * default handling: `uncaughtExceptionMonitor` observes both (rejections are
 * raised as uncaught exceptions under the default `--unhandled-rejections`
 * mode), so the printed error and exit code stay exactly as before.
 */
export function installCrashHandlers({ argv = [], cli, version, env = process.env, stderr = process.stderr, target = process } = {}) {
  if (/^(0|false|off|no)$/i.test(String(env.CTG_CRASH_REPORTS ?? ''))) return () => {};
  let written = 0;
  const monitor = (error, origin) => {
    try {
      if (written >= MAX_REPORTS_PER_PROCESS) return;
      written++;
      const file = writeCrashReport(buildCrashReport({ error, origin, argv, cli, version }), { dir: crashLogDir(env) });
      if (file) stderr.write(`Crash report saved: ${file} — run \`ctg doctor\` for details\n`);
    } catch {
      /* crash reporting must never throw or block exit */
    }
  };
  target.on('uncaughtExceptionMonitor', monitor);
  return () => target.off('uncaughtExceptionMonitor', monitor);
}
