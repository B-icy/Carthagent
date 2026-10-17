import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { approveFixture } from './helpers/tested-design.mjs';
import { createReport, latestReport, saveReport } from '../lib/reports.mjs';
import { buildEngineArgs } from '../lib/engine.mjs';
import { initPrRepository, mutatePullRequestRemote, nativeCliFixture, setPullRequestFixture } from './helpers/native-cli-process.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'bin', 'ctg.mjs');

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'carthagent cli '));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFileSync(join(cwd, 'app.mjs'), 'console.log("app")\n');
  return cwd;
}

function run(cwd, ...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
}

test('ctg defaults to native domain routing and keeps help/version independent of providers', t => {
  const cwd = fixture(t);
  const runtimeRoot = join(cwd, 'native-runtime');
  mkdirSync(join(runtimeRoot, 'lib', 'opencode'), { recursive: true });
  writeFileSync(join(runtimeRoot, 'lib', 'opencode', 'runtime.mjs'), 'export const runtimeEnvironment = () => ({});\n');
  writeFileSync(join(runtimeRoot, 'lib', 'opencode', 'service.mjs'), 'export const ensureService = async () => { throw new Error("native launcher route reached"); };\n');
  writeFileSync(join(runtimeRoot, 'lib', 'opencode', 'headless.mjs'), 'export {};\n');
  const env = { ...process.env, CTG_NATIVE: '0', CTG_NATIVE_RUNTIME_ROOT: runtimeRoot };
  const invoke = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: 'utf8' });

  const status = invoke('status', '--json');
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).workspace, cwd);

  const hash = invoke('hash');
  assert.equal(hash.status, 0, hash.stderr);
  assert.match(hash.stdout.trim(), /^[a-f0-9]{64}$/);

  const account = invoke('account');
  assert.equal(account.status, 1);
  assert.match(account.stderr, /native launcher route reached/);

  const version = invoke('--version');
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);

  const help = invoke('--help');
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /native OpenCode delivery console/);
  assert.doesNotMatch(help.stdout, /split-terminal/);
});

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
  const report = latestReport(cwd);
  saveReport(report.path, approveFixture(report.state, cwd));
  const result = run(cwd, 'check', 'all');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /passed/);
  assert.equal(latestReport(cwd).state.evidence.smoke.passed, true);
});

test('structured headless mode forwards JSON events and status offers a parseable snapshot', t => {
  assert.deepEqual(buildEngineArgs({ json: true, delivery: false }).slice(0, 2), ['--mode', 'json']);
  assert.equal(buildEngineArgs({ delivery: false }).includes('--mode'), false);
  const result = run(fixture(t), 'status', '--json');
  assert.equal(result.status, 0, result.stderr);
  const snapshot = JSON.parse(result.stdout);
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.state, null);
  assert.equal(snapshot.completionIssues, null);
  assert.match(snapshot.currentFingerprint, /^[a-f0-9]{64}$/);
});

test('check fails clearly when no delivery report exists', t => {
  const result = run(fixture(t), 'check');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No delivery report/);
});

test('guidance routing is not a user-facing command and Ship account commands are documented', t => {
  const result = run(fixture(t), '--help');
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /\broute\b|\bprofiles\b/);
  assert.match(result.stdout, /account.*Ship credit/);
  assert.match(result.stdout, /billing.*checkout\|portal/);
  assert.match(result.stdout, /logout-cloud/);
});

test('Cloud account commands fail closed when no browser session is stored', t => {
  const cwd = fixture(t);
  const env = { ...process.env, CARTHAGENT_CODING_AGENT_DIR: join(cwd, 'agent'), PI_CODING_AGENT_DIR: join(cwd, 'agent') };
  for (const args of [['account'], ['billing'], ['logout-cloud']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /not signed in/);
  }
});

test('review shows and persists the self-review default', t => {
  const cwd = fixture(t);
  const env = { ...process.env, CARTHAGENT_CONFIG: join(cwd, 'config.json') };
  const runEnv = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: 'utf8' });
  assert.match(runEnv('review').stdout, /self-review default:.*ask/);
  assert.equal(runEnv('review', 'no').status, 0);
  assert.match(runEnv('review').stdout, /self-review default:.*no/);
  assert.equal(JSON.parse(readFileSync(join(cwd, 'config.json'), 'utf8')).review, 'no');
  writeFileSync(join(cwd, 'app.mjs'), 'review fixture source\n');
  spawnSync('git', ['init', '-q'], { cwd });
  spawnSync('git', ['add', '.'], { cwd });
  spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], { cwd });
  assert.equal(runEnv('review', 'bogus').status, 2);
});

