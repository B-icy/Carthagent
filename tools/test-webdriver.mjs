// Explicit opt-in integration suite; requires Firefox and geckodriver on PATH.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand } from '../lib/delivery.mjs';

const artifacts = resolve('artifacts');
mkdirSync(artifacts, { recursive: true });
const fixture = mkdtempSync(join(artifacts, 'webdriver café '));
const port = 44000 + Math.floor(Math.random() * 10000);
const endpoint = `http://127.0.0.1:${port}`;
const driver = spawn(process.env.GECKODRIVER || 'geckodriver', ['--port', String(port), '--profile-root', fixture], { stdio: ['ignore', 'ignore', 'pipe'] });
let driverError;
let log = '';
driver.on('error', error => { driverError = error; });
driver.stderr.on('data', chunk => { log = (log + chunk).slice(-4000); });
const exited = new Promise(r => driver.once('close', r));
try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (driverError) throw driverError;
    try { ready = (await fetch(endpoint + '/status', { signal: AbortSignal.timeout(500) })).ok; } catch {}
    if (ready) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(ready, `driver did not start: ${log}`);
  writeFileSync(join(fixture, 'index.html'), '<meta charset="utf-8"><button id="go">Go</button><p id="out">waiting</p><script type="module" src="app.mjs"></script>');
  writeFileSync(join(fixture, 'app.mjs'), 'document.querySelector("#out").textContent="ready"; document.querySelector("#go").onclick=()=>{document.querySelector("#out").textContent="café ✓"};');
  const tool = fileURLToPath(new URL('./webdriver-check.mjs', import.meta.url));
  const shot = join(artifacts, 'webdriver.png');
  const argv = [process.execPath, tool, '--endpoint', endpoint, '--root', fixture, '--assert-text', '#out:ready', '--click', '#go', '--assert-text', '#out:café ✓', '--screenshot', shot];
  const good = await runCommand(argv, { cwd: process.cwd(), timeoutSeconds: 30 });
  assert.equal(good.code, 0, good.output);
  assert.equal(JSON.parse(good.output).engine, 'firefox-webdriver');
  assert.equal(readFileSync(shot).subarray(1, 4).toString(), 'PNG');
  writeFileSync(join(fixture, 'app.mjs'), 'throw Error("Broken app")');
  const bad = await runCommand(argv, { cwd: process.cwd(), timeoutSeconds: 30 });
  assert.equal(bad.code, 1, bad.output);
  assert.match(bad.output, /expected/);
  console.log('Real Firefox: module execution, click, Unicode text, screenshot and broken-module failure passed');
} finally {
  driver.kill('SIGTERM');
  await exited;
  rmSync(fixture, { recursive: true, force: true });
}
