import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, chmodSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, delimiter } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createReport, latestReport } from '../lib/reports.mjs';
import { buildPiArgs } from '../lib/pi.mjs';

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
  const env = { ...process.env, CARTHAGENT_CONFIG: join(cwd, 'config.json'), CARTHAGENT_CLI: reviewer, PATH: `${bin}${delimiter}${process.env.PATH}` };
  if (process.platform === 'win32') env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --require ${JSON.stringify(join(cwd, 'gh-preload.cjs'))}`;
  return { cwd, env };
}

test('ctg review <pr> exits 0 when the fresh reviewer approves', t => {
  const { cwd, env } = reviewFixture(t, 'VERDICT: APPROVE');
  const result = spawnSync(process.execPath, [cli, 'review', '14'], { cwd, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /fixture findings/);
  assert.match(result.stdout, /VERDICT: APPROVE/);
});

test('ctg review <pr> exits 1 on requested changes and 2 without a verdict', t => {
  const { cwd, env } = reviewFixture(t, 'VERDICT: CHANGES-REQUESTED');
  const result = spawnSync(process.execPath, [cli, 'review', '14'], { cwd, env, encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  const silent = reviewFixture(t, 'analysis but no verdict line');
  const bad = spawnSync(process.execPath, [cli, 'review', '14'], { cwd: silent.cwd, env: silent.env, encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /no VERDICT/);
});

test('review persists admission limits across fresh CLI processes', t => {
  const { cwd, env } = reviewFixture(t, 'VERDICT: CHANGES-REQUESTED');
  for (let i = 0; i < 3; i++) {
    const result = spawnSync(process.execPath, [cli, 'review', '14'], { cwd, env, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
  }
  const exhausted = spawnSync(process.execPath, [cli, 'review', '14'], { cwd, env, encoding: 'utf8' });
  assert.equal(exhausted.status, 2);
  assert.match(exhausted.stderr, /round limit/);
  assert.doesNotMatch(exhausted.stdout, /fixture findings/);
});

test('review rejects source mutation and invalid execution bounds', t => {
  const { cwd, env } = reviewFixture(t, 'VERDICT: APPROVE');
  writeFileSync(join(cwd, 'reviewer.mjs'), `import {writeFileSync} from 'node:fs'; writeFileSync('changed.txt', 'café'); console.log('VERDICT: APPROVE');`);
  const changed = spawnSync(process.execPath, [cli, 'review', '14'], { cwd, env, encoding: 'utf8' });
  assert.equal(changed.status, 2);
  assert.match(changed.stderr, /snapshot changed/);
  for (const value of ['0', '301', 'Infinity', 'invalid']) {
    const invalid = spawnSync(process.execPath, [cli, 'review', '14', '--timeout', value], { cwd, env, encoding: 'utf8' });
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /integer from 1 to 300/);
  }
});

test('review modes launch the real bundled engine without unknown flags', t => {
  const cwd = fixture(t);
  for (const review of ['ask', 'yes', 'no']) {
    const result = spawnSync(process.execPath, [join(root, 'vendor/agent/cli.js'),
      '--offline', ...buildPiArgs({ review, isolate: true }),
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
