import { canonicalDailyEvidence } from '../daily-evidence.mjs';

/** Keep whole claims in the submission budget; never silently cut a finding in half. */
export function selectedQuestEvidence(evidence, kind) {
  const selected = { ...evidence, checks: [], findings: [] };
  canonicalDailyEvidence(selected);
  let omitted = 0;
  // Before/after regression records and resolved review findings are the most useful evidence.
  const checks = [...evidence.checks].sort((a, b) => Number(b.before === 'failed' && b.after === 'passed') - Number(a.before === 'failed' && a.after === 'passed'));
  const entries = [];
  for (let i = 0; i < Math.max(checks.length, evidence.findings.length); i++) {
    const pair = [['checks', checks[i]], ['findings', evidence.findings[i]]];
    entries.push(...(kind === 'review' ? pair.reverse() : pair));
  }
  for (const [field, entry] of entries) {
    if (entry) {
      selected[field].push(entry);
      try { canonicalDailyEvidence(selected); }
      catch { selected[field].pop(); omitted++; }
    }
  }
  return { evidence: canonicalDailyEvidence(selected), omitted };
}
