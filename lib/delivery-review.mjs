import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fingerprint, runCommand, localPath, pendingRequirements } from './delivery.mjs';

// Captures real Git output, including a list of new files. The receipt binds a
// model-authored review to a snapshot; it does not turn that review into proof.
export async function captureDeliveryReview(state, cwd, directory, signal) {
  const before = fingerprint(cwd, ['.']);
  const top = await runCommand(['git', 'rev-parse', '--show-toplevel'], { cwd, signal, timeoutSeconds: 10 });
  let text;
  if (top.code !== 0) {
    text = 'No Git repository available. Manually inspect source files and describe the review scope honestly; no diff comparison was possible.\n';
  } else {
    if (top.timedOut || top.cancelled || top.outputLimit) throw Error('Git repository discovery failed.');
    if (resolve(top.output.trim()) !== resolve(cwd)) throw Error('Review requires the workspace Git root, not an unrelated ancestor repository.');
    const log = join(directory, `diff-${randomUUID()}.log`);
    const diff = await runCommand(['git', 'diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--'], { cwd, signal, timeoutSeconds: 30, logPath: log });
    if (diff.code !== 0 || diff.timedOut || diff.cancelled || diff.outputLimit) throw Error('Cannot capture complete Git diff (requires a committed baseline and bounded output).');
    const untrackedLog = join(directory, `untracked-${randomUUID()}.log`);
    const status = await runCommand(['git', 'ls-files', '--others', '--exclude-standard'], { cwd, signal, timeoutSeconds: 10, logPath: untrackedLog });
    if (status.code !== 0 || status.cancelled || status.timedOut || status.outputLimit) throw Error('Cannot enumerate untracked files for review.');
    text = `${readFileSync(log, 'utf8')}\nUntracked files (inspect their contents separately):\n${readFileSync(untrackedLog, 'utf8')}`;
  }
  if (signal?.aborted || before !== fingerprint(cwd, ['.'])) throw Error('Workspace changed or review capture was cancelled; retry after edits stop.');
  const id = randomUUID(), path = join(directory, `review-${id}.txt`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  const capture = { id, runId: state.runId, revision: state.revision, fingerprint: before, path, digest: createHash('sha256').update(text).digest('hex'), at: new Date().toISOString() };
  state.reviewCapture = capture;
  delete state.reviewEvidence;
  return { ...capture, diff: text.slice(0, 12000), truncated: text.length > 12000, next: 'Read the diff (full path if truncated), inspect listed new files, run boundary/metamorphic probes, then call delivery_review action=record with this captureId, per-requirement coverage, findings and limitations. Fix unresolved findings before recording.' };
}

export function recordDeliveryReview(state, cwd, params) {
  const capture = state.reviewCapture;
  const hash = fingerprint(cwd, ['.']);
  if (!capture || capture.id !== params.captureId || capture.runId !== state.runId || capture.revision !== state.revision || capture.fingerprint !== hash) throw Error('Review capture missing or stale. Use delivery_review action=inspect after final source edits.');
  if (pendingRequirements(state, hash).length) throw Error('Run fresh checks for every requirement before recording review.');
  const nonempty = value => typeof value === 'string' && value.trim().length > 0;
  if (!Array.isArray(params.coverage) || (state.plan.acceptance || []).some(a => !params.coverage.some(c => c.requirement === a.requirement && nonempty(c.assertions)))) throw Error('Review coverage must explain concrete assertions for every exact acceptance requirement, including required validators.');
  if (!Array.isArray(params.probes) || !params.probes.length || params.probes.some(p => !nonempty(p))) throw Error('Record boundary/metamorphic probes and observed results, not just a generic review claim.');
  if (!Array.isArray(params.findings) || params.findings.some(p => !nonempty(p))) throw Error('findings must be an array; unresolved findings require repairs or a blocked handoff.');
  if (params.findings.length) throw Error('Unresolved review findings: repair them or finish blocked.');
  if (!Array.isArray(params.limitations) || params.limitations.some(p => !nonempty(p))) throw Error('Review limitations must be an array.');
  const actual = createHash('sha256').update(readFileSync(localPath(cwd, capture.path))).digest('hex');
  if (actual !== capture.digest) throw Error('Review capture was modified; inspect again.');
  state.reviewEvidence = { ...capture, coverage: structuredClone(params.coverage), probes: [...params.probes], findings: [], limitations: [...params.limitations], evidence: structuredClone(state.evidence), recordedAt: new Date().toISOString() };
  delete state.handoff;
  state.status = 'implementing';
  return state.reviewEvidence;
}
