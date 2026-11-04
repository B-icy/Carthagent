// Presentation only: detection never replaces the server's assessment.
const templates = {
  'change-behavior-v1': ['Improve a behavior', 'Explain the old behavior, the change, and the result.'],
  'change-boundary-v1': ['Handle an edge case', 'Handle a specific boundary or invalid input safely.'],
  'change-contract-v1': ['Repair a broken contract', 'Restore the expected interface or data contract.'],
  'tests-regression-v1': ['Catch a regression', 'Show the same test failing before the fix and passing afterward.'],
  'tests-boundary-v1': ['Test an edge case', 'Add a regression test that protects a specific boundary.'],
  'tests-contract-v1': ['Test a contract', 'Catch an interface or data-contract violation with a regression test.'],
  'review-correctness-v1': ['Resolve a review finding', 'Resolve a concrete correctness issue found in review.'],
  'review-failure-v1': ['Review a failure path', 'Resolve a concrete failure-handling risk found in review.'],
  'review-contract-v1': ['Review a contract', 'Resolve a concrete compatibility or contract concern.'],
};
export function questCopy(quest) {
  const [title, goal] = templates[quest.definition.templateId] ?? [quest.definition.title, 'Meet the conditions below.'];
  return { title, goal };
}
export function questConditions(quest, evidence) {
  const checks = evidence?.checks ?? [];
  const passing = checks.some(c => c.after === 'passed' && c.revision === evidence.revision && c.result.trim());
  const labels = {
    outcome: ['Describe the goal and completed change', !!(evidence?.goal.trim() && evidence?.change.trim())],
    focus: [questCopy(quest).goal, false],
    validation: ['Record a passing check on this change', passing],
    regression: ['Record the same test failing before and passing after', checks.some(c => c.before === 'failed' && c.after === 'passed' && c.revision === evidence.revision && c.result.trim())],
    finding: ['Record an issue, supporting evidence, and its resolution', evidence?.findings.some(f => f.issue.trim() && f.evidence.trim() && f.resolution.trim()) ?? false],
  };
  return quest.definition.criteria.map(c => ({ id: c.id, text: labels[c.id]?.[0] ?? c.text, detected: labels[c.id]?.[1] ?? false }));
}
export function questReset(endsAt, now = Date.now()) {
  const minutes = Math.max(0, Math.ceil((Date.parse(endsAt) - now) / 60000));
  return minutes === 0 ? 'Closed for today' : `Resets in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
export function questStatus(quest, records = []) {
  if (quest.status === 'assessed_complete') return 'Complete';
  const record = records.filter(r => r.questId === quest.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!record) return 'Choose work';
  if (!record.submission) return 'Check submission status';
  return submissionText(record.submission);
}
export function submissionText(s) {
  if (s.status === 'queued' || s.status === 'grading') return 'Checking your submission…';
  if (s.status === 'failed') return 'Assessment unavailable. Try again later.';
  if (s.decision === 'assessed_complete') return 'Quest complete';
  if (s.decision === 'not_met') return 'Conditions not met yet';
  return 'More evidence needed';
}
export function assessmentFeedback(quest, submission) {
  if (!submission || submission.status !== 'graded' || submission.decision === 'assessed_complete') return [];
  return questConditions(quest).filter(c => (submission.scores?.[c.id] ?? 0) < 0.9).map(c => {
    if (quest.definition.templateId === 'tests-regression-v1' && c.id === 'focus') return 'Name the assertion that caught the original defect, including its expected and actual result.';
    if (c.id === 'regression') return 'Explain the same test failing on the defect and passing after the fix. A setup or syntax error alone is not regression evidence. Use Details → Edit selected work → Edit change summary.';
    return c.text;
  });
}
