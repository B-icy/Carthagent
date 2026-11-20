import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearBreadcrumbs, configureLogging, createLogger, getBreadcrumbs, getLogger, redactString, redactValue, resolveLogConfig } from '../lib/logger.mjs';

const loggerUrl = new URL('../lib/logger.mjs', import.meta.url).href;
const fixedNow = () => new Date('2026-01-02T03:04:05.000Z');

function capture(env = {}, defaultLevel = 'warn') {
  const lines = [];
  configureLogging({ env, defaultLevel, now: fixedNow, stream: { write: line => lines.push(line) } });
  return lines;
}

test.afterEach(() => {
  configureLogging({ env: {} });
  clearBreadcrumbs();
});

test('levels: CLI default is warn, CTG_LOG_LEVEL overrides, CARTHAGENT_DEBUG means debug', () => {
  assert.equal(resolveLogConfig({}).level, 'warn');
  assert.equal(resolveLogConfig({}, { defaultLevel: 'info' }).level, 'info');
  assert.equal(resolveLogConfig({ CTG_LOG_LEVEL: 'ERROR' }).level, 'error');
  assert.equal(resolveLogConfig({ CTG_LOG_LEVEL: 'nonsense' }).level, 'warn');
  assert.equal(resolveLogConfig({ CARTHAGENT_DEBUG: '1' }).level, 'debug');
  assert.equal(resolveLogConfig({ CARTHAGENT_DEBUG: '1', CTG_LOG_LEVEL: 'warn' }).level, 'warn');
  assert.equal(resolveLogConfig({ CTG_LOG_FORMAT: 'json' }).format, 'json');
  assert.equal(resolveLogConfig({ CTG_LOG_FORMAT: 'xml' }).format, 'pretty');

  const lines = capture();
  const log = getLogger('unit');
  log.debug('hidden');
  log.info('hidden');
  log.warn('shown');
  log.error('shown too');
  assert.equal(lines.length, 2);
  assert.equal(log.enabled('debug'), false);
  assert.equal(log.enabled('error'), true);
});

test('JSON lines carry bound child context and structured fields', () => {
  const lines = capture({ CTG_LOG_FORMAT: 'json', CTG_LOG_LEVEL: 'debug' });
  const log = createLogger({ component: 'runtime' }).child({ sessionId: 'ses_1' });
  log.info('Downloading', { attempt: 2, host: 'github.com' });
  assert.equal(lines.length, 1);
  assert.ok(lines[0].endsWith('\n'));
  assert.deepEqual(JSON.parse(lines[0]), {
    time: '2026-01-02T03:04:05.000Z',
    level: 'info',
    component: 'runtime',
    sessionId: 'ses_1',
    msg: 'Downloading',
    attempt: 2,
    host: 'github.com',
  });
});

test('pretty text is one readable line', () => {
  const lines = capture({ CTG_LOG_LEVEL: 'info' });
  getLogger('update').warn('Check failed', { status: 503, reason: 'two words' });
  assert.equal(lines[0], '2026-01-02T03:04:05.000Z WARN  [update] Check failed status=503 reason="two words"\n');
});

