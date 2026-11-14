import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserScreenshot } from '../lib/browser.mjs';

// INF-02: a full Chrome/Chromium (CARTHAGENT_BROWSER or PATH) exits with
// "Missing X server or $DISPLAY" unless it is told to run headless.
test('screenshots launch Chromium-family browsers with --headless', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ctg-fake-chrome-'));
  const log = join(dir, 'argv.json');
  const fake = join(dir, 'chrome');
  writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify(args));
if (!args.includes('--headless')) { process.stderr.write('Missing X server or $DISPLAY\\n'); process.exit(1); }
const shot = args.find(a => a.startsWith('--screenshot=')).slice(13);
fs.writeFileSync(shot, 'png');
`);
  chmodSync(fake, 0o755);
  const out = join(dir, 'shot.png');
  const result = await browserScreenshot('http://127.0.0.1:9/', out, { browser: fake, timeoutMs: 10000 });
  assert.equal(result.ok, true, result.stderr);
  assert.ok(existsSync(out));
  assert.ok(JSON.parse(readFileSync(log, 'utf8')).includes('--headless'));
});

test('the CDP launcher passes --headless too', () => {
  const source = readFileSync(new URL('../lib/cdp.mjs', import.meta.url), 'utf8');
  assert.match(source, /spawn\(binary, \[\n(?:\s*\/\/.*\n)*\s*'--headless',/);
});

test('a full Chrome auto-requesting a missing /favicon.ico is not a page error; other 404s still are', () => {
  const source = readFileSync(new URL('../lib/cdp.mjs', import.meta.url), 'utf8');
  const filter = source.match(/params\.entry\.source === 'network' && (\/.*?\/)\.test/)[1];
  const favicon = new Function(`return ${filter}`)();
  assert.equal(favicon.test('http://127.0.0.1:1234/favicon.ico'), true);
  assert.equal(favicon.test('http://127.0.0.1:1234/favicon.ico?v=2'), true);
  assert.equal(favicon.test('http://127.0.0.1:1234/app.mjs'), false);
  assert.equal(favicon.test('http://127.0.0.1:1234/favicon.ico.js'), false);
});
