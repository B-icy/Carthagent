import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fingerprint, runCommand, localPath, pendingRequirements, evidenceExcludedDirectories, evidenceFresh } from './delivery.mjs';

// Captures real Git output and new source contents. The receipt binds a
// model-authored review to a snapshot; it does not turn that review into proof.
export async function captureDeliveryReview(state, cwd, directory, signal) {
  const before = fingerprint(cwd, ['.']);
  const top = await runCommand(['git', 'rev-parse', '--show-toplevel'], { cwd, signal, timeoutSeconds: 10 });
  let text;
  if (top.code !== 0) {
    text = 'No Git repository available. Manually inspect source files and describe the review scope honestly; no diff comparison was possible.\n';
  } else {
    if (top.timedOut || top.cancelled || top.outputLimit) throw Error('Git repository discovery failed.');
    if (realpathSync.native(resolve(top.output.trim())) !== realpathSync.native(resolve(cwd))) throw Error('Review requires the workspace Git root, not an unrelated ancestor repository.');
    const log = join(directory, `diff-${randomUUID()}.log`);
    const exclusions = evidenceExcludedDirectories.map(name => `:(exclude,glob)**/${name}/**`);
    const diff = await runCommand(['git', 'diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--', '.', ...exclusions], { cwd, signal, timeoutSeconds: 30, logPath: log });
    if (diff.code !== 0 || diff.timedOut || diff.cancelled || diff.outputLimit) throw Error('Cannot capture complete Git diff (requires a committed baseline and bounded output).');
    const untrackedLog = join(directory, `untracked-${randomUUID()}.log`);
    const status = await runCommand(['git', 'ls-files', '-z', '--others', '--exclude-standard', ...evidenceExcludedDirectories.map(name => `--exclude=${name}/`)], { cwd, signal, timeoutSeconds: 10, logPath: untrackedLog });
    if (status.code !== 0 || status.cancelled || status.timedOut || status.outputLimit) throw Error('Cannot enumerate untracked files for review.');
    text = `Review scope excludes dependency/cache/output directories: ${evidenceExcludedDirectories.join(', ')}.\n${readFileSync(log, 'utf8')}\nNew source files:\n`;
    for (const name of readFileSync(untrackedLog, 'utf8').split('\0').filter(Boolean).sort()) {
      const path = localPath(cwd, name);
      if (statSync(path).size > 1024 * 1024) throw Error(`New file too large for review capture: ${JSON.stringify(name)}. Inspect it separately or narrow the workspace.`);
      const bytes = readFileSync(path);
      text += `\n--- New file ${JSON.stringify(name)} ---\n`;
      text += bytes.includes(0) ? `[Binary: ${bytes.length} bytes; sha256 ${createHash('sha256').update(bytes).digest('hex')}; inspect with an appropriate viewer.]\n` : `${bytes.toString('utf8')}\n`;
      if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw Error('New source review capture exceeds 8 MiB; narrow the workspace.');
    }
  }
  if (signal?.aborted || before !== fingerprint(cwd, ['.'])) throw Error('Workspace changed or review capture was cancelled; retry after edits stop.');
  const id = randomUUID(), path = join(directory, `review-${id}.txt`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  const capture = { id, runId: state.runId, revision: state.revision, fingerprint: before, path, digest: createHash('sha256').update(text).digest('hex'), at: new Date().toISOString() };
  state.reviewCapture = capture;
  delete state.reviewEvidence;
  return { ...capture, diff: text.slice(0, 12000), truncated: text.length > 12000, unresolvedFindings: (state.reviewFindings || []).filter(f => !f.resolution), next: 'Read the full capture path if truncated; new text source is included. Inspect binary assets separately. Probe critical component connections and user outcomes, not only individual functions or artifact existence. Record coverage, findings and limitations; earlier findings require explicit resolutions with evidence, never silently move them to limitations.' };
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
