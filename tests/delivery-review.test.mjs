import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { captureDeliveryReview, recordDeliveryReview } from '../lib/delivery-review.mjs';
import { evidenceIdentity, fingerprint, completionIssues, revisePlan } from '../lib/delivery.mjs';

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'delivery review café '));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = args => execFileSync('git', args, { cwd, stdio: 'pipe' });
  writeFileSync(join(cwd, '.gitignore'), '.harness/\n');
  writeFileSync(join(cwd, 'app.mjs'), 'export const amount = 1;\n');
  git(['init', '-q']); git(['add', '.']);
  git(['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-qm', 'Baseline']);
  writeFileSync(join(cwd, 'app.mjs'), 'export const amount = 2;\n');
  writeFileSync(join(cwd, 'new.mjs'), 'export const result = 2;\n');
  const check = { id: 'unit', kind: 'test', argv: ['node', '--test'], timeoutSeconds: 10 };
  const state = { runId: 'a', revision: 1, plan: { goal: 'Repair money', artifacts: ['.'], steps: [{ id: 'fix', title: 'Fix' }], acceptance: [{ requirement: 'Correct amount', checks: ['unit'] }], checks: [check] }, evidence: {}, stepStatus: { step0: 'done' } };
  state.evidence.unit = { ...evidenceIdentity(state, check), passed: true, fingerprint: fingerprint(cwd, ['.']) };
  const params = captureId => ({ captureId, coverage: [{ requirement: 'Correct amount', assertions: 'app amount equals 2' }], probes: ['node assert amount: 2, passed'], findings: [], limitations: ['Fixture assertion review'] });
  return { cwd, state, params, dir: join(cwd, '.harness', 'review') };
}

test('review captures real diff/new files and binds complete assertions to final snapshot', async t => {
  const { cwd, state, params, dir } = fixture(t);
  const capture = await captureDeliveryReview(state, cwd, dir);
  assert.match(capture.diff, /-export const amount = 1/);
  assert.match(capture.diff, /\+export const amount = 2/);
  assert.match(capture.diff, /new.mjs/);
  assert.equal(readFileSync(capture.path, 'utf8'), capture.diff);
  assert.throws(() => recordDeliveryReview(state, cwd, { ...params(capture.id), coverage: [] }), /every exact/);
  assert.throws(() => recordDeliveryReview(state, cwd, { ...params(capture.id), probes: [] }), /boundary/);
  assert.match(capture.diff, /export const result = 2/);
  recordDeliveryReview(state, cwd, params(capture.id));
  assert.deepEqual(state.reviewEvidence.evidence, state.evidence);
  assert.ok(Object.values(completionIssues(state, cwd, fingerprint(cwd, ['.']))).every(a => !a.length));
  const revised = revisePlan(state, { assumptions: ['Additional investigation'] }, { cwd, hash: fingerprint(cwd, ['.']), reason: 'Refine' });
  assert.equal(revised.reviewEvidence, undefined);
  assert.ok(revised.revisions[0].reviewEvidence);
  writeFileSync(join(cwd, 'new.mjs'), 'changed');
  assert.throws(() => recordDeliveryReview(state, cwd, params(capture.id)), /stale/);
  assert.equal(completionIssues(state, cwd, fingerprint(cwd, ['.'])).review.length, 1);
});

test('findings survive empty submissions, recapture, restart and plan revisions until explicitly resolved', async t => {
  const { cwd, state, params, dir } = fixture(t);
  let capture = await captureDeliveryReview(state, cwd, dir);
  recordDeliveryReview(state, cwd, params(capture.id));
  const rejected = recordDeliveryReview(state, cwd, { ...params(capture.id), findings: ['Movement integration untested'] });
  assert.equal(rejected.recorded, false);
  assert.equal(state.reviewEvidence, undefined);
  assert.match(completionIssues(state, cwd, fingerprint(cwd, ['.'])).review[0], /Movement integration/);
  const restored = JSON.parse(JSON.stringify(state));
  capture = await captureDeliveryReview(restored, cwd, dir);
  assert.equal(recordDeliveryReview(restored, cwd, { ...params(capture.id), limitations: ['Movement integration untested'] }).recorded, false);
  const revised = revisePlan(restored, { assumptions: ['More evidence needed'] }, { cwd, hash: fingerprint(cwd, ['.']), reason: 'Refine' });
  assert.equal(revised.reviewFindings[0].id, rejected.unresolvedFindings[0].id);
  assert.throws(() => recordDeliveryReview(restored, cwd, { ...params(capture.id), resolutions: [{ id: 'invented', change: 'fixed', evidence: 'test passed' }] }), /Unknown/);
  recordDeliveryReview(restored, cwd, { ...params(capture.id), resolutions: [{ id: rejected.unresolvedFindings[0].id, change: 'Added input-to-state integration probe', evidence: 'W at five headings matches camera-forward displacement' }] });
  assert.ok(restored.reviewEvidence.findingHistory[0].resolution);
  const retry = { ...params(capture.id), findings: ['Movement integration untested'], resolutions: [{ id: rejected.unresolvedFindings[0].id, change: 'Added input-to-state integration probe', evidence: 'W at five headings matches camera-forward displacement' }] };
  recordDeliveryReview(restored, cwd, retry);
  assert.equal(restored.reviewFindings.length, 1);
  recordDeliveryReview(restored, cwd, retry);
  assert.equal(restored.reviewFindings.length, 1);
  assert.deepEqual(completionIssues(restored, cwd, fingerprint(cwd, ['.'])).review, []);
});

