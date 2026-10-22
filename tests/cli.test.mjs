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

test('default CLI and its native alias always use the native console, even with the old opt-out variable', t => {
  const cwd = fixture(t);
  for (const prefix of [[], ['native']]) {
    const result = spawnSync(process.execPath, [cli, ...prefix, '--help'], { cwd, encoding: 'utf8', env: { ...process.env, CTG_NATIVE: '0' } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Launch the native Carthagent delivery console/);
    assert.doesNotMatch(result.stdout, /split-terminal|opt-in native|live plan\.d2 side panel/);
    assert.match(result.stdout, /ctg service stop/);
  }
});

test('native runtime selection never falls back to a legacy engine override', t => {
  const cwd = fixture(t);
  const missing = join(cwd, 'missing-native-runtime');
  const fallback = join(cwd, 'legacy.mjs');
  const marker = join(cwd, 'legacy-started');
  writeFileSync(fallback, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'unexpected');`);
  const result = spawnSync(process.execPath, [cli, '-p', '--engine-cli', missing, '--no-delivery', '--max-tools', '1', 'Task'], {
    cwd, encoding: 'utf8', timeout: 10000, env: { ...process.env, CTG_NATIVE: '0', CARTHAGENT_CLI: fallback },
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /missing-native-runtime/);
  assert.throws(() => readFileSync(marker), { code: 'ENOENT' });
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

test('native account commands fail closed instead of consuming legacy engine credentials', t => {
  const cwd = fixture(t);
  const agent = join(cwd, 'legacy-agent');
  mkdirSync(agent);
  writeFileSync(join(agent, 'auth.json'), JSON.stringify({ 'experiential-labs': { type: 'api_key', key: 'legacy-fixture-credential' } }));
  const env = { ...process.env, CTG_OPENCODE_BIN: join(cwd, 'missing-native-runtime'), CARTHAGENT_CODING_AGENT_DIR: agent, PI_CODING_AGENT_DIR: agent };
  for (const args of [['account'], ['billing'], ['logout-cloud']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /missing-native-runtime/);
    assert.doesNotMatch(result.stdout + result.stderr, /legacy-fixture-credential/);
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
  assert.equal(runEnv('review', 'bogus').status, 2);
});

test('native review rejects invalid targets and bounds before resolving a host', t => {
  const cwd = fixture(t);
  for (const args of [['review', 'bogus'], ['review', '14', '--timeout', '0'], ['review', '14', '--timeout', '301'], ['review', '14', '--timeout', 'Infinity'], ['review', '14', '--timeout', 'invalid']]) {
    const result = run(cwd, ...args);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /Invalid review target|integer from 1 to 300/);
  }
});

test('buildEngineArgs always loads the Experiential provider extension', () => {
  const args = buildEngineArgs({ isolate: true, delivery: false });
  const extensionPaths = args.flatMap((arg, index) => arg === '-e' ? [args[index + 1]] : []);
  assert.ok(extensionPaths.some(path => path.endsWith(join('extensions', 'experiential.ts'))));
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

test('native model listing cannot silently fall back to legacy cached model metadata', t => {
  const cwd = fixture(t);
  const agent = join(cwd, 'legacy-agent');
  mkdirSync(agent);
  writeFileSync(join(agent, 'models-store.json'), JSON.stringify({ 'experiential-labs': { models: [{ id: 'legacy-only-model' }], checkedAt: 1 } }));
  const result = spawnSync(process.execPath, [cli, '--list-models'], { cwd, encoding: 'utf8', env: {
    ...process.env, CTG_OPENCODE_BIN: join(cwd, 'missing-native-runtime'), CARTHAGENT_CODING_AGENT_DIR: agent, PI_CODING_AGENT_DIR: agent,
  } });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /missing-native-runtime/);
  assert.doesNotMatch(result.stdout, /legacy-only-model/);
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

test('native CLI rejects invalid and missing budget options', t => {
  const cwd = fixture(t);
  for (const args of [['--max-tools'], ['--max-seconds', 'NaN', 'task'], ['--no-delivery', '--max-tools', '-1', 'task']]) {
    const result = spawnSync(process.execPath, [cli, '-p', ...args], { cwd, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Missing value|must be an integer|non-negative/);
  }
});
