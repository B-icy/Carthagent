import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, chmodSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, delimiter } from 'node:path';
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
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: nativeRouteEnv(cwd) });
}

function nativeRouteEnv(cwd) {
  const runtimeRoot = join(cwd, 'native-runtime');
  mkdirSync(join(runtimeRoot, 'lib', 'opencode'), { recursive: true });
  writeFileSync(join(runtimeRoot, 'lib', 'opencode', 'runtime.mjs'), 'export const runtimeEnvironment = () => ({});\n');
  writeFileSync(join(runtimeRoot, 'lib', 'opencode', 'service.mjs'), 'export const ensureService = async () => { throw new Error("native launcher route reached"); };\n');
  writeFileSync(join(runtimeRoot, 'lib', 'opencode', 'headless.mjs'), 'export {};\n');
  copyFileSync(join(root, 'lib', 'opencode', 'session-options.mjs'), join(runtimeRoot, 'lib', 'opencode', 'session-options.mjs'));
  copyFileSync(join(root, 'lib', 'budget.mjs'), join(runtimeRoot, 'lib', 'budget.mjs'));
  return { ...process.env, CTG_NATIVE: '0', CTG_NATIVE_RUNTIME_ROOT: runtimeRoot };
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

test('check refuses an extension-era report that native acceptance has not approved', t => {
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
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /Implementation locked/);
  assert.notEqual(latestReport(cwd).state.evidence.smoke?.passed, true);
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

test('ctg defaults to native domain dispatch and keeps help/version provider-independent', t => {
  const cwd = fixture(t);
  const env = nativeRouteEnv(cwd);
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

  const headless = invoke('-p', '--no-guide', 'native headless fixture');
  assert.equal(headless.status, 1);
  assert.match(headless.stderr, /native launcher route reached/);
  assert.doesNotMatch(headless.stdout + headless.stderr, /PI_CODING_AGENT_DIR|vendor\/agent\/cli/);

  const version = invoke('--version');
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);

  const help = invoke('--help');
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /native OpenCode delivery console/);
  assert.doesNotMatch(help.stdout, /split-terminal/);
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

test('Cloud account commands dispatch through native runtime and never Pi fallback', t => {
  const cwd = fixture(t);
  const env = { ...nativeRouteEnv(cwd), CARTHAGENT_CODING_AGENT_DIR: join(cwd, 'agent'), PI_CODING_AGENT_DIR: join(cwd, 'agent') };
  for (const args of [['account'], ['billing'], ['logout-cloud']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /native launcher route reached/);
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

/** Fake `gh` + fake engine CLI so `ctg review <pr>` runs end-to-end offline. */
function reviewFixture(t, verdictLine) {
  const cwd = fixture(t);
  const bin = join(cwd, 'bin');
  mkdirSync(join(cwd, 'bin'), { recursive: true });
  const gh = join(bin, 'gh');
  writeFileSync(gh, `#!/bin/sh
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then echo '{"title":"Fixture PR","url":"https://example.test/pr/14","headRefName":"feat","baseRefName":"main","headRefOid":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'; exit 0; fi
exit 0
`);
  chmodSync(gh, 0o755);
  // Native executable fixture: Windows cannot execute a POSIX shebang shim.
  if (process.platform === 'win32') {
    copyFileSync(process.execPath, join(bin, 'gh.exe'));
    writeFileSync(join(cwd, 'gh-preload.cjs'), `if (require('node:path').basename(process.execPath).toLowerCase() === 'gh.exe') { console.log(JSON.stringify({title:'Fixture PR',url:'https://example.test/pr/14',headRefName:'feat',baseRefName:'main',headRefOid:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'})); process.exit(0); }`);
  }
  const reviewer = join(cwd, 'reviewer.mjs');
  writeFileSync(reviewer, `const prompt = process.argv.at(-1); const snapshot = /snapshot:"([a-f0-9]+)"/.exec(prompt)?.[1]; const head = /head:"([a-f0-9]+)"/.exec(prompt)?.[1]; console.log('fixture findings'); console.log('REVIEW_JSON: ' + JSON.stringify({version:1,snapshot,head,findings:${JSON.stringify(verdictLine.includes('CHANGES-REQUESTED') ? [{file:'app.mjs',line:1,severity:'blocking',issue:'fixture issue',fix:'fixture fix'}] : [])}})); console.log('${verdictLine}');\n`);
  const env = { ...nativeRouteEnv(cwd), CARTHAGENT_CONFIG: join(cwd, 'config.json'), CARTHAGENT_CLI: reviewer, PATH: `${bin}${delimiter}${process.env.PATH}` };
  if (process.platform === 'win32') env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --require ${JSON.stringify(join(cwd, 'gh-preload.cjs'))}`;
  return { cwd, env };
}

test('ctg review <pr> uses native service dispatch, not the legacy Pi reviewer', t => {
  const { cwd, env } = reviewFixture(t, 'VERDICT: APPROVE');
  const result = spawnSync(process.execPath, [cli, 'review', '14'], { cwd, env, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /native launcher route reached/);
  assert.doesNotMatch(result.stdout, /fixture findings|VERDICT:/);
});

test('review verdict fixtures do not intercept native review dispatch', t => {
  const { cwd, env } = reviewFixture(t, 'VERDICT: CHANGES-REQUESTED');
  const result = spawnSync(process.execPath, [cli, 'review', '14'], { cwd, env, encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /native launcher route reached/);
  const silent = reviewFixture(t, 'analysis but no verdict line');
  const bad = spawnSync(process.execPath, [cli, 'review', '14'], { cwd: silent.cwd, env: silent.env, encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /native launcher route reached/);
});

test('review admission fixture cannot intercept native review dispatch', t => {
  const { cwd, env } = reviewFixture(t, 'VERDICT: CHANGES-REQUESTED');
  for (let i = 0; i < 3; i++) {
    const result = spawnSync(process.execPath, [cli, 'review', '14'], { cwd, env, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /native launcher route reached/);
  }
  const exhausted = spawnSync(process.execPath, [cli, 'review', '14'], { cwd, env, encoding: 'utf8' });
  assert.equal(exhausted.status, 1);
  assert.match(exhausted.stderr, /native launcher route reached/);
  assert.doesNotMatch(exhausted.stdout, /fixture findings/);
});

test('review mutation fixture cannot intercept native review dispatch', t => {
  const { cwd, env } = reviewFixture(t, 'VERDICT: APPROVE');
  writeFileSync(join(cwd, 'reviewer.mjs'), `import {writeFileSync} from 'node:fs'; writeFileSync('changed.txt', 'café'); console.log('VERDICT: APPROVE');`);
  const changed = spawnSync(process.execPath, [cli, 'review', '14'], { cwd, env, encoding: 'utf8' });
  assert.equal(changed.status, 1);
  assert.match(changed.stderr, /native launcher route reached/);
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

test('ctg --list-models uses native model listing and ignores legacy Pi model stores', t => {
  const cwd = fixture(t);
  const agentDir = join(cwd, 'agent');
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'auth.json'), JSON.stringify({
    'experiential-labs': { type: 'api_key', key: 'fixture-credential' },
  }));
  writeFileSync(join(agentDir, 'models-store.json'), JSON.stringify({
    'experiential-labs': {
      models: [{ id: 'carthagent-code', name: 'carthagent-code' }],
      checkedAt: 1,
    },
  }));
  const result = spawnSync(process.execPath, [cli, '--list-models', 'Carthagent Ship'], {
    cwd,
    encoding: 'utf8',
    env: {
      ...nativeRouteEnv(cwd),
      PI_OFFLINE: '1',
      CARTHAGENT_CODING_AGENT_DIR: agentDir,
      PI_CODING_AGENT_DIR: agentDir,
    },
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /native launcher route reached/);
  assert.doesNotMatch(result.stdout, /fixture-credential|carthagent-code/);
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
    const result = spawnSync(process.execPath, [cli, '-p', ...args], { cwd, env: nativeRouteEnv(cwd), encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /native launcher route reached|Missing value|integer|require/);
    assert.doesNotMatch(result.stdout + result.stderr, /vendor\/agent\/cli|PI_CODING_AGENT_DIR/);
  }
});
