import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runNativeProcess } from './helpers/native-cli-process.mjs';

test('native process runner terminates descendants and bounds inherited stdio', { timeout: 20_000 }, async () => {
  const started = performance.now();
  const source = `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { stdio: 'inherit' });
    console.log(child.pid);
    setInterval(() => {}, 1000);
  `;
  const result = await runNativeProcess(process.execPath, ['-e', source], { timeoutMs: 3000 });
  const elapsed = performance.now() - started;
  const grandchildPid = Number(result.stdout.trim().split('\n')[0]);
  const alive = await processAlive(grandchildPid);

  assert.equal(result.timedOut, true);
  assert.equal(alive, false, `native CLI grandchild ${grandchildPid} survived timeout cleanup`);
  assert.ok(['SIGTERM', 'TIMEOUT'].includes(result.signal));
  assert.ok(elapsed < 15_000, `inherited stdio handles exceeded the hard cleanup bound: ${Math.round(elapsed)}ms`);
});

async function processAlive(pid) {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      process.kill(pid, 0);
      if (process.platform !== 'linux') return true;
      const stat = await import('node:fs/promises').then(fs => fs.readFile(`/proc/${pid}/stat`, 'utf8'));
      if (stat.split(' ')[2] !== 'Z') return true;
    } catch (error) {
      if (error.code === 'ESRCH' || error.code === 'ENOENT') return false;
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return true;
}
