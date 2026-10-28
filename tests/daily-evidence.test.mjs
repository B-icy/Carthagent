import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalDailyEvidence, dailyRequest } from '../plugins/carthagent/src/daily-evidence.mjs';

const ID = 'ABCDEF01-2345-6789-ABCD-EF0123456789';
const REV = 'A'.repeat(40);
const evidence = () => ({ projectId: ID, outcomeId: ID, runId: ID, revision: REV, goal: '  A goal\r\nline  ', change: 'A change', checks: [{ name: 'test', before: 'failed', after: 'passed', revision: REV, result: 'Observed passing check' }], findings: [{ issue: 'Issue', evidence: 'Observation', resolution: 'Resolved' }] });
const invalid = value => assert.throws(() => canonicalDailyEvidence(value), { message: 'invalid_daily_evidence' });
test('canonical evidence has backend field ordering, lowercase identifiers, LF and trim; preserves astral pairs', () => {
  const e = evidence(); e.change = '\r valid \u{1f680} \r';
  const c = canonicalDailyEvidence(e);
  assert.equal(c.goal, 'A goal\nline'); assert.equal(c.change, 'valid \u{1f680}');
  assert.equal(c.projectId, ID.toLowerCase()); assert.equal(c.revision, REV.toLowerCase());
  assert.deepEqual(Object.keys(c), ['projectId', 'outcomeId', 'runId', 'revision', 'goal', 'change', 'checks', 'findings']);
  assert.deepEqual(canonicalDailyEvidence(c), c);
  assert.deepEqual(dailyRequest(ID, e), { id: ID.toLowerCase(), consent: true, evidence: c });
  assert.throws(() => dailyRequest('bad-id', e), { message: 'invalid_daily_evidence' });
});
test('exact fields, plain data records, dense arrays, limits and enums fail closed', () => {
  for (const mutate of [
    e => { e.extra = true; }, e => { delete e.runId; }, e => { e.checks[0].extra = true; }, e => { delete e.findings[0].issue; },
    e => { e.projectId = 'not-a-uuid'; }, e => { e.revision = 'a'.repeat(41); }, e => { e.checks[0].after = 'ok'; },
    e => { e.checks[0].before = 'passed'; }, e => { e.checks[0].revision = 'b'.repeat(40); },
    e => { e.checks = Array(1); }, e => { e.findings = Array(1); }, e => { e.checks.extra = true; },
    e => { e.checks = Array.from({ length: 13 }, () => e.checks[0]); }, e => { e.findings = Array.from({ length: 6 }, () => e.findings[0]); },
    e => { Object.defineProperty(e, 'goal', { get() { throw new Error('must not read getter'); }, enumerable: true }); },
    e => { e.checks = [Object.create(e.checks[0])]; }, e => { e[Symbol('extra')] = true; },
  ]) { const e = evidence(); mutate(e); invalid(e); }
  const e = evidence(); e.checks[0].after = 'failed'; e.checks[0].revision = 'b'.repeat(64);
  assert.equal(canonicalDailyEvidence(e).checks[0].revision.length, 64);
});
test('rejects controls and lone surrogates before normalization and bounds UTF8, not character count', () => {
  for (const value of ['\u0000', '\u000b', '\u001f', '\u007f', '\u0085', '\ud800', '\udfff', 'x\ud800y']) {
    const e = evidence(); e.goal = value; invalid(e);
  }
  for (const [field, limit] of [['goal', 1024], ['change', 3072]]) {
    const e = evidence(); e[field] = ' '.repeat(limit + 1); invalid(e);
    e[field] = 'é'.repeat(limit / 2); assert.equal(canonicalDailyEvidence(e)[field], e[field]);
    e[field] += 'a'; invalid(e);
  }
  for (const [collection, index, field, limit] of [['checks', 0, 'name', 160], ['checks', 0, 'result', 1024], ['findings', 0, 'issue', 768], ['findings', 0, 'evidence', 1536], ['findings', 0, 'resolution', 1024]]) {
    const e = evidence(); e[collection][index][field] = ' '.repeat(limit + 1); invalid(e);
  }
});
test('canonical aggregate evidence limit is exact, includes escaping, request is bounded', () => {
  const e = evidence(); e.goal = 'g'.repeat(1024); e.change = 'c'.repeat(3072);
  e.checks = Array.from({ length: 7 }, () => ({ name: 'n', before: 'failed', after: 'passed', revision: REV, result: 'r'.repeat(1024) }));
  e.findings = [];
  while (Buffer.byteLength(JSON.stringify(canonicalDailyEvidence({ ...e, checks: e.checks.slice(0, -1) }))) > 12288) e.checks.pop();
  const base = { ...e, checks: e.checks.slice(0, -1) };
  let last = canonicalDailyEvidence(base);
  // Fill another bounded field to find the precise canonical edge.
  base.findings = [{ issue: '', evidence: '', resolution: '' }];
  for (let n = 0; n <= 1536; n++) {
    base.findings[0].evidence = 'x'.repeat(n);
    try { last = canonicalDailyEvidence(base); } catch {
      assert.equal(Buffer.byteLength(JSON.stringify(last)), 12288); invalid(base);
      assert.ok(Buffer.byteLength(JSON.stringify(dailyRequest(ID, last))) <= 16384); return;
    }
  }
  assert.fail('fixture must reach evidence byte boundary');
});
