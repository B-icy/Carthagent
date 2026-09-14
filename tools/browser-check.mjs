#!/usr/bin/env node
/**
 * browser-check — smoke + DOM + screenshot checks for delivered web pages.
 *
 * Declared in delivery_plan checks argv, e.g.:
 *   ["node","tools/browser-check.mjs","--page","index.html",
 *    "--assert","#keyboard button","--assert-count","#keyboard button:26",
 *    "--click","#key-a","--then-text","#word:_A",
 *    "--console-clean","--screenshot","artifacts/shot.png"]
 *
 * Serves the workspace over a local HTTP server (avoids file:// CORS),
 * runs jsdom assertions with real inline-script execution, and optionally
 * captures a real Firefox screenshot into artifacts/.
 *
 * Exit 0 = all assertions pass (screenshot failures are warnings unless
 * --require-screenshot is set). Prints a JSON summary to stdout.
 */
import { resolve, isAbsolute } from 'node:path';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serveDir, domCheck, firefoxScreenshot } from '../lib/browser.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i === -1 ? def : args[i + 1];
};
const optAll = name => {
  const out = [];
  for (let i = 0; i < args.length; i++) if (args[i] === name && args[i + 1]) out.push(args[i + 1]);
  return out;
};
const has = name => args.includes(name);

const page = opt('--page', 'index.html');
const root = resolve(opt('--root', '.'));
const assertions = [];

for (const s of optAll('--assert')) assertions.push({ selector: s });
for (const s of optAll('--assert-count')) {
  const m = s.match(/^(.+):(\d+)$/);
  if (!m) { console.error(`bad --assert-count: ${s} (want "selector:N")`); process.exit(2); }
  assertions.push({ selector: m[1], count: +m[2] });
}
for (const s of optAll('--assert-text')) {
  const m = s.match(/^([^:]+):(.+)$/s);
  if (!m) { console.error(`bad --assert-text: ${s} (want "selector:text")`); process.exit(2); }
  assertions.push({ selector: m[1], text: m[2] });
}
// --click '#a' --then-text '#word:_A' — click then assert text on another element
const clicks = optAll('--click');
const thenTexts = optAll('--then-text');
if (clicks.length) {
  clicks.forEach((sel, i) => {
    const t = thenTexts[i];
    const m = t && t.match(/^([^:]+):(.+)$/s);
    assertions.push(m
      ? { action: 'click', selector: sel, then: { selector: m[1], text: m[2] } }
      : { action: 'click', selector: sel, then: { selector: sel } });
  });
}
for (const s of optAll('--eval')) assertions.push({ eval: s });
if (has('--console-clean')) assertions.push({ console: 'error-free' });

const srv = await serveDir(root);
const url = `${srv.url}/${page}`;
let summary = { url, http: null, dom: null, screenshot: null };

try {
  const res = await fetch(url);
  const body = await res.text();
  summary.http = { status: res.status, bytes: body.length, contentType: res.headers.get('content-type') };
  if (res.status !== 200) {
    console.log(JSON.stringify({ ...summary, pass: false, error: `HTTP ${res.status}` }, null, 2));
    process.exit(1);
  }

  if (assertions.length) {
    const r = await domCheck(body, assertions, { url });
    summary.dom = { pass: r.pass, failures: r.failures, consoleErrors: r.consoleErrors.slice(0, 5) };
  }

  const shot = opt('--screenshot');
  if (shot) {
    const abs = isAbsolute(shot) ? shot : resolve(root, shot);
    mkdirSync(dirname(abs), { recursive: true });
    const wait = opt('--wait');
    const win = (opt('--window', '1280x800').split('x').map(Number));
    summary.screenshot = await firefoxScreenshot(url, abs, {
      width: win[0] || 1280, height: win[1] || 800,
      waitSeconds: wait != null ? +wait : undefined,
    });
    if (!summary.screenshot.ok && has('--require-screenshot')) {
      console.log(JSON.stringify({ ...summary, pass: false }, null, 2));
      process.exit(1);
    }
  }

  const pass = (summary.dom ? summary.dom.pass : true);
  console.log(JSON.stringify({ ...summary, pass }, null, 2));
  process.exit(pass ? 0 : 1);
} finally {
  srv.close();
}
