import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { domCheck } from '../lib/browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = join(root, 'server.mjs');
const htmlPath = join(root, 'public', 'index.html');

async function serverFixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'pi2 server '));
  writeFileSync(join(cwd, 'app.mjs'), 'console.log("ok")\n');
  const port = 32000 + Math.floor(Math.random() * 10000);
  const token = 'test-token';
  const child = spawn(process.execPath, [serverPath], {
    cwd: root,
    env: { ...process.env, PI2_WORKSPACE: cwd, PI2_PORT: String(port), PI2_SERVER_TOKEN: token },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => { child.kill('SIGTERM'); rmSync(cwd, { recursive: true, force: true }); });
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('server startup timeout')), 5000);
    child.stdout.on('data', chunk => {
      if (chunk.toString().includes('pi2 dashboard:')) { clearTimeout(timer); resolveReady(); }
    });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { if (code) { clearTimeout(timer); reject(new Error(`server exited ${code}`)); } });
  });
  return { cwd, token, url: `http://127.0.0.1:${port}` };
}

const json = (token, body) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-pi2-token': token },
  body: JSON.stringify(body)
});

test('dashboard API requires its launch token and rejects foreign origins', async t => {
  const server = await serverFixture(t);
  assert.equal((await fetch(`${server.url}/api/status`)).status, 401);
  const foreign = await fetch(`${server.url}/api/status`, { headers: { 'x-pi2-token': server.token, origin: 'https://example.com' } });
  assert.equal(foreign.status, 403);
  const response = await fetch(`${server.url}/api/status`, { headers: { 'x-pi2-token': server.token } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).workspace, server.cwd);
});

test('dashboard persists plans and executes checks in the selected workspace', async t => {
  const server = await serverFixture(t);
  const plan = {
    goal: 'Server fixture', assumptions: [], artifacts: ['.'], steps: ['Run'],
    acceptance: [{ requirement: 'Runs', checks: ['smoke'] }],
    checks: [{ id: 'smoke', kind: 'runtime', argv: [process.execPath, 'app.mjs'], timeoutSeconds: 10 }]
  };
  const saved = await fetch(`${server.url}/api/plan/set`, json(server.token, { plan }));
  assert.equal(saved.status, 200, await saved.text());
  const checked = await fetch(`${server.url}/api/checks/run`, json(server.token, { id: 'all' }));
  assert.equal(checked.status, 200, await checked.text());
  const status = await fetch(`${server.url}/api/status`, { headers: { 'x-pi2-token': server.token } });
  const body = await status.json();
  assert.equal(body.plan.goal, 'Server fixture');
  assert.equal(body.evidence.smoke.passed, true);
  assert.deepEqual(body.pendingChecks, []);
});

test('dashboard is self-contained and does not render API data with innerHTML', async () => {
  const html = readFileSync(htmlPath, 'utf8');
  assert.doesNotMatch(html, /https?:\/\/[^'"\s]+/);
  assert.doesNotMatch(html, /\.innerHTML\s*=/);
  assert.match(html, /textContent/);
  const rendered = await domCheck(html, [{ selector: '.shell' }, { selector: '.brand', text: 'pi2' }, { console: 'error-free' }]);
  assert.equal(rendered.pass, true, rendered.failures.join('\n'));
});