test('explicit unverified coverage blocks acceptance even with passing checks', async t => {
  const { cwd, state, params, dir } = fixture(t);
  const capture = await captureDeliveryReview(state, cwd, dir);
  const p = params(capture.id); p.coverage[0].status = 'unverified';
  assert.equal(recordDeliveryReview(state, cwd, p).recorded, false);
  assert.match(state.reviewFindings[0].description, /Acceptance gap/);
  assert.equal(recordDeliveryReview(state, cwd, params(capture.id)).recorded, false);
});

test('outcome coverage binds actual linked receipts and retains missing user behavior', async t => {
  const { cwd, state, params, dir } = fixture(t);
  state.plan.outcomes = [{ id:'launch',requirement:'Correct amount',entrypoint:'node app.mjs',observable:'Output is 2',substitutions:[],missedFailure:'Internal function works but launch fails',checks:['unit'] }];
  const capture = await captureDeliveryReview(state,cwd,dir);
  assert.throws(()=>recordDeliveryReview(state,cwd,params(capture.id)),/exactly one outcome/);
  const outcome = {id:'launch',check:'missing',observation:'printed 2',challenge:'bad input rejected',status:'demonstrated'};
  assert.throws(()=>recordDeliveryReview(state,cwd,{...params(capture.id),outcomes:[outcome]}),/linked check receipt/);
  outcome.check='unit';outcome.status='unverified';outcome.observation='Only alternate test mode exercised';
  assert.equal(recordDeliveryReview(state,cwd,{...params(capture.id),outcomes:[outcome]}).recorded,false);
  outcome.status='demonstrated';outcome.observation='Normal launch printed 2';
  const result=recordDeliveryReview(state,cwd,{...params(capture.id),outcomes:[outcome],resolutions:[{id:state.reviewFindings[0].id,change:'Executed normal launch',evidence:'Launch printed 2 and rejected malformed input'}]});
  assert.deepEqual(result.outcomes[0].receipt,state.evidence.unit);
});

test('capture includes new unicode source contents but excludes unignored dependency and generated trees', async t => {
  const { cwd, state, dir } = fixture(t);
  for (const name of ['.venv', 'node_modules', 'artifacts', '.harness']) {
    mkdirSync(join(cwd, name), { recursive: true });
    writeFileSync(join(cwd, name, 'noise.txt'), 'DO_NOT_CAPTURE_DEPENDENCY_CONTENT');
  }
  writeFileSync(join(cwd, 'new café.txt'), 'critical integration assertion');
  const capture = await captureDeliveryReview(state, cwd, dir);
  assert.match(capture.diff, /critical integration assertion/);
  assert.doesNotMatch(capture.diff, /DO_NOT_CAPTURE_DEPENDENCY_CONTENT|noise.txt/);
});

test('review rejects modified receipts, stale coverage, and cancellation', async t => {
  const { cwd, state, params, dir } = fixture(t);
  const capture = await captureDeliveryReview(state, cwd, dir);
  state.requirementRevisions = { 'Correct amount': 2 };
  assert.throws(() => recordDeliveryReview(state, cwd, params(capture.id)), /fresh checks/);
  delete state.requirementRevisions;
  writeFileSync(capture.path, 'forged diff');
  assert.throws(() => recordDeliveryReview(state, cwd, params(capture.id)), /modified/);
  await assert.rejects(captureDeliveryReview(state, cwd, dir, AbortSignal.abort()), /cancelled/);
});

test('review accepts filesystem aliases of the Git root but rejects ancestor repositories', async t => {
  const { cwd, state } = fixture(t);
  const parent = mkdtempSync(join(tmpdir(), 'review-alias-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const link = join(parent, 'alias');
  symlinkSync(dirname(cwd), link, process.platform === 'win32' ? 'junction' : 'dir');
  const alias = join(link, basename(cwd));
  const capture = await captureDeliveryReview(state, alias, join(alias, '.harness', 'review'));
  assert.match(capture.diff, /diff --git/);
  const child = join(cwd, 'nested');
  mkdirSync(child);
  await assert.rejects(captureDeliveryReview(state, child, join(child, '.harness')), /workspace Git root/);
});

test('large diffs retain full receipt instead of silently using output tail', async t => {
  const { cwd, state, dir } = fixture(t);
  writeFileSync(join(cwd, 'app.mjs'), 'export const amount = 2;\n' + '// meaningful review line\n'.repeat(900));
  const capture = await captureDeliveryReview(state, cwd, dir);
  assert.equal(capture.truncated, true);
  assert.ok(readFileSync(capture.path, 'utf8').length > 12000);
  assert.match(capture.diff, /diff --git/);
});
