import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCrashReport,
  crashFingerprint,
  crashIssueUrl,
  formatCommand,
  installCrashHandlers,
  latestCrashReport,
  MAX_CRASH_REPORTS,
  pruneCrashReports,
  sanitizeArgv,
  writeCrashReport,
} from '../lib/crash-report.mjs';

const cli = { isCommand: name => ['doctor', 'update', 'review', 'tui', 'serve'].includes(name), aliases: { upgrade: 'update', web: 'serve' } };
const ctg = fileURLToPath(new URL('../bin/ctg.mjs', import.meta.url));
const crashModule = new URL('../lib/crash-report.mjs', import.meta.url).href;

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ctg-crash-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function stackError(name, message, frames) {
  const error = new Error(message);
  error.name = name;
  error.stack = [`${name}: ${message}`, ...frames.map(frame => `    at ${frame}`)].join('\n');
  return error;
}

test('argv keeps the subcommand and flag names only', () => {
  assert.deepEqual(sanitizeArgv(['update', '--channel', 'beta', '--check'], cli), { name: 'update', flags: ['--channel', '--check'] });
  assert.deepEqual(sanitizeArgv(['upgrade', '--channel=beta'], cli), { name: 'update', flags: ['--channel'] });
  assert.deepEqual(sanitizeArgv(['fix', 'the', 'login', 'bug', 'with', 'password', 'hunter2'], cli), { name: '<task>', flags: [] });
  assert.deepEqual(sanitizeArgv(['--model', 'sk-secret-value', 'my prompt'], cli), { name: null, flags: ['--model'] });
  assert.deepEqual(sanitizeArgv(['review', '--', '--secret-flag', 'prompt'], cli), { name: 'review', flags: [] });
  assert.deepEqual(sanitizeArgv(['-p', '--Weird_Flag!', `--${'x'.repeat(60)}`], cli), { name: null, flags: ['-p', '<flag>'] });
  assert.deepEqual(sanitizeArgv([], cli), { name: 'tui', flags: [] });
  assert.equal(formatCommand(sanitizeArgv(['update', '--check'], cli)), 'ctg update --check');
  assert.equal(formatCommand(sanitizeArgv([], cli)), 'ctg');
});

test('reports redact secrets, replace the home directory, and omit argv values', () => {
  const home = homedir();
  const error = stackError('TypeError', `cannot read token Bearer abc.def.ghi in ${home}/project/sk-abcdefghijkl`, [`run (${home}/app/lib/a.mjs:1:2)`]);
  const report = buildCrashReport({
    error,
    argv: ['update', '--channel', 'my-private-value'],
    cli,
    version: '9.9.9',
    now: new Date('2026-01-02T00:00:00Z'),
    breadcrumbs: [{ time: 't', level: 'debug', msg: `read ${home}/x`, authorization: 'Bearer leaked' }],
  });
  const serialized = JSON.stringify(report);
  assert.equal(report.schema, 1);
  assert.equal(report.timestamp, '2026-01-02T00:00:00.000Z');
  assert.equal(report.ctg.version, '9.9.9');
  assert.ok(['clone', 'npm', 'unknown'].includes(report.ctg.installMethod));
  assert.deepEqual(Object.keys(report.runtime).sort(), ['arch', 'node', 'osRelease', 'platform']);
  assert.deepEqual(report.command, { name: 'update', flags: ['--channel'] });
  assert.equal(report.error.name, 'TypeError');
  assert.match(report.error.message, /Bearer \[REDACTED\] in ~\/project\/sk-\[REDACTED\]/);
  assert.match(report.error.stack, /\(~\/app\/lib\/a\.mjs:1:2\)/);
  assert.equal(report.breadcrumbs[0].authorization, '[REDACTED]');
  assert.equal(report.breadcrumbs[0].msg, 'read ~/x');
  for (const leaked of ['abc.def.ghi', 'my-private-value', 'leaked', `${home}/`]) assert.equal(serialized.includes(leaked), false, leaked);
  assert.match(report.fingerprint, /^[0-9a-f]{12}$/);
});

test('non-Error rejections still produce a report', () => {
  assert.equal(buildCrashReport({ error: 'plain string', origin: 'unhandledRejection' }).error.message, 'plain string');
  assert.equal(buildCrashReport({ error: { message: 'object', password: 'x' } }).error.message, 'object');
  assert.match(buildCrashReport({ error: { password: 'hunter2' } }).error.message, /REDACTED/);
});

