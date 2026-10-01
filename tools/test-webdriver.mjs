// Explicit opt-in integration suite; uses the bundled headless browser —
// auto-downloaded on first run, no external browser or driver required.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveDir } from '../lib/browser.mjs';
import { ensureBundledBrowser } from '../lib/browser-bin.mjs';
import { runCommand } from '../lib/delivery.mjs';

const artifacts = resolve('artifacts');
mkdirSync(artifacts, { recursive: true });
const fixture = mkdtempSync(join(artifacts, 'webdriver café '));
let app;
try {
  await ensureBundledBrowser();
  writeFileSync(join(fixture, 'index.html'), '<meta charset="utf-8"><button id="go">Go</button><p id="out">waiting</p><script type="module" src="app.mjs"></script>');
  writeFileSync(join(fixture, 'app.mjs'), 'document.querySelector("#out").textContent="ready"; document.querySelector("#go").onclick=()=>{document.querySelector("#out").textContent="café ✓"};');
  const tool = fileURLToPath(new URL('./webdriver-check.mjs', import.meta.url));
  const shot = join(artifacts, 'webdriver.png');
  const argv = [process.execPath, tool, '--root', fixture, '--assert-text', '#out:ready', '--click', '#go', '--assert-text', '#out:café ✓', '--screenshot', shot];
  const good = await runCommand(argv, { cwd: process.cwd(), timeoutSeconds: 60 });
  assert.equal(good.code, 0, good.output);
  assert.equal(JSON.parse(good.output).engine, 'chrome-headless-shell');
  assert.equal(readFileSync(shot).subarray(1, 4).toString(), 'PNG');
  app = await serveDir(fixture);
  writeFileSync(join(fixture, 'app.mjs'), 'let count=0; setTimeout(()=>{document.querySelector("#out").textContent="ready"},300); document.querySelector("#go").onclick=()=>{count++; setTimeout(()=>{document.querySelector("#out").textContent="café ✓ "+count},300)};');
  // Include native driver round trips in the readiness budget, not only the 300ms app timer.
  const liveArgs = [process.execPath, tool, '--url', app.url, '--wait-ms', '5000', '--assert-text', '#out:ready', '--click', '#go', '--assert-text', '#out:café ✓ 1'];
  const live = await runCommand(liveArgs, { cwd: process.cwd(), timeoutSeconds: 60 });
  assert.equal(live.code, 0, live.output);
  writeFileSync(join(fixture, 'app.mjs'), 'throw Error("Broken app")');
  const bad = await runCommand(argv, { cwd: process.cwd(), timeoutSeconds: 60 });
  assert.equal(bad.code, 1, bad.output);
  assert.match(bad.output, /expected/);
  const failure = JSON.parse(bad.output);
  assert.equal(failure.category, 'assertion');
  assert.equal(failure.stepIndex, 0);
  assert.equal(failure.selector, '#out');
  assert.ok(bad.durationMs < 20000, 'assertion timeout is bounded');
  assert.ok(failure.browserErrors.some(e => e.text.includes('Broken app')), bad.output);
  for (const script of ['console.error("startup café")', 'throw Error("startup café")', 'Promise.reject(Error("startup café"))']) {
    writeFileSync(join(fixture, 'index.html'), `<p id="ready">ready</p><script>${script}</script>`);
    const result = await runCommand([process.execPath, tool, '--root', fixture, '--assert', '#ready'], { cwd: process.cwd(), timeoutSeconds: 60 });
    assert.equal(result.code, 1, result.output);
    const report = JSON.parse(result.output);
    assert.equal(report.category, 'browser-errors');
    assert.ok(report.browserErrors.some(e => e.text.includes('startup café')), result.output);
  }
  console.log('Bundled headless shell: module execution, click, Unicode text, screenshot and broken-module failure passed');
} finally {
  app?.close();
  rmSync(fixture, { recursive: true, force: true });
}