test('secret keys and secret-shaped strings are redacted, including nested values and errors', () => {
  const value = redactValue({
    Authorization: 'Bearer abc.def',
    apiKey: 'x',
    api_key: 'x',
    refresh_token: 'x',
    nested: { password: 'p', cookie: 'c', ok: 'visible', deeper: { secret: 's', accessToken: 'a' } },
    headers: [{ 'x-api-key': 'k' }],
    text: 'call with Bearer abc123.def and sk-live_1234567890 and ghp_abcdefghijklmnopqrstu',
    url: 'https://user:pass@example.test/path?token=abc&keep=1',
    jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl',
    error: Object.assign(new Error('failed with Bearer zzz'), { code: 'E1' }),
  });
  assert.equal(value.Authorization, '[REDACTED]');
  assert.equal(value.apiKey, '[REDACTED]');
  assert.equal(value.api_key, '[REDACTED]');
  assert.equal(value.refresh_token, '[REDACTED]');
  assert.equal(value.nested.password, '[REDACTED]');
  assert.equal(value.nested.cookie, '[REDACTED]');
  assert.equal(value.nested.ok, 'visible');
  assert.equal(value.nested.deeper.secret, '[REDACTED]');
  assert.equal(value.nested.deeper.accessToken, '[REDACTED]');
  assert.equal(value.headers[0]['x-api-key'], '[REDACTED]');
  assert.equal(value.text, 'call with Bearer [REDACTED] and sk-[REDACTED] and ghp_[REDACTED]');
  assert.equal(value.url, 'https://[REDACTED]@example.test/path?token=[REDACTED]&keep=1');
  assert.equal(value.jwt, '[REDACTED_JWT]');
  assert.deepEqual(value.error, { name: 'Error', message: 'failed with Bearer [REDACTED]', code: 'E1' });
  const circular = { a: 1 };
  circular.self = circular;
  assert.deepEqual(redactValue(circular), { a: 1, self: '[Circular]' });
  assert.equal(redactString('x'.repeat(5000)).length, 2001);
});

test('log lines never contain secrets passed as fields or in the message', () => {
  const lines = capture({ CTG_LOG_FORMAT: 'json', CTG_LOG_LEVEL: 'debug' });
  getLogger('auth').error('refresh failed for Bearer topsecretvalue', { token: 'topsecretvalue', detail: { authorization: 'Bearer topsecretvalue' } });
  assert.equal(lines.join('').includes('topsecretvalue'), false);
});

test('breadcrumbs keep the newest 50 events, including those below the output level', () => {
  const lines = capture();
  const log = getLogger('crumbs');
  for (let i = 0; i < 60; i++) log.debug(`event ${i}`, { i, token: 'secret' });
  assert.equal(lines.length, 0);
  const crumbs = getBreadcrumbs();
  assert.equal(crumbs.length, 50);
  assert.equal(crumbs[0].msg, 'event 10');
  assert.equal(crumbs.at(-1).msg, 'event 59');
  assert.equal(crumbs.at(-1).token, '[REDACTED]');
  crumbs[0].msg = 'mutated';
  assert.equal(getBreadcrumbs()[0].msg, 'event 10');
});

test('a failing sink never throws into the caller', () => {
  configureLogging({ env: { CTG_LOG_LEVEL: 'debug' }, stream: { write: () => assert.fail('boom') } });
  assert.doesNotThrow(() => getLogger('x').error('still fine'));
  configureLogging({ env: { CTG_LOG_LEVEL: 'debug', CTG_LOG_FILE: join(tmpdir(), 'missing-dir-for-ctg-logger', 'nested', 'log.jsonl') } });
  assert.doesNotThrow(() => getLogger('x').error('still fine'));
});

test('CTG_LOG_FILE receives private JSON lines instead of stderr', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ctg-logger-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'ctg.log');
  const lines = [];
  configureLogging({ env: { CTG_LOG_FILE: file, CTG_LOG_LEVEL: 'info' }, stream: { write: line => lines.push(line) } });
  getLogger('file').info('to file', { n: 1 });
  assert.equal(lines.length, 0);
  const [entry] = readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(entry.msg, 'to file');
  assert.equal(entry.n, 1);
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
});

test('logging never writes to stdout', () => {
  const script = `const { getLogger } = await import(${JSON.stringify(loggerUrl)}); const log = getLogger('child'); for (const level of ['debug','info','warn','error']) log[level]('message ' + level);`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, CTG_LOG_LEVEL: 'debug', CTG_LOG_FILE: '' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /DEBUG \[child\] message debug/);
  assert.match(result.stderr, /ERROR \[child\] message error/);
});