test('fingerprints ignore messages, line numbers and machine paths but not code location', () => {
  const a = stackError('TypeError', 'id 1 failed', ['resolve (/home/a/carthagent/lib/x.mjs:10:5)', 'async main (file:///home/a/bin/ctg.mjs:3:1)']);
  const b = stackError('TypeError', 'id 2 failed', ['resolve (/Users/b/other/lib/x.mjs:99:1)', 'async main (file:///Users/b/bin/ctg.mjs:4:9)']);
  const c = stackError('TypeError', 'id 1 failed', ['parse (/home/a/carthagent/lib/x.mjs:10:5)', 'async main (file:///home/a/bin/ctg.mjs:3:1)']);
  const d = stackError('RangeError', 'id 1 failed', ['resolve (/home/a/carthagent/lib/x.mjs:10:5)', 'async main (file:///home/a/bin/ctg.mjs:3:1)']);
  const e = stackError('TypeError', 'x', ['f (C:\\Users\\c\\AppData\\npm\\node_modules\\carthagent\\lib\\x.mjs:1:1)']);
  const f = stackError('TypeError', 'y', ['f (/usr/lib/node_modules/carthagent/lib/x.mjs:7:7)']);
  assert.equal(crashFingerprint(a), crashFingerprint(b));
  assert.notEqual(crashFingerprint(a), crashFingerprint(c));
  assert.notEqual(crashFingerprint(a), crashFingerprint(d));
  assert.equal(crashFingerprint(e), crashFingerprint(f));
  assert.equal(crashFingerprint(a), crashFingerprint(a));
});

test('reports are private files, newest 20 are kept, and the newest is found', t => {
  const dir = tempDir(t);
  const paths = [];
  for (let i = 0; i < MAX_CRASH_REPORTS + 5; i++) {
    const report = buildCrashReport({ error: new Error(`n${i}`), now: new Date(Date.UTC(2026, 0, 1, 0, 0, i)), breadcrumbs: [] });
    paths.push(writeCrashReport(report, { dir }));
  }
  assert.ok(paths.every(Boolean));
  const files = readdirSync(dir).sort();
  assert.equal(files.length, MAX_CRASH_REPORTS);
  assert.ok(files.every(name => /^crash-2026-01-01T00-00-\d\d-000Z-[0-9a-f]{12}-[0-9a-f]{4}\.json$/.test(name)));
  if (process.platform !== 'win32') assert.equal(statSync(paths.at(-1)).mode & 0o777, 0o600);
  assert.equal(latestCrashReport(dir).report.error.message, `n${MAX_CRASH_REPORTS + 4}`);
  assert.equal(latestCrashReport(dir).path, paths.at(-1));
  writeFileSync(join(dir, 'crash-9999-corrupt.json'), '{');
  assert.equal(latestCrashReport(dir).path, paths.at(-1));
  writeFileSync(join(dir, 'unrelated.json'), '{}');
  assert.equal(pruneCrashReports(dir, 1).length, MAX_CRASH_REPORTS);
  assert.deepEqual(readdirSync(dir).sort(), ['crash-9999-corrupt.json', 'unrelated.json']);
  assert.equal(latestCrashReport(join(dir, 'missing')), null);
});

test('an unwritable crash directory never throws and prints no pointer', t => {
  const dir = tempDir(t);
  const blocker = join(dir, 'file');
  writeFileSync(blocker, '');
  const report = buildCrashReport({ error: new Error('x'), breadcrumbs: [] });
  assert.equal(writeCrashReport(report, { dir: join(blocker, 'logs') }), null);

  const target = new EventEmitter();
  const output = [];
  installCrashHandlers({ env: { CARTHAGENT_CODING_AGENT_DIR: blocker }, stderr: { write: line => output.push(line) }, target });
  assert.doesNotThrow(() => target.emit('uncaughtExceptionMonitor', new Error('boom'), 'uncaughtException'));
  assert.deepEqual(output, []);
});

