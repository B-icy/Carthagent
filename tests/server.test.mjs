import { test } from 'node:test';
import { fixtureDesign, fixtureReview } from './helpers/tested-design.mjs';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { domCheck } from '../lib/browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = join(root, 'server.mjs');
const htmlPath = join(root, 'public', 'index.html');

async function serverFixture(t, envOverrides = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'carthagent server '));
  writeFileSync(join(cwd, 'app.mjs'), 'console.log("ok")\n');
  const port = 32000 + Math.floor(Math.random() * 10000);
  const token = 'test-token';
  const child = spawn(process.execPath, [serverPath], {
    cwd: root,
    env: { ...process.env, CARTHAGENT_WORKSPACE: cwd, CARTHAGENT_PORT: String(port), CARTHAGENT_SERVER_TOKEN: token, ...envOverrides },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => { child.kill('SIGTERM'); rmSync(cwd, { recursive: true, force: true }); });
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('server startup timeout')), 5000);
    child.stdout.on('data', chunk => {
      if (chunk.toString().includes('carthagent dashboard:')) { clearTimeout(timer); resolveReady(); }
    });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { if (code) { clearTimeout(timer); reject(new Error(`server exited ${code}`)); } });
  });
  return { cwd, token, url: `http://127.0.0.1:${port}` };
}

const json = (token, body) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-carthagent-token': token },
  body: JSON.stringify(body)
});

async function approvedPost(server, path, body) {
  if (path === 'checks/run') {
    const state = await (await fetch(`${server.url}/api/status`, { headers: { 'x-carthagent-token': server.token } })).json();
    const plan = { ...state.plan, design: fixtureDesign(state.plan) };
    if (JSON.stringify(state.plan.design) !== JSON.stringify(plan.design)) {
      const revised = await fetch(`${server.url}/api/plan/revise`, json(server.token, { reason: 'Fixture design', patch: { design: plan.design } }));
      assert.equal(revised.status, 200, await revised.text());
    }
    let captureId;
    for (const action of ['validate', 'inspect', 'review', 'approve']) {
      const response = await fetch(`${server.url}/api/design`, json(server.token, { action, review: { ...fixtureReview(plan), captureId } }));
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      if (action === 'inspect') captureId = body.result.id;
    }
  }
  return fetch(`${server.url}/api/${path}`, json(server.token, body));
}

test('dashboard API requires its launch token and rejects foreign origins', async t => {
  const server = await serverFixture(t);
  assert.equal((await fetch(`${server.url}/api/status`)).status, 401);
  const foreign = await fetch(`${server.url}/api/status`, { headers: { 'x-carthagent-token': server.token, origin: 'https://example.com' } });
  assert.equal(foreign.status, 403);
  const response = await fetch(`${server.url}/api/status`, { headers: { 'x-carthagent-token': server.token } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.workspace, server.cwd);
  assert.deepEqual(body.stepStatus, {});
});

test('dashboard status reports an available update from the release cache', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'carthagent update '));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // Seed the throttled cache so the check resolves without touching the network.
  const cachePath = join(dir, 'update-check.json');
  writeFileSync(cachePath, JSON.stringify({ checkedAt: Date.now(), release: { version: '99.0.0', tag: 'v99.0.0' } }));
  const server = await serverFixture(t, { CARTHAGENT_UPDATE_CHECK_FILE: cachePath });
  let body = {};
  for (let i = 0; i < 50 && !body.update; i++) {
    body = await (await fetch(`${server.url}/api/status`, { headers: { 'x-carthagent-token': server.token } })).json();
    if (!body.update) await new Promise(r => setTimeout(r, 50));
  }
  assert.equal(body.update.latest, '99.0.0');
  assert.equal(body.update.available, true);
  assert.ok(body.update.installed);
});

test('dashboard omits update info when the check is disabled', async t => {
  const server = await serverFixture(t, { CARTHAGENT_NO_UPDATE_CHECK: '1' });
  const body = await (await fetch(`${server.url}/api/status`, { headers: { 'x-carthagent-token': server.token } })).json();
  assert.equal(body.update, null);
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
  const checked = await approvedPost(server, 'checks/run', { id: 'all' });
  assert.equal(checked.status, 200, await checked.text());
  const status = await fetch(`${server.url}/api/status`, { headers: { 'x-carthagent-token': server.token } });
  const body = await status.json();
  assert.equal(body.plan.goal, 'Server fixture');
  assert.equal(body.evidence.smoke.passed, true);
  assert.deepEqual(body.pendingChecks, []);
});

