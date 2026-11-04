import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { questConditions, questStatus, questReset, assessmentFeedback } from '../plugins/carthagent/src/ui/quest-presentation.mjs';

const page = await readFile(new URL('../plugins/carthagent/src/ui/daily-quests.tsx', import.meta.url), 'utf8');
const quest = { id: 'q', status: 'open', definition: { templateId: 'tests-regression-v1', criteria: [{ id: 'outcome' }, { id: 'focus' }, { id: 'regression' }] } };
test('conditions distinguish recorded passing checks from before-and-after regression evidence', () => {
  const evidence = { goal: 'Fix input', change: 'Reject negative input', revision: 'a', findings: [], checks: [{ before: 'not_run', after: 'passed', revision: 'a', result: 'negative input rejected' }] };
  assert.equal(questConditions(quest, evidence)[2].detected, false);
  evidence.checks[0].before = 'failed';
  assert.equal(questConditions(quest, evidence)[2].detected, true);
  evidence.checks[0].revision = 'b';
  assert.equal(questConditions(quest, evidence)[2].detected, false);
  assert.equal(questStatus(quest), 'Choose work');
});
test('authoritative results and unresolved sends have distinct visible states', () => {
  const record = { questId: 'q', createdAt: '2026-11-03', submission: null };
  assert.equal(questStatus(quest, [record]), 'Check submission status');
  record.submission = { status: 'queued' };
  assert.equal(questStatus(quest, [record]), 'Checking your submission…');
  record.submission = { status: 'graded', decision: 'needs_evidence', scores: { outcome: 1, focus: 1, regression: 0.4 } };
  assert.deepEqual(assessmentFeedback(quest, record.submission), ['Explain the same test failing on the defect and passing after the fix. A setup or syntax error alone is not regression evidence. Use Details → Edit selected work → Edit change summary.']);
  assert.equal(questStatus({ ...quest, status: 'assessed_complete' }, [record]), 'Complete');
});
test('reset label is bounded at expiry', () => {
  assert.equal(questReset('2026-11-04T00:00:00Z', Date.parse('2026-11-03T23:30:00Z')), 'Resets in 0h 30m');
  assert.equal(questReset('2026-11-04T00:00:00Z', Date.parse('2026-11-05T00:00:00Z')), 'Closed for today');
});
test('normal quest flow uses selected work, explicit Submit and bounded actions', () => {
  assert.doesNotMatch(page, /<textarea|Validate and preview|Consent and submit/);
  assert.match(page, /option\(state.preview \? "Submit"/);
  assert.match(page, /height=\{Math.min\(4, options\(\).length\)\} flexShrink=\{0\}/);
  assert.match(page, /Submit shares this work with Carthagent & its assessor/);
  assert.match(page, /Metadata: 90 days/);
  assert.match(page, /handleDailyQuestsEvent/);
  assert.match(page, /source.checks.map/);
  assert.doesNotMatch(page, /session\.export|file\.read|outputTail/);
});
