import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureStopDiagnostics, sanitizedNativeOutputTail } from '../tools/native-fixture-stop-diagnostics.mjs';

const child = { pid: 21359, exitCode: null, signalCode: null, killed: false };
const input = { child, output: 'INFO stopping\nERROR shutdown timeout', elapsedMs: 5001.4 };

test('native output tail is bounded and emits only fixed metadata, never raw secrets', () => {
  const secrets = ['0123456789abcdef', 'Basic b3BlbmNvZGU6c2VjcmV0', 'Bearer fixture.token.fixture', 'offline-refresh', 'verify-secret', 'unknown-unlabelled-secret'];
  const output = `${'DEBUG old\n'.repeat(3000)}${secrets.map(secret => `ERROR shutdown authorization password=${secret}`).join('\n')}`;
  const tail = sanitizedNativeOutputTail(output);
  assert.equal(tail.length, 20);
  const serialized = JSON.stringify(tail);
  for (const secret of secrets) assert.ok(!serialized.includes(secret));
  assert.deepEqual(tail.at(-1), { level: 'ERROR', markers: ['shutdown', 'error'] });
  assert.ok(serialized.length < 4096);
});

test('failure evidence snapshots child state and queries only exact PID without argv or environment', async () => {
  const evidence = await fixtureStopDiagnostics(input, { platform: 'darwin', run: async (command, args, options) => {
    assert.equal(command, 'ps');
    assert.deepEqual(args, ['-p', '21359', '-o', 'pid=,ppid=,stat=,etime=,time=']);
    assert.deepEqual(options, { timeout: 2000, maxBuffer: 4096, windowsHide: true });
    child.exitCode = 0;
    return { stdout: ' 21359 123 Z+ 00:05 0:00.01\n' };
  } });
  child.exitCode = null;
  assert.equal(evidence.elapsedMs, 5001);
  assert.equal(evidence.child.exitCode, null);
  assert.deepEqual(evidence.processState, { status: 'observed', state: '21359 123 Z+ 00:05 0:00.01' });
});

test('query errors and unexpected output cannot leak command output or secrets', async () => {
  for (const run of [
    async () => ({ stdout: 'password=secret' }),
    async () => { throw Object.assign(new Error('secret'), { stderr: 'Bearer secret', code: 1 }); },
    async () => { throw Object.assign(new Error('secret'), { code: 'ENOENT', killed: true }); },
  ]) {
    const evidence = await fixtureStopDiagnostics(input, { run });
    assert.ok(!JSON.stringify(evidence).includes('secret'));
    assert.ok(['unrecognized-output', 'query-failed'].includes(evidence.processState.status));
  }
});

test('Windows queries exact PID and accepts only fixed boolean state', async () => {
  const evidence = await fixtureStopDiagnostics(input, { platform: 'win32', run: async (command, args) => {
    assert.equal(command, 'powershell.exe');
    assert.match(args.at(-1), /Get-Process -Id 21359 /);
    assert.doesNotMatch(args.at(-1), /CommandLine|Environment/);
    return { stdout: 'pid=21359 responding=True\r\n' };
  } });
  assert.equal(evidence.processState.status, 'observed');
});

test('missing PID skips OS query, empty result records absence, exited child state is retained', async () => {
  const missing = await fixtureStopDiagnostics({ ...input, child: { ...child, pid: undefined } }, { run: () => assert.fail('must not run') });
  assert.equal(missing.processState.status, 'no-child-pid');
  const exited = await fixtureStopDiagnostics({ ...input, child: { ...child, signalCode: 'SIGTERM' } }, { run: async () => ({ stdout: '' }) });
  assert.equal(exited.child.signalCode, 'SIGTERM');
  assert.equal(exited.processState.status, 'not-found');
});

test('real read-only process query observes this exact test process', async () => {
  const evidence = await fixtureStopDiagnostics({ ...input, child: { ...child, pid: process.pid } });
  assert.equal(evidence.processState.status, 'observed');
  assert.match(evidence.processState.state, new RegExp(`^(?:pid=)?${process.pid}\\s`));
});
