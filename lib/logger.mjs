import { appendFileSync } from 'node:fs';

const LOG_LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40, silent: 100 });
const BREADCRUMB_LIMIT = 50;
const MAX_DEPTH = 4;
const MAX_STRING = 2000;
const REDACTED = '[REDACTED]';
const SECRET_KEY_PARTS = ['authorization', 'token', 'apikey', 'password', 'passwd', 'secret', 'cookie', 'refresh', 'access', 'credential', 'privatekey'];
const SECRET_PATTERNS = [
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]'],
  [/\bsk-[A-Za-z0-9_-]{6,}/g, 'sk-[REDACTED]'],
  [/\b(gh[pousr]_|github_pat_)[A-Za-z0-9_]{10,}/g, '$1[REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, '[REDACTED_JWT]'],
  [/([?&#](?:access_token|refresh_token|token|key|api_key|apikey|code|signature|sig)=)[^&#\s]+/gi, '$1[REDACTED]'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1[REDACTED]@'],
];

const breadcrumbs = [];
let rootConfig = null;

function envLevel(env, defaultLevel) {
  const requested = String(env.CTG_LOG_LEVEL ?? '')
    .trim()
    .toLowerCase();
  if (requested in LOG_LEVELS) return requested;
  if (/^(1|true|yes|on|debug)$/i.test(String(env.CARTHAGENT_DEBUG ?? '').trim())) return 'debug';
  return defaultLevel;
}

/** Resolve logging settings from CTG_LOG_LEVEL, CTG_LOG_FORMAT, CTG_LOG_FILE and CARTHAGENT_DEBUG. */
export function resolveLogConfig(env = process.env, { defaultLevel = 'warn' } = {}) {
  const format = String(env.CTG_LOG_FORMAT ?? '').toLowerCase() === 'json' ? 'json' : 'pretty';
  const file = typeof env.CTG_LOG_FILE === 'string' && env.CTG_LOG_FILE.trim() ? env.CTG_LOG_FILE.trim() : null;
  return { level: envLevel(env, defaultLevel), format, file };
}

/**
 * Reconfigure the process-wide sink. Loggers read this at write time, so a
 * process (such as the dashboard server) may change its default level after
 * library modules have already created their loggers.
 */
export function configureLogging({ env = process.env, defaultLevel = 'warn', stream, now } = {}) {
  rootConfig = { ...resolveLogConfig(env, { defaultLevel }), stream: stream ?? process.stderr, now: now ?? (() => new Date()) };
  return rootConfig;
}

function config() {
  return rootConfig ?? configureLogging();
}

function secretKey(key) {
  const normalized = String(key)
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  return SECRET_KEY_PARTS.some(part => normalized.includes(part));
}

/** Remove bearer/API-key/JWT/URL-credential shaped substrings from free text. */
export function redactString(value) {
  let text = String(value);
  for (const [pattern, replacement] of SECRET_PATTERNS) text = text.replace(pattern, replacement);
  return text.length > MAX_STRING ? `${text.slice(0, MAX_STRING)}…` : text;
}

function serializeError(error, depth, seen) {
  const out = { name: redactString(error.name || 'Error'), message: redactString(error.message ?? '') };
  if (error.code !== undefined) out.code = redactString(error.code);
  if (error.status !== undefined) out.status = error.status;
  if (error.cause !== undefined && depth < MAX_DEPTH) out.cause = redactValue(error.cause, depth + 1, seen);
  return out;
}

function redactObject(value, depth, seen) {
  if (Array.isArray(value)) return value.slice(0, 50).map(item => redactValue(item, depth + 1, seen));
  const out = {};
  for (const [key, item] of Object.entries(value)) out[key] = secretKey(key) ? REDACTED : redactValue(item, depth + 1, seen);
  return out;
}

/** Deep-copy a value with secret-named keys and secret-shaped strings replaced. */
export function redactValue(value, depth = 0, seen = new WeakSet()) {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return typeof value === 'bigint' || typeof value === 'symbol' ? String(value) : value;
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Truncated]';
  seen.add(value);
  if (value instanceof Error) return serializeError(value, depth, seen);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof URL) return redactString(value.href);
  return redactObject(value, depth, seen);
}

function prettyValue(value) {
  if (typeof value === 'string') return /[\s"=]/.test(value) ? JSON.stringify(value) : value;
  return JSON.stringify(value);
}

function formatPretty(entry) {
  const { time, level, component, msg, ...fields } = entry;
  const extras = Object.entries(fields).map(([key, value]) => `${key}=${prettyValue(value)}`);
  return [time, level.toUpperCase().padEnd(5), component ? `[${component}]` : '', msg, ...extras].filter(Boolean).join(' ');
}

function remember(entry) {
  breadcrumbs.push(entry);
  if (breadcrumbs.length > BREADCRUMB_LIMIT) breadcrumbs.splice(0, breadcrumbs.length - BREADCRUMB_LIMIT);
}

function write(sink, entry) {
  try {
    if (sink.file) {
      appendFileSync(sink.file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
      return;
    }
    sink.stream.write(`${sink.format === 'json' ? JSON.stringify(entry) : formatPretty(entry)}\n`);
  } catch {
    /* logging must never break the caller */
  }
}

function emit(context, level, msg, fields) {
  const sink = config();
  const entry = { time: sink.now().toISOString(), level, ...redactValue(context), msg: redactString(msg), ...redactValue(fields ?? {}) };
  remember(entry);
  if (LOG_LEVELS[level] >= LOG_LEVELS[sink.level]) write(sink, entry);
}

/**
 * Structured logger. Output goes to stderr (pretty text or JSON lines) or, when
 * CTG_LOG_FILE is set, only to that file; never to stdout, which carries CLI
 * output and JSONL protocols. Every event, including ones below the configured
 * level, is kept in a bounded breadcrumb buffer for crash reports.
 */
export function createLogger(context = {}) {
  const bound = { ...context };
  const at = level => (msg, fields) => emit(bound, level, msg, fields);
  return Object.freeze({
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    enabled: level => LOG_LEVELS[level] >= LOG_LEVELS[config().level],
    child: extra => createLogger({ ...bound, ...extra }),
  });
}

export const getLogger = component => createLogger({ component });

/** A copy of the most recent log events (newest last), already redacted. */
export function getBreadcrumbs() {
  return breadcrumbs.map(entry => ({ ...entry }));
}

export function clearBreadcrumbs() {
  breadcrumbs.length = 0;
}
