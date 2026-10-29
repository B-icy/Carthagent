// Pure, browser/native-safe counterpart of the backend's selected-evidence
// policy. This validates shape/bytes, not truth, secrets, or assessment quality.
const invalid = () => new Error('invalid_daily_evidence');
const bytes = value => new TextEncoder().encode(value).byteLength;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hex = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== keys.length
    || keys.some(key => {
      const d = Object.getOwnPropertyDescriptor(value, key);
      return !d?.enumerable || !Object.hasOwn(d, 'value');
    })) throw invalid();
}
function text(value, limit) {
  if (typeof value !== 'string' || bytes(value) > limit
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\p{Cs}]/u.test(value)) throw invalid();
  return value.replace(/\r\n?/g, '\n').trim();
}
function identifier(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) throw invalid();
  return value.toLowerCase();
}
function list(value, limit) {
  if (!Array.isArray(value) || value.length > limit || Reflect.ownKeys(value).length !== value.length + 1) throw invalid();
  for (let i = 0; i < value.length; i++) {
    if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, String(i)) ?? {}, 'value')) throw invalid();
  }
  return value;
}
export function canonicalDailyEvidence(value) {
  exact(value, ['projectId', 'outcomeId', 'runId', 'revision', 'goal', 'change', 'checks', 'findings']);
  const revision = identifier(value.revision, hex);
  const canonical = {
    projectId: identifier(value.projectId, uuid), outcomeId: identifier(value.outcomeId, uuid), runId: identifier(value.runId, uuid), revision,
    goal: text(value.goal, 1024), change: text(value.change, 3072),
    checks: list(value.checks, 12).map(check => {
      exact(check, ['name', 'before', 'after', 'revision', 'result']);
      if (!['failed', 'not_run'].includes(check.before) || !['passed', 'failed', 'not_run'].includes(check.after)) throw invalid();
      const checkedRevision = identifier(check.revision, hex);
      if (check.after === 'passed' && checkedRevision !== revision) throw invalid();
      return { name: text(check.name, 160), before: check.before, after: check.after, revision: checkedRevision, result: text(check.result, 1024) };
    }),
    findings: list(value.findings, 5).map(finding => {
      exact(finding, ['issue', 'evidence', 'resolution']);
      return { issue: text(finding.issue, 768), evidence: text(finding.evidence, 1536), resolution: text(finding.resolution, 1024) };
    }),
  };
  if (bytes(JSON.stringify(canonical)) > 12288) throw invalid();
  return canonical;
}
export function dailyRequest(id, evidence) {
  const request = { id: identifier(id, uuid), consent: true, evidence: canonicalDailyEvidence(evidence) };
  if (bytes(JSON.stringify(request)) > 16384) throw invalid();
  return request;
}