test('dashboard preserves command evidence but rejects new-requirement coverage until rerun and records reviews', async t => {
  const server = await serverFixture(t);
  const post = (path, body) => approvedPost(server, path, body);
  const plan = { goal: 'Review API', artifacts: ['.'], steps: ['Run'], acceptance: [{ requirement: 'Runs', checks: ['smoke'] }], checks: [{ id: 'smoke', kind: 'runtime', argv: [process.execPath, 'app.mjs'], timeoutSeconds: 10 }] };
  assert.equal((await post('plan/set', { plan })).status, 200);
  assert.equal((await post('checks/run', { id: 'all' })).status, 200);
  assert.equal((await post('plan/revise', { reason: 'New boundary', patch: { acceptance: [...plan.acceptance, { requirement: 'Boundary behavior', checks: ['smoke'] }] } })).status, 200);
  const status = await (await fetch(`${server.url}/api/status`, { headers: { 'x-carthagent-token': server.token } })).json();
  assert.deepEqual(status.pendingChecks, []);
  assert.deepEqual(status.completionIssues.unverifiedRequirements, ['Boundary behavior']);
  assert.equal((await post('finish', { status: 'verified' })).status, 400);
  assert.equal((await post('checks/run', { id: 'all' })).status, 200);
  const inspected = await post('review', { action: 'inspect' });
  assert.equal(inspected.status, 200);
  const { result } = await inspected.json();
  assert.equal((await post('review', { action: 'record', captureId: result.id, coverage: ['Runs', 'Boundary behavior'].map(requirement => ({ requirement, assertions: 'Fixture command exits zero' })), probes: ['node app.mjs: ok'], findings: [], limitations: ['Fixture coverage only'] })).status, 200);
  const finished = await post('finish', { status: 'verified' });
  assert.equal(finished.status, 200);
  const { state } = await finished.json();
  assert.equal(state.handoff.reviewEvidence.id, result.id);
  assert.equal(state.handoff.evidence.smoke.executedRevision, state.revision);
});

