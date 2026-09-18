import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tool = fileURLToPath(new URL('../tools/webdriver-check.mjs', import.meta.url));
test('WebDriver CLI rejects unsupported options and unavailable driver without fallback', () => {
  for (const args of [['--console-clean'], ['--endpoint', 'http://127.0.0.1:1', '--assert', '#app'], ['--endpoint', 'http://127.0.0.1:1', '--assert', '#app', '--wait-ms', 'NaN'], ['--endpoint', 'http://127.0.0.1:1', '--assert', '#app', '--url', 'file:///tmp/test'], ['--endpoint', 'http://127.0.0.1:1', '--assert', '#app', '--url', 'http://localhost', '--root', '.']]) {
    const result = spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1, result.stderr);
    const failure = JSON.parse(result.stderr);
    assert.equal(failure.pass, false);
    assert.ok(['driver', 'configuration'].includes(failure.category));
  }
});
