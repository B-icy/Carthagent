#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { once } from 'node:events';
import { nativeFixture, streamText } from './native-fixture.mjs';
import { stopService } from '../lib/opencode/service.mjs';

const root = resolve(import.meta.dirname, '..');
let verdict = 'APPROVE';
let reviews = 0;
let mutateSource = false;
const host = await nativeFixture({ respond(body, response) {
  const text = JSON.stringify(body.messages);
  const snapshot = text.match(/Snapshot(?: SHA-256)?: ([a-f0-9]+)/)?.[1];
  const head = text.match(/HEAD: ([a-f0-9]+)/)?.[1];
  if (!snapshot || !head || !text.includes('REVIEW_JSON:')) return streamText(response, 'NATIVE_DEFAULT_EXECUTABLE_OK');
  reviews++;
  if (mutateSource) execFileSync(process.execPath, ['-e', 'require("node:fs").writeFileSync("mutated.txt", "changed during review")'], { cwd: mutationWorkspace });
  const findings = verdict === 'CHANGES-REQUESTED' ? [{ file: 'fixture.txt', line: 1, severity: 'blocking', issue: 'Fixture content needs repair.', fix: 'Repair fixture content.' }] : [];
  return streamText(response, verdict === 'MISSING' ? 'No verdict was supplied.' : `Native reviewer fixture.\nREVIEW_JSON: ${JSON.stringify({ version: 1, snapshot, head, findings })}\nVERDICT: ${verdict}`);
} });
const profileRoot = join(host.temp, 'cli-profile');
const mutationWorkspace = join(host.temp, 'mutation-workspace');
const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
Object.assign(env, {
  HOME: join(host.temp, 'cli-home'), USERPROFILE: join(host.temp, 'cli-home'),
  CTG_OPENCODE_HOME: profileRoot,
  CARTHAGENT_CONFIG: join(host.temp, 'carthagent-config.json'),
});
if (host.runtimeIdentity.kind === 'ctg-owned') env.CTG_OWNED_OPENCODE_RUNTIME = dirname(dirname(dirname(host.runtimeIdentity.binary)));
else env.CTG_OPENCODE_BIN = host.runtimeIdentity.binary;
async function cli(args, cwd = host.cwd) {
  const child = spawn(process.execPath, [join(root, 'bin/ctg.mjs'), ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const timer = setTimeout(() => child.kill('SIGTERM'), 45_000);
  try { const [code] = await once(child, 'close'); return { code, output }; }
  finally { clearTimeout(timer); }
}
function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
async function baseline(cwd) {
  await mkdir(cwd, { recursive: true });
  git(cwd, 'init', '--initial-branch=main');
  await writeFile(join(cwd, 'fixture.txt'), 'baseline\n');
  await writeFile(join(cwd, 'task.txt'), 'Review the exact fixture content.\n');
  git(cwd, 'add', 'fixture.txt', 'task.txt');
  git(cwd, '-c', 'user.name=openhands', '-c', 'user.email=openhands@all-hands.dev', 'commit', '-m', 'Native executable fixture\n\nCo-authored-by: openhands <openhands@all-hands.dev>');
}
try {
  await mkdir(join(profileRoot, 'config/opencode'), { recursive: true });
  const config = JSON.parse(await readFile(join(host.temp, 'config/opencode/opencode.json'), 'utf8'));
  config.providers.lattice = { ...config.providers['ctg-fixture'], models: { 'gpt-6-luna': config.providers['ctg-fixture'].models.fixture } };
  await writeFile(join(profileRoot, 'config/opencode/opencode.json'), JSON.stringify(config));
  const result = await cli(['-p', '--no-guide', '--no-delivery', '--model', 'ctg-fixture/fixture', 'Native default executable fixture']);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /NATIVE_DEFAULT_EXECUTABLE_OK/);
  const models = await cli(['--list-models', 'ctg-fixture']);
  assert.equal(models.code, 0, models.output);
  assert.match(models.output, /fixture/);
  const account = await cli(['account']);
  assert.equal(account.code, 1, account.output);
  assert.match(account.output, /not signed in|connect|login/i);
  await baseline(host.cwd);
  const reviewArgs = ['review', 'workspace', '--request-file', 'task.txt', '--timeout', '20'];
  const approved = await cli(reviewArgs);
  assert.equal(approved.code, 0, approved.output);
  assert.match(approved.output, /VERDICT: APPROVE/);
  const calls = reviews;
  const duplicate = await cli(reviewArgs);
  assert.equal(duplicate.code, 2, duplicate.output);
  assert.match(duplicate.output, /already approved/i);
  assert.equal(reviews, calls);
  await writeFile(join(host.cwd, 'fixture.txt'), 'changed source\n');
  verdict = 'CHANGES-REQUESTED';
  const changed = await cli(reviewArgs);
  assert.equal(changed.code, 1, changed.output);
  assert.match(changed.output, /VERDICT: CHANGES-REQUESTED/);
  await writeFile(join(host.cwd, 'fixture.txt'), 'third source\n');
  verdict = 'MISSING';
  const missing = await cli(reviewArgs);
  assert.equal(missing.code, 2, missing.output);
  assert.match(missing.output, /VERDICT|structured/i);
  const beforeLimit = reviews;
  const limited = await cli(reviewArgs);
  assert.equal(limited.code, 2, limited.output);
  assert.match(limited.output, /round limit/i);
  assert.equal(reviews, beforeLimit);
  await baseline(mutationWorkspace);
  verdict = 'APPROVE';
  mutateSource = true;
  const mutated = await cli(reviewArgs, mutationWorkspace);
  assert.equal(mutated.code, 2, mutated.output);
  assert.match(mutated.output, /source.*(?:changed|moved)|snapshot changed/i);
  const stopped = await cli(['service', 'stop']);
  assert.equal(stopped.code, 0, stopped.output);
  const restarted = await cli(['native', '-p', '--no-guide', '--no-delivery', '--model', 'ctg-fixture/fixture', 'Native alias after service restart']);
  assert.equal(restarted.code, 0, restarted.output);
  assert.match(restarted.output, /NATIVE_DEFAULT_EXECUTABLE_OK/);
  console.log(JSON.stringify({ runtime: host.runtimeIdentity.runtimeVersion, executable: 'default ctg without opt-in', headless: 'passed', modelDiscovery: 'passed', accountFailClosed: 'passed', reviewApprovalChangesAndMalformedVerdict: 'passed', persistedReviewAdmission: 'passed', reviewSourceMutationRejected: 'passed', explicitServiceStopAndRestart: 'passed', reviewRequests: reviews }));
} finally {
  await stopService({ root: profileRoot }).catch(() => {});
  await host.close();
}
