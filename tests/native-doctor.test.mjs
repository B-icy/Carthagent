import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doctorExitCode, doctorReport, formatDoctor, printLatestCrashReport, supportedNode } from '../lib/opencode/doctor.mjs';
import { commandHelp, runOpenCodeCli } from '../lib/opencode/cli.mjs';
import { buildCrashReport, writeCrashReport } from '../lib/crash-report.mjs';

const base = { version: '1.1.1', nodeVersion: 'v24.22.1', platform: 'linux-arm64' };
const ok = {
  runtime: async () => '0.0.0-ctg.2.0.32',
  service: async () => 'running',
  providers: async () => ['Carthagent Cloud'],
  cloud: async () => 'signed in as a@b.c',
  crash: async () => null,
};

test('Node support matches the package engines range', () => {
  for (const v of ['v22.22.2', 'v22.23.0', 'v24.15.0', 'v24.22.1', 'v26.0.0', 'v27.1.0']) assert.equal(supportedNode(v), true, v);
  for (const v of ['v22.22.1', 'v22.19.0', 'v23.5.0', 'v24.14.9', 'v25.0.0', 'v18.20.0', 'garbage']) assert.equal(supportedNode(v), false, v);
});

test('a healthy install reports all good and exits 0', async () => {
  const rows = await doctorReport({ ...base, probes: ok });
  assert.equal(doctorExitCode(rows), 0);
  const text = formatDoctor(rows);
  assert.match(text, /✓ Carthagent Cloud\s+signed in as a@b\.c/);
  assert.match(text, /All good\.$/);
});

test('no provider is a problem with the login fix; Cloud sign-in is only a warning', async () => {
  const rows = await doctorReport({
    ...base,
    probes: {
      ...ok,
      providers: async () => [],
      cloud: async () => {
        throw new Error('auth');
      },
    },
  });
  assert.equal(doctorExitCode(rows), 1);
  const text = formatDoctor(rows);
  assert.match(text, /✗ Providers\s+none connected\n\s+→ Run `ctg login`/);
  assert.match(text, /! Carthagent Cloud\s+not signed in/);
  assert.match(text, /1 problem found\./);
});

test('a dead service still reports everything else and skips what depends on it', async () => {
  const called = [];
  const rows = await doctorReport({
    ...base,
    nodeVersion: 'v18.20.0',
    probes: {
      ...ok,
      service: async () => {
        throw new Error('port in use');
      },
      providers: async () => {
        called.push('providers');
        return [];
      },
      cloud: async () => {
        called.push('cloud');
        return '';
      },
    },
  });
  assert.deepEqual(called, []);
  const text = formatDoctor(rows);
  assert.match(text, /✗ Node\s+v18\.20\.0 is not supported/);
  assert.match(text, /✗ Service\s+port in use\n\s+→ Run `ctg service stop`/);
  assert.match(text, /- Providers\s+skipped/);
  assert.match(text, /2 problems found\./);
});

test('`ctg doctor` is a command, not a task named "doctor"', async () => {
  const calls = [];
  const runtime = {
    command: async input => {
      calls.push(['command', input.command]);
      return 0;
    },
    run: async () => {
      calls.push(['run']);
      return 0;
    },
  };
  const code = await runOpenCodeCli({ argv: ['doctor'], runtime, io: { log() {}, error() {} }, stdoutIsTTY: false });
  assert.equal(code, 0);
  assert.deepEqual(calls, [['command', 'doctor']]);
  assert.match(commandHelp('doctor'), /Usage: ctg doctor/);
});

// INF-03: a revoked session is broken auth, not "All good".
test('a revoked Cloud session is a problem with the re-login fix; the RPC rejects with a plain object', async () => {
  const revoked = {
    type: 'unauthenticated',
    message: 'Your Carthagent Cloud session expired or was revoked. Run `ctg login` again and choose Carthagent Cloud.',
  };
  const rows = await doctorReport({
    ...base,
    probes: {
      ...ok,
      cloud: async () => {
        throw revoked;
      },
    },
  });
  assert.equal(doctorExitCode(rows), 1);
  const text = formatDoctor(rows);
  assert.match(text, /✗ Carthagent Cloud\s+session expired or revoked\n\s+→ Run `ctg login` again/);
  assert.doesNotMatch(text, /All good/);
});

test('a recent crash is a warning with the report command and a prefilled issue link; it does not fail doctor', async () => {
  const now = Date.parse('2026-03-10T12:00:00Z');
  const report = buildCrashReport({
    error: new TypeError('Cannot read properties of undefined (reading "model")'),
    argv: ['update', '--check'],
    cli: { isCommand: name => name === 'update' },
    version: '1.1.1',
    now: new Date(now - 60_000),
    breadcrumbs: [],
  });
  const rows = await doctorReport({ ...base, now, probes: { ...ok, crash: async () => ({ path: '/x/crash.json', report }) } });
  assert.equal(doctorExitCode(rows), 0);
  const text = formatDoctor(rows);
  assert.match(text, new RegExp(`! Last crash\\s+2026-03-10T11:59:00\\.000Z ${report.fingerprint} TypeError: Cannot read properties`));
  assert.match(
    text,
    /→ Full report: `ctg doctor --crash-report`\. Report it: https:\/\/github\.com\/B-icy\/Carthagent\/issues\/new\?template=crash_report\.yml&fingerprint=/,
  );
  assert.match(text, /&command=ctg\+update\+--check/);
  assert.match(text, /All good\.$/);

  const old = await doctorReport({ ...base, now: now + 30 * 24 * 60 * 60 * 1000, probes: { ...ok, crash: async () => ({ report }) } });
  assert.doesNotMatch(formatDoctor(old), /Last crash/);
  const unreadable = await doctorReport({
    ...base,
    probes: {
      ...ok,
      crash: async () => {
        throw new Error('EACCES');
      },
    },
  });
  assert.doesNotMatch(formatDoctor(unreadable), /Last crash/);
});

test('printLatestCrashReport prints the newest report as JSON, or says there is none', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ctg-doctor-crash-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = [];
  const err = [];
  const io = { log: line => out.push(line), error: line => err.push(line) };
  assert.equal(printLatestCrashReport({ io, dir }), 0);
  assert.match(out[0], /No crash reports found/);
  const path = writeCrashReport(buildCrashReport({ error: new Error('latest'), breadcrumbs: [] }), { dir });
  out.length = 0;
  assert.equal(printLatestCrashReport({ io, dir }), 0);
  assert.equal(JSON.parse(out[0]).error.message, 'latest');
  assert.deepEqual(err, [`Crash report: ${path}`]);
});