test('dashboard rejects plan replacement and finish during checks and releases after failure', async t => {
  const server = await serverFixture(t);
  mkdirSync(join(server.cwd, 'artifacts'));
  const started = join(server.cwd, 'artifacts', 'started');
  const release = join(server.cwd, 'artifacts', 'release');
  const plan = {
    goal: 'Concurrent café check', assumptions: [], artifacts: ['.'], steps: ['Run'],
    acceptance: [{ requirement: 'Runs', checks: ['smoke'] }],
    checks: [{ id: 'smoke', kind: 'runtime', argv: [process.execPath, '-e',
      `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(started)}, 'yes'); const timer = setInterval(() => { if (fs.existsSync(${JSON.stringify(release)})) { clearInterval(timer); process.exitCode = 1; } }, 20);`
    ], timeoutSeconds: 5 }]
  };
  const post = (path, body) => approvedPost(server, path, body);
  assert.equal((await post('plan/set', { plan })).status, 200);
  const running = post('checks/run', { id: 'all' });
  const deadline = Date.now() + 4000;
  while (!existsSync(started) && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
  assert.ok(existsSync(started), 'check subprocess reached barrier');
  const competing = spawnSync(process.execPath, [join(root, 'bin/ctg.mjs'), 'check', 'all'], { cwd: server.cwd, encoding: 'utf8' });
  assert.notEqual(competing.status, 0);
  assert.match(competing.stderr, /Workspace busy/);
  const replacement = { ...plan, goal: 'Replacement' };
  assert.equal((await post('plan/set', { plan: replacement })).status, 409);
  assert.equal((await post('finish', { status: 'blocked', limitations: ['Stop'] })).status, 409);
  const status = await (await fetch(`${server.url}/api/status`, { headers: { 'x-carthagent-token': server.token } })).json();
  assert.equal(status.plan.goal, plan.goal);
  assert.deepEqual(status.evidence, {});
  writeFileSync(release, 'go');
  const result = await running;
  assert.equal(result.status, 200);
  assert.equal((await result.json()).results[0].passed, false);
  assert.equal((await post('plan/set', { plan: replacement })).status, 200);
  const after = await (await fetch(`${server.url}/api/status`, { headers: { 'x-carthagent-token': server.token } })).json();
  assert.equal(after.plan.goal, 'Replacement');
  assert.equal(after.evidence.smoke.passed, false, 'replacing an active plan preserves failure history');
  assert.equal(after.revision, status.revision + 1);
});

test('dashboard revisions preserve evidence and enforce output and step completion', async t => {
  const server = await serverFixture(t);
  const post = (path, body) => approvedPost(server, path, body);
  const status = async () => (await fetch(`${server.url}/api/status`, { headers: { 'x-carthagent-token': server.token } })).json();
  const plan = {
    goal: 'Migration report', assumptions: [], artifacts: ['app.mjs'], steps: ['Run'],
    outputs: ['artifacts/report.json'],
    acceptance: [{ requirement: 'Runs', checks: ['smoke'] }],
    checks: [{ id: 'smoke', kind: 'runtime', argv: [process.execPath, 'app.mjs'], timeoutSeconds: 10 }],
  };
  assert.equal((await post('plan/set', { plan })).status, 200);
  assert.equal((await post('checks/run', { id: 'all' })).status, 200);
  const before = await status();
  for (const patch of [null, {}, [], 'invalid', { evidence: {} }]) {
    assert.equal((await post('plan/revise', { reason: 'Invalid patch', patch })).status, 400);
  }
  assert.equal((await status()).revision, before.revision);
  assert.equal((await post('plan/revise', { reason: 'Discovered old callers', patch: { assumptions: ['Preserve compatibility'] } })).status, 200);
  const after = await status();
  assert.equal(after.runId, before.runId);
  assert.equal(after.revision, before.revision + 1);
  assert.deepEqual(after.pendingChecks, []);
  assert.equal((await post('finish', { status: 'verified' })).status, 400);
  assert.equal((await post('plan/revise', { reason: 'Try dropping report', patch: { outputs: [] } })).status, 400);
  mkdirSync(join(server.cwd, 'artifacts'));
  writeFileSync(join(server.cwd, 'artifacts/report.json'), '{}');
  assert.equal((await post('finish', { status: 'verified' })).status, 200);
  assert.equal((await post('plan/revise', { reason: 'Review a discovered caller', patch: { steps: [{ id: 'review', title: 'Review caller', checks: ['smoke'] }] } })).status, 200);
  assert.deepEqual((await status()).completionIssues.incompleteSteps, ['review']);
  assert.equal((await post('finish', { status: 'verified' })).status, 400);
  assert.equal((await post('plan/revise', { reason: 'Try dropping requirement', patch: { acceptance: [{ requirement: 'Less work', checks: ['smoke'] }] } })).status, 400);
});

test('dashboard is self-contained and does not render API data with innerHTML', async () => {
  const html = readFileSync(htmlPath, 'utf8');
  assert.doesNotMatch(html, /https?:\/\/[^'"\s]+/);
  assert.doesNotMatch(html, /\.innerHTML\s*=/);
  assert.match(html, /textContent/);
  // Active-step arrow effect is wired to live stepStatus.
  assert.match(html, /@keyframes step-arrow/);
  assert.match(html, /step-active/);
  assert.match(html, /stepStatus/);
  const rendered = await domCheck(html, [
    { selector: '.shell' },
    { selector: '#update-badge' },
    { eval: 'document.getElementById("update-badge").hidden', expect: true },
    { selector: '#planning-view' },
    { eval: `(() => { const select = document.querySelector('#planning-view'); select.value = 'architecture'; select.dispatchEvent(new Event('change')); return document.querySelector('#d2').hidden; })()`, expect: true },
    { eval: `(() => { const select = document.querySelector('#planning-view'); select.value = 'workflow'; select.dispatchEvent(new Event('change')); return document.querySelector('#planning-detail').textContent.includes('No active action recorded'); })()`, expect: true },
    { selector: '.brand', text: /Carthagent/ },
    { eval: 'document.documentElement.dataset.theme', expect: 'carthage' },
    { eval: `(() => { const option = document.querySelector('[data-theme-value="paper"]'); option.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); return document.documentElement.dataset.theme; })()`, expect: 'paper' },
    { action: 'click', selector: '[data-theme-value="carthage"]', then: { eval: 'localStorage.getItem("carthagent-theme")', expect: 'carthage' } },
    { console: 'error-free' },
  ]);
  assert.equal(rendered.pass, true, rendered.failures.join('\n'));
});


test('raw HTTP and CLI cannot run arbitrary checks before tested-plan approval', async t => {
  const server = await serverFixture(t);
  const plan = { goal: 'Gate', artifacts: ['.'], steps: ['Run'], acceptance: [{ requirement: 'Runs', checks: ['smoke'] }], checks: [{ id: 'smoke', kind: 'runtime', argv: [process.execPath, '-e', 'require("node:fs").writeFileSync("bypass.txt", "bad")'], timeoutSeconds: 10 }] };
  const saved = await fetch(`${server.url}/api/plan/set`, json(server.token, { plan }));
  assert.equal(saved.status, 200);
  const blocked = await fetch(`${server.url}/api/checks/run`, json(server.token, { id: 'all' }));
  assert.notEqual(blocked.status, 200);
  assert.match(await blocked.text(), /Implementation locked/);
  const cli = spawnSync(process.execPath, [join(root, 'bin/ctg.mjs'), 'check', 'all'], { cwd: server.cwd, encoding: 'utf8' });
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /Implementation locked/);
  assert.equal(existsSync(join(server.cwd, 'bypass.txt')), false);
});
