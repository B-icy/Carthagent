import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beginReview, parseFindings } from '../lib/review-state.mjs';

test('review lock, persisted rounds, approval and escalation fail closed', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'review café '));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const first = beginReview(cwd, 'pr', 'source', 'head');
  assert.throws(() => beginReview(cwd, 'pr', 'source', 'head'), /running/);
  first.finish('approved', {}); first.release();
  assert.throws(() => beginReview(cwd, 'pr', 'source', 'head'), /already approved/);
  for (let i = 0; i < 2; i++) {
    const next = beginReview(cwd, 'pr', `changed${i}`, 'head');
    next.finish('changes-requested', {}); next.release();
  }
  assert.throws(() => beginReview(cwd, 'pr', 'new', 'newhead'), /round limit/);
  const interrupted = beginReview(cwd, 'other', 'source', 'head');
  interrupted.release();
  assert.throws(() => beginReview(cwd, 'other', 'source', 'head'), /Interrupted/);
});

test('structured findings reject absent, stale, malformed and contradictory data', () => {
  const data = {version:1,snapshot:'source',head:'head',findings:[]};
  const output = value => `REVIEW_JSON: ${JSON.stringify(value)}\nVERDICT: APPROVE`;
  assert.deepEqual(parseFindings(output(data), 'source', 'head', 'APPROVE'), data);
  for (const bad of [null, {}, {...data,head:'stale'}, {...data,findings:[{}]}]) assert.throws(() => parseFindings(output(bad), 'source', 'head', 'APPROVE'));
  assert.throws(() => parseFindings(output(data), 'source', 'head', 'CHANGES-REQUESTED'), /contradicts/);
  assert.throws(() => parseFindings('VERDICT: APPROVE', 'source', 'head', 'APPROVE'), /Missing/);
});