test('ctg review <pr> exits 0 when the native reviewer approves', async t => {
  const fixture = await nativeCliFixture(t);
  initPrRepository(fixture);
  const result = await fixture.run('review', '14');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /VERDICT: APPROVE/);
});

test('ctg review <pr> exits 1 on requested changes and 2 without a verdict', async t => {
  const requested = await nativeCliFixture(t, { verdict: 'CHANGES-REQUESTED' });
  initPrRepository(requested);
  const result = await requested.run('review', '14');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /VERDICT: CHANGES-REQUESTED/);

  const silent = await nativeCliFixture(t, { omitVerdict: true });
  initPrRepository(silent);
  const bad = await silent.run('review', '14');
  assert.equal(bad.status, 2, bad.stderr);
  assert.match(bad.stderr, /exact structured VERDICT line/);
});

test('review persists admission limits across fresh native CLI processes', async t => {
  const fixture = await nativeCliFixture(t, { verdict: 'CHANGES-REQUESTED' });
  initPrRepository(fixture);
  for (let i = 0; i < 3; i++) {
    const result = await fixture.run('review', '14');
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /VERDICT: CHANGES-REQUESTED/);
  }
  const exhausted = await fixture.run('review', '14');
  assert.equal(exhausted.status, 2, exhausted.stderr);
  assert.match(exhausted.stderr, /round limit/);
  assert.doesNotMatch(exhausted.stdout, /VERDICT:/);
});

test('native PR review rejects remote mutation and invalid execution bounds', async t => {
  const fixture = await nativeCliFixture(t);
  initPrRepository(fixture);
  mutatePullRequestRemote(fixture);
  const mutation = await fixture.run('review', '14');
  assert.equal(mutation.status, 2, mutation.stderr);
  assert.match(mutation.stderr, /refs or source moved while review was running/);

  for (const value of ['0', '301', 'Infinity', 'invalid']) {
    setPullRequestFixture(fixture);
    const invalid = await fixture.run('review', '14', '--timeout', value);
    assert.equal(invalid.status, 2, invalid.stderr);
    assert.match(invalid.stderr, /integer from 1 to 300/);
  }
});

test('buildEngineArgs always loads the Experiential provider extension', () => {
  const args = buildEngineArgs({ isolate: true, delivery: false });
  const extensionPaths = args.flatMap((arg, index) => arg === '-e' ? [args[index + 1]] : []);
  assert.ok(extensionPaths.some(path => path.endsWith(join('extensions', 'experiential.ts'))));
});

test('ctg --list-models reads native OpenCode model inventory without exposing credentials', async t => {
  const fixture = await nativeCliFixture(t);
  writeFileSync(join(fixture.cwd, 'private-sentinel.txt'), 'offline-fixture-token-must-not-appear');
  const result = await fixture.run('--list-models', 'fixture');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /lattice\s+gpt-6-luna\s+32000\s+1024\s+\?\s+\?/);
  assert.doesNotMatch(result.stdout, /offline-fixture|private-sentinel/i);
  assert.doesNotMatch(result.stderr, /offline-fixture|private-sentinel/i);
});

test('review modes launch the real bundled engine without unknown flags', t => {
  const cwd = fixture(t);
  for (const review of ['ask', 'yes', 'no']) {
    const result = spawnSync(process.execPath, [join(root, 'vendor/agent/cli.js'),
      '--offline', ...buildEngineArgs({ review, isolate: true }),
      '--list-models', 'carthagent-no-such-model-123'], {
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
  const agent = await import(pathToFileURL(agentPath).href);
  assert.equal(typeof agent.ModelRuntime, 'function');
  const runtime = await agent.ModelRuntime.create({});
  assert.ok(runtime && typeof runtime === 'object');
  assert.ok(Array.isArray(runtime.snapshot?.all));
  assert.ok(runtime.snapshot.all.length > 0);
  const providers = new Set(runtime.snapshot.all.map(m => m.provider));
  assert.ok(providers.size >= 35);
});

test('CLI rejects invalid, missing and disabled-extension budget options', t => {
  const cwd = fixture(t);
  for (const args of [['--max-tools'], ['--max-seconds', 'NaN', 'task'], ['--no-delivery', '--max-tools', '1', 'task']]) {
    const result = spawnSync(process.execPath, [cli, '-p', ...args], { cwd, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Missing value|must be an integer|require the delivery/);
  }
});
