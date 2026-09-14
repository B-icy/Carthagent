/**
 * Browser testing helpers for delivery checks — fully repo-contained.
 *
 * Three capability tiers:
 *   serve  — static file server over node:http (zero deps)
 *   dom    — jsdom DOM assertions with real inline-script execution (npm dep)
 *   shot   — `firefox --headless --screenshot` via the system binary (zero deps)
 *
 * Used by tools/browser-check.mjs; also importable for custom check scripts.
 */
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { delimiter, extname, join, resolve, normalize, isAbsolute, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { JSDOM, VirtualConsole } from 'jsdom';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json',
};

/** Start a static file server rooted at `root`. Returns { server, port, url, close }. */
export function serveDir(root, { port = 0 } = {}) {
  const base = resolve(root);
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const full = normalize(join(base, rel));
      const local = relative(base, full);
      if (local === '..' || local.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(local)) { res.writeHead(403); res.end('forbidden'); return; }
      if (!existsSync(full) || !statSync(full).isFile()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[extname(full).toLowerCase()] || 'application/octet-stream' });
      res.end(readFileSync(full));
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  return new Promise((ok, err) => {
    server.once('error', err);
    server.listen(port, '127.0.0.1', () => {
      const p = server.address().port;
      ok({ server, port: p, url: `http://127.0.0.1:${p}`, close: () => server.close() });
    });
  });
}

/** Find the firefox binary. Honors FIREFOX env var, then PATH, then common snap paths. */
export function findFirefox() {
  if (process.env.FIREFOX) return process.env.FIREFOX;
  const names = process.platform === 'win32' ? ['firefox.exe', 'firefox'] : ['firefox'];
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  for (const candidate of ['/usr/bin/firefox', '/snap/bin/firefox']) if (existsSync(candidate)) return candidate;
  return names[0];
}

/**
 * Take a screenshot with the system Firefox (headless). Zero npm deps.
 * Firefox snap can only write inside $HOME — `out` must be an absolute path under HOME.
 * Returns { ok, out, stderr }.
 */
export function firefoxScreenshot(url, out, { width = 1280, height = 800, timeoutMs = 45000, waitSeconds } = {}) {
  return new Promise((ok) => {
    const abs = isAbsolute(out) ? out : resolve(out);
    const profile = mkdtempSync(join(tmpdir(), 'pi2-firefox-'));
    const args = ['--headless', '--no-remote', '--profile', profile, '--screenshot', abs, '--window-size', `${width},${height}`];
    if (waitSeconds != null) args.push('--screenshot-delay', String(waitSeconds));
    args.push(url);
    const child = spawn(findFirefox(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, timeoutMs);
    child.on('close', code => {
      clearTimeout(timer);
      rmSync(profile, { recursive: true, force: true });
      ok({ ok: code === 0 && existsSync(abs), out: abs, code, stderr: stderr.slice(-2000) });
    });
    child.on('error', e => {
      clearTimeout(timer);
      rmSync(profile, { recursive: true, force: true });
      ok({ ok: false, out: abs, error: String(e), stderr });
    });
  });
}

/**
 * Load a page in jsdom (executes inline + same-origin scripts), then run assertions.
 *
 * assertions: array of
 *   { selector, count? }                    — element exists / exact count
 *   { selector, text?: string|RegExp }      — textContent contains/matches
 *   { selector, attr, value? }              — attribute equals/contains
 *   { action:'click', selector, then:assert }  — dispatch click, then assert
 *   { action:'type', selector, value, then }   — set input value + input event
 *   { action:'key', key, selector?, then }     — KeyboardEvent on element/document
 *   { eval: string, expect?: any }          — evaluate JS in page context, check result
 *   { console: 'error-free' }               — no console.error/pageerror captured
 *
 * Returns { pass, failures:[...], consoleErrors:[...], document }.
 */
export async function domCheck(source, assertions = [], { url, runScripts = true, waitMs = 250 } = {}) {
  const consoleErrors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => consoleErrors.push(String(e.detail || e)));
  vc.on('error', (...a) => consoleErrors.push(a.join(' ')));

  const html = source.startsWith('http') ? await (await fetch(source)).text() : source;
  const dom = new JSDOM(html, {
    url: url || (source.startsWith('http') ? source : 'http://localhost/'),
    runScripts: runScripts ? 'dangerously' : 'outside-only',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  if (runScripts) await new Promise(r => setTimeout(r, waitMs)); // let inline scripts settle

  const { document } = dom.window;
  const failures = [];
  const run = a => {
    try {
      if (a.eval) {
        const result = dom.window.eval(a.eval);
        if ('expect' in a && JSON.stringify(result) !== JSON.stringify(a.expect))
          failures.push(`eval ${JSON.stringify(a.eval)} → ${JSON.stringify(result)}, expected ${JSON.stringify(a.expect)}`);
        return;
      }
      if (a.console === 'error-free') return; // checked at end
      if (a.action === 'click') {
        const el = document.querySelector(a.selector);
        if (!el) { failures.push(`click: ${a.selector} not found`); return; }
        el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      } else if (a.action === 'type') {
        const el = document.querySelector(a.selector);
        if (!el) { failures.push(`type: ${a.selector} not found`); return; }
        el.value = a.value;
        el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      } else if (a.action === 'key') {
        const target = a.selector ? document.querySelector(a.selector) : document;
        if (!target) { failures.push(`key: ${a.selector} not found`); return; }
        target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: a.key, bubbles: true }));
      }
      if (a.then) run(a.then);
      if (!a.selector) return;
      const els = document.querySelectorAll(a.selector);
      if (a.count != null && els.length !== a.count) { failures.push(`${a.selector}: count ${els.length} ≠ ${a.count}`); return; }
      if (a.count == null && !els.length) { failures.push(`${a.selector}: not found`); return; }
      const el = els[0];
      if (a.text != null) {
        const t = el.textContent || '';
        const okText = a.text instanceof RegExp ? a.text.test(t) : t.includes(a.text);
        if (!okText) failures.push(`${a.selector}: text ${JSON.stringify(t.slice(0, 80))} does not match ${a.text}`);
      }
      if (a.attr != null) {
        const v = el.getAttribute(a.attr);
        const okAttr = a.value == null ? v != null : String(v).includes(a.value);
        if (!okAttr) failures.push(`${a.selector}[${a.attr}]: ${JSON.stringify(v)} does not match ${a.value ?? '(any)'}`);
      }
    } catch (e) { failures.push(`${a.selector || a.eval || '?'}: ${e.message}`); }
  };
  for (const a of assertions) run(a);
  if (assertions.some(a => a.console === 'error-free') && consoleErrors.length)
    failures.push(`console errors: ${consoleErrors.slice(0, 3).join(' | ')}`);
  return { pass: failures.length === 0, failures, consoleErrors, document, window: dom.window };
}
