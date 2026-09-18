import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createReport, latestReport } from '../lib/reports.mjs';
import { buildPiArgs } from '../lib/pi.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'bin', 'pi2.mjs');

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'pi2 cli '));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFileSync(join(cwd, 'app.mjs'), 'console.log("app")\n');
  return cwd;
}

function run(cwd, ...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
}

test('status reads the newest persisted extension report', t => {
  const cwd = fixture(t);
  createReport(cwd, {
    status: 'implementing',
    plan: {
      goal: 'CLI fixture', assumptions: [], artifacts: ['.'], steps: ['Check'],
      acceptance: [{ requirement: 'Runs', checks: ['smoke'] }],
      checks: [{ id: 'smoke', kind: 'runtime', argv: [process.execPath, 'app.mjs'], timeoutSeconds: 10 }]
    },
    evidence: {}
  }, 'session');
  const result = run(cwd, 'status');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /CLI fixture/);
  assert.match(result.stdout, /pending:smoke/);
});

test('check executes declared argv and persists fresh evidence', t => {
  const cwd = fixture(t);
  createReport(cwd, {
    status: 'implementing',
    plan: {
      goal: 'CLI fixture', assumptions: [], artifacts: ['.'], steps: ['Check'],
      acceptance: [{ requirement: 'Runs', checks: ['smoke'] }],
      checks: [{ id: 'smoke', kind: 'runtime', argv: [process.execPath, 'app.mjs'], timeoutSeconds: 10 }]
    },
    evidence: {}
  }, 'session');
  const result = run(cwd, 'check', 'all');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /passed/);
  assert.equal(latestReport(cwd).state.evidence.smoke.passed, true);
});

test('check fails clearly when no delivery report exists', t => {
  const result = run(fixture(t), 'check');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No delivery report/);
});

test('guidance routing is not a user-facing command', t => {
  const result = run(fixture(t), '--help');
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /\broute\b|\bprofiles\b/);
});

test('review shows and persists the self-review default', t => {
  const cwd = fixture(t);
  const env = { ...process.env, PI2_CONFIG: join(cwd, 'config.json') };
  const runEnv = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: 'utf8' });
  assert.match(runEnv('review').stdout, /self-review default:.*ask/);
  assert.equal(runEnv('review', 'no').status, 0);
  assert.match(runEnv('review').stdout, /self-review default:.*no/);
  assert.equal(JSON.parse(readFileSync(join(cwd, 'config.json'), 'utf8')).review, 'no');
  assert.equal(runEnv('review', 'bogus').status, 2);
});

/** Fake `gh` + fake engine CLI so `pi2 review <pr>` runs end-to-end offline. */
function reviewFixture(t, verdictLine) {
  const cwd = fixture(t);
  const bin = join(cwd, 'bin');
  mkdirSync(join(cwd, 'bin'), { recursive: true });
  const gh = join(bin, 'gh');
  writeFileSync(gh, `#!/bin/sh
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then echo '{"title":"Fixture PR","url":"https://example.test/pr/14","headRefName":"feat","baseRefName":"main"}'; exit 0; fi
exit 0
`);
  chmodSync(gh, 0o755);
  const reviewer = join(cwd, 'reviewer.mjs');
  writeFileSync(reviewer, `console.log('fixture findings');\nconsole.log('${verdictLine}');\n`);
  const env = { ...process.env, PI2_CONFIG: join(cwd, 'config.json'), PI2_CLI: reviewer, PATH: `${bin}${delimiter}${process.env.PATH}` };
  return { cwd, env };
}

test('pi2 review <pr> exits 0 when the fresh reviewer approves', t => {
  const { cwd, env } = reviewFixture(t, 'VERDICT: APPROVE');
  const result = spawnSync(process.execPath, [cli, 'review', '14'], { cwd, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /fixture findings/);
  assert.match(result.stdout, /VERDICT: APPROVE/);
});

test('pi2 review <pr> exits 1 on requested changes and 2 without a verdict', t => {
  const { cwd, env } = reviewFixture(t, 'VERDICT: CHANGES-REQUESTED');
  const result = spawnSync(process.execPath, [cli, 'review', '14'], { cwd, env, encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  const silent = reviewFixture(t, 'analysis but no verdict line');
  const bad = spawnSync(process.execPath, [cli, 'review', '14'], { cwd: silent.cwd, env: silent.env, encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /no VERDICT/);
});

test('review modes launch the real bundled engine without unknown flags', t => {
  const cwd = fixture(t);
  for (const review of ['ask', 'yes', 'no']) {
    const result = spawnSync(process.execPath, [join(root, 'vendor/agent/cli.js'),
      '--offline', ...buildPiArgs({ review, isolate: true }),
      '--list-models', 'pi2-no-such-model-123'], {
      cwd, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, PI_CODING_AGENT_DIR: join(cwd, 'agent') },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /Unknown option|Failed to load extension/);
    assert.match(result.stdout + result.stderr, /No models (matching|available)/);
  }
});

test('vendored agent engine is bundled and loads ModelRuntime cleanly', async () => {
  const agentPath = join(root, 'vendor', 'agent', 'index.js');
  const agent = await import(agentPath);
  assert.equal(typeof agent.ModelRuntime, 'function');
  const runtime = await agent.ModelRuntime.create({});
  assert.ok(runtime && typeof runtime === 'object');
  assert.ok(Array.isArray(runtime.snapshot?.all));
  assert.ok(runtime.snapshot.all.length > 0);
  const providers = new Set(runtime.snapshot.all.map(m => m.provider));
  assert.ok(providers.size >= 35);
});