test('the monitor records at most three reports per process and can be disabled', t => {
  const dir = tempDir(t);
  const target = new EventEmitter();
  const output = [];
  const uninstall = installCrashHandlers({
    argv: ['doctor'],
    cli,
    env: { CARTHAGENT_CODING_AGENT_DIR: dir },
    stderr: { write: line => output.push(line) },
    target,
  });
  for (let i = 0; i < 5; i++) target.emit('uncaughtExceptionMonitor', new Error(`boom ${i}`), 'unhandledRejection');
  assert.equal(readdirSync(join(dir, 'logs')).length, 3);
  assert.equal(output.length, 3);
  assert.match(output[0], /^Crash report saved: .+crash-.+\.json — run `ctg doctor` for details\n$/);
  assert.equal(latestCrashReport(join(dir, 'logs')).report.origin, 'unhandledRejection');
  uninstall();
  assert.equal(target.listenerCount('uncaughtExceptionMonitor'), 0);
  installCrashHandlers({ env: { CTG_CRASH_REPORTS: '0', CARTHAGENT_CODING_AGENT_DIR: dir }, target });
  assert.equal(target.listenerCount('uncaughtExceptionMonitor'), 0);
});

test('the issue URL is prefilled for crash_report.yml and stays short', () => {
  const error = stackError(
    'TypeError',
    'z'.repeat(5000),
    Array.from({ length: 30 }, (_, i) => `fn${i} (/srv/lib/file${i}.mjs:1:1)`),
  );
  const report = buildCrashReport({ error, argv: ['update', '--check'], cli, version: '1.2.3', breadcrumbs: [] });
  const url = new URL(crashIssueUrl(report));
  assert.ok(url.href.length <= 1800, String(url.href.length));
  assert.equal(url.origin + url.pathname, 'https://github.com/B-icy/Carthagent/issues/new');
  assert.equal(url.searchParams.get('template'), 'crash_report.yml');
  assert.equal(url.searchParams.get('fingerprint'), report.fingerprint);
  assert.match(url.searchParams.get('version'), /^ctg 1\.2\.3 \(node v\d+/);
  assert.equal(url.searchParams.get('command'), 'ctg update --check');
  assert.match(url.searchParams.get('report'), /^TypeError: z+/);
  const small = new URL(crashIssueUrl(buildCrashReport({ error: stackError('Error', 'short', ['a (/x.mjs:1:1)']), breadcrumbs: [] })));
  assert.match(small.searchParams.get('report'), /^Error: short\n {4}at a \(\/x\.mjs:1:1\)/);
});

for (const [origin, body] of [
  ['uncaughtException', `setTimeout(() => { throw new TypeError('child boom'); });`],
  ['unhandledRejection', `Promise.reject(new TypeError('child boom'));`],
]) {
  test(`a real ${origin} keeps Node's output and exit code and adds one pointer line`, t => {
    const dir = tempDir(t);
    const script = `const { installCrashHandlers } = await import(${JSON.stringify(crashModule)}); installCrashHandlers({ argv: ['secret prompt'] }); ${body}`;
    const env = { ...process.env, CARTHAGENT_CODING_AGENT_DIR: dir };
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /TypeError: child boom/);
    assert.match(result.stderr, /Node\.js v\d+/);
    assert.equal((result.stderr.match(/Crash report saved: /g) ?? []).length, 1);
    const { report } = latestCrashReport(join(dir, 'logs'));
    assert.equal(report.origin, origin);
    assert.deepEqual(report.command, { name: '<task>', flags: [] });
    assert.equal(JSON.stringify(report).includes('secret prompt'), false);
  });
}

test('ctg doctor --crash-report prints the newest report as JSON', t => {
  const dir = tempDir(t);
  const env = { ...process.env, CARTHAGENT_CODING_AGENT_DIR: dir, CTG_LOG_LEVEL: 'silent' };
  const empty = spawnSync(process.execPath, [ctg, 'doctor', '--crash-report'], { env, encoding: 'utf8' });
  assert.equal(empty.status, 0);
  assert.match(empty.stdout, /No crash reports found/);
  mkdirSync(join(dir, 'logs'));
  const path = writeCrashReport(buildCrashReport({ error: new Error('saved'), breadcrumbs: [] }), { dir: join(dir, 'logs') });
  const shown = spawnSync(process.execPath, [ctg, 'doctor', '--crash-report'], { env, encoding: 'utf8' });
  assert.equal(shown.status, 0);
  assert.deepEqual(JSON.parse(shown.stdout), JSON.parse(readFileSync(path, 'utf8')));
  assert.match(shown.stderr, /Crash report: .+\.json/);
});
