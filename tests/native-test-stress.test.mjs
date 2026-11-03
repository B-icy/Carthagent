import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runNativeTestStress } from '../tools/run-native-test-stress.mjs';

test('native stress repetitions run in distinct processes and stop at the first failure', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'ctg-native-stress-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'processes.jsonl');
  const args = ['-e', 'require("node:fs").appendFileSync(process.argv[1],process.pid+"\\n")', file];
  runNativeTestStress({ repetitions: 3, timeoutMs: 5000, command: process.execPath, args, log() {} });
  const pids = (await readFile(file, 'utf8')).trim().split('\n');
  assert.equal(pids.length, 3);
  assert.equal(new Set(pids).size, 3);
  const started = [];
  assert.throws(() => runNativeTestStress({ repetitions: 3, timeoutMs: 5000,
    command: process.execPath, args: ['-e', 'process.exit(7)'], log: line => started.push(line) }), /1\/3 exited with 7/);
  assert.equal(started.length, 1);
});

test('external deadline terminates a child whose event loop cannot run a test timeout', () => {
  const started = Date.now();
  assert.throws(() => runNativeTestStress({ repetitions: 2, timeoutMs: 250,
    command: process.execPath, args: ['-e', 'while (true) {}'], log() {} }), /1\/2 exceeded external 250 ms deadline/);
  assert.ok(Date.now() - started < 5000);
});
