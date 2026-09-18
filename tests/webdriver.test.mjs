import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tool = fileURLToPath(new URL('../tools/webdriver-check.mjs', import.meta.url));
test('WebDriver CLI rejects unsupported options and unavailable driver without fallback', () => {
  for (const args of [['--console-clean'], ['--endpoint', 'http://127.0.0.1:1', '--assert', '#app']]) {
    const result = spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(JSON.parse(result.stderr).pass, false);
  }
});
