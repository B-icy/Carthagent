import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  REVIEW_MODES, normalizeReviewMode, resolveReviewMode,
  loadPi2Config, savePi2Config, shouldOfferReview,
  reviewKickoff, reviewerPrompt, parseVerdict,
} from '../lib/review.mjs';

function configFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pi2 review config '));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'config.json');
}

test('review modes normalize strictly to ask|yes|no', () => {
  assert.deepEqual(REVIEW_MODES, ['ask', 'yes', 'no']);
  for (const [input, expected] of [['ask', 'ask'], [' YES ', 'yes'], ['No', 'no'], ['', null], ['always', null], [undefined, null], [42, null]]) {
    assert.equal(normalizeReviewMode(input), expected, JSON.stringify(input));
  }
});

test('config persists atomically and merges patches', t => {
  const path = configFixture(t);
  assert.deepEqual(loadPi2Config(path), {});
  savePi2Config({ review: 'yes' }, path);
  savePi2Config({ other: 1 }, path);
  const config = loadPi2Config(path);
  assert.equal(config.review, 'yes');
  assert.equal(config.other, 1);
  writeFileSync(path, 'not json');
  assert.deepEqual(loadPi2Config(path), {});
});

test('resolveReviewMode precedence: explicit flag > config > ask default', t => {
  const path = configFixture(t);
  assert.equal(resolveReviewMode(undefined, loadPi2Config(path)), 'ask');
  savePi2Config({ review: 'no' }, path);
  assert.equal(resolveReviewMode(undefined, loadPi2Config(path)), 'no');
  assert.equal(resolveReviewMode('yes', loadPi2Config(path)), 'yes');
  assert.equal(resolveReviewMode('garbage', loadPi2Config(path)), 'no');
});

test('shouldOfferReview gates on mode, evidence of change and prior offers', () => {
  const offered = new Set();
  const base = { mode: 'ask', verified: true, writes: 0, loopActive: false, offeredRuns: offered, runKey: 's@1' };
  assert.equal(shouldOfferReview(base), true);
  assert.equal(shouldOfferReview({ ...base, mode: 'yes' }), false, 'yes mode is auto-kicked, never prompted');
  assert.equal(shouldOfferReview({ ...base, mode: 'no' }), false);
  assert.equal(shouldOfferReview({ ...base, verified: false, writes: 2 }), true, 'file edits qualify');
  assert.equal(shouldOfferReview({ ...base, verified: false, writes: 0 }), false, 'read-only runs do not qualify');
  assert.equal(shouldOfferReview({ ...base, loopActive: true }), false);
  offered.add('s@1');
  assert.equal(shouldOfferReview(base), false, 'no duplicate offers for the same run');
});

test('kickoff instructs the PR → fresh review → fixes loop with a round cap', () => {
  const text = reviewKickoff('/abs/bin/pi2.mjs');
  assert.match(text, /gh pr create/);
  assert.match(text, /node "\/abs\/bin\/pi2\.mjs" review <pr-number-or-url>/);
  assert.match(text, /VERDICT: APPROVE/);
  assert.match(text, /VERDICT: CHANGES-REQUESTED/);
  assert.match(text, /3 review rounds/);
  assert.match(text, /do not simulate a review/i);
});

test('reviewer prompt is read-only, fresh-context and ends in a verdict', () => {
  const text = reviewerPrompt({ prRef: '14', cwd: '/repo', meta: { title: 'Add feature', headRefName: 'feat', baseRefName: 'main' } });
  assert.match(text, /fresh-context code reviewer/);
  assert.match(text, /"14"/);
  assert.match(text, /"\/repo"/);
  assert.match(text, /PR title: Add feature/);
  assert.match(text, /feat → main/);
  assert.match(text, /Do not modify files, commit, push/);
  assert.match(text, /VERDICT: APPROVE/);
  assert.match(text, /VERDICT: CHANGES-REQUESTED/);
});

test('parseVerdict reads the final verdict line only', () => {
  assert.equal(parseVerdict('analysis...\nVERDICT: APPROVE\n'), 'APPROVE');
  assert.equal(parseVerdict('findings...\nVERDICT: CHANGES-REQUESTED\n'), 'CHANGES-REQUESTED');
  assert.equal(parseVerdict('verdict: changes-requested'), 'CHANGES-REQUESTED');
  assert.equal(parseVerdict('no verdict here'), null);
  assert.equal(parseVerdict(''), null);
  // The LAST verdict wins — the prompt's format example or mid-analysis
  // mentions must not shadow the reviewer's actual final line.
  assert.equal(parseVerdict('finish with: VERDICT: APPROVE\n...\nVERDICT: CHANGES-REQUESTED\n'), 'CHANGES-REQUESTED');
  assert.equal(parseVerdict('VERDICT: CHANGES-REQUESTED ... wait, actually fine\nVERDICT: APPROVE\n'), 'APPROVE');
});
