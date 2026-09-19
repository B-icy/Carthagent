import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveDir, domCheck } from '../lib/browser.mjs';

function fixture(t, html = '<!doctype html><div id="app">hello</div>') {
  const dir = mkdtempSync(join(tmpdir(), 'carthagent browser '));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'index.html'), html);
  return dir;
}

test('serveDir serves files over HTTP with correct MIME and blocks traversal', async t => {
  const dir = fixture(t);
  const srv = await serveDir(dir);
  t.after(() => srv.close());
  const res = await fetch(`${srv.url}/index.html`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /hello/);
  const esc = await fetch(`${srv.url}/%2e%2e%2fpackage.json`);
  assert.equal(esc.status, 403);
  const missing = await fetch(`${srv.url}/nope.html`);
  assert.equal(missing.status, 404);
});

test('domCheck executes inline scripts and asserts on selectors, text, and clicks', async () => {
  const html = `<!doctype html><body>
    <div id="word">_ _</div><div id="kb"></div>
    <script>
      const kb = document.getElementById('kb');
      'AB'.split('').forEach(ch => {
        const b = document.createElement('button'); b.id = 'key-' + ch; b.textContent = ch;
        b.onclick = () => { document.getElementById('word').textContent = ch + ' _'; };
        kb.appendChild(b);
      });
    </script></body>`;
  const r = await domCheck(html, [
    { selector: '#kb button', count: 2 },
    { selector: '#word', text: '_ _' },
    { action: 'click', selector: '#key-A', then: { selector: '#word', text: 'A _' } },
    { console: 'error-free' },
  ]);
  assert.equal(r.pass, true);
  assert.deepEqual(r.failures, []);
  assert.deepEqual(r.consoleErrors, []);
});

test('domCheck reports failures for missing elements, wrong counts, bad text, and console errors', async () => {
  const html = `<!doctype html><body><div id="x">nope</div><script>console.error('boom');</script></body>`;
  const r = await domCheck(html, [
    { selector: '#missing' },
    { selector: '#x', text: 'expected' },
    { selector: 'div', count: 5 },
    { console: 'error-free' },
  ]);
  assert.equal(r.pass, false);
  assert.equal(r.failures.length, 4);
  assert.ok(r.failures.some(f => f.includes('not found')));
  assert.ok(r.failures.some(f => f.includes('does not match')));
  assert.ok(r.failures.some(f => f.includes('console errors')));
});

test('domCheck rejects unsupported module execution but permits explicit static inspection', async () => {
  for (const script of ['<script type="module">throw new Error("Broken app")</script>', '<script type="MODULE" src="/app.mjs"></script>']) {
    const html = `<div id="app">café</div>${script}`;
    const result = await domCheck(html, [{ selector: '#app' }, { console: 'error-free' }], { waitMs: 0 });
    assert.equal(result.pass, false);
    assert.match(result.failures.join(' '), /Unsupported module scripts/);
    result.window.close();
    const staticResult = await domCheck(html, [{ selector: '#app', text: 'café' }], { runScripts: false });
    assert.equal(staticResult.pass, true);
    staticResult.window.close();
  }
});

test('domCheck supports eval assertions and type/key actions', async () => {
  const html = `<!doctype html><body>
    <input id="in"><div id="out"></div>
    <script>
      document.getElementById('in').addEventListener('input', e => {
        document.getElementById('out').textContent = 'typed:' + e.target.value;
      });
      document.addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('out').textContent = 'enter!';
      });
    </script></body>`;
  const r = await domCheck(html, [
    { action: 'type', selector: '#in', value: 'abc', then: { selector: '#out', text: 'typed:abc' } },
    { action: 'key', key: 'Enter', then: { selector: '#out', text: 'enter!' } },
    { eval: 'document.title', expect: '' },
  ]);
  assert.equal(r.pass, true);
});
