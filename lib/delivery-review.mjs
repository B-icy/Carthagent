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
  if (params.coverage.some(c => c.status !== undefined && !['demonstrated', 'unverified'].includes(c.status))) throw Error('Coverage status must be demonstrated or unverified.');
  if (!Array.isArray(params.probes) || !params.probes.length || params.probes.some(p => !nonempty(p))) throw Error('Record boundary/metamorphic probes and observed results, not just a generic review claim.');
  if (!Array.isArray(params.findings) || params.findings.some(p => !nonempty(p))) throw Error('findings must be an array; unresolved findings require repairs or a blocked handoff.');
  if (!Array.isArray(params.limitations) || params.limitations.some(p => !nonempty(p))) throw Error('Review limitations must be an array.');
  const actual = createHash('sha256').update(readFileSync(localPath(cwd, capture.path))).digest('hex');
  if (actual !== capture.digest) throw Error('Review capture was modified; inspect again.');
  const outcomeEvidence = [];
  for (const outcome of state.plan.outcomes || []) {
    const records = (params.outcomes || []).filter(o => o.id === outcome.id);
    if (records.length !== 1) throw Error(`Record exactly one outcome review for ${outcome.id}: id, check, observation, challenge, status.`);
    const record = records[0];
    if (!['demonstrated', 'unverified'].includes(record.status) || !nonempty(record.observation) || !nonempty(record.challenge)) throw Error(`Outcome ${outcome.id} needs observed results and an executed challenge, or explicit unverified status.`);
    const check = state.plan.checks.find(c => c.id === record.check);
    if (!outcome.checks.includes(record.check) || !check || !evidenceFresh(check, state.evidence[record.check], hash, state)) throw Error(`Outcome ${outcome.id} requires a fresh passing linked check receipt.`);
    outcomeEvidence.push({ ...record, contract: structuredClone(outcome), receipt: structuredClone(state.evidence[record.check]) });
  }
  const resolutions = params.resolutions || [];
  if (!Array.isArray(resolutions) || resolutions.some(r => !r || !nonempty(r.id) || !nonempty(r.change) || !nonempty(r.evidence))) throw Error('resolutions require id, change and evidence.');
  const findings = structuredClone(state.reviewFindings || []);
  for (const r of resolutions) {
    const finding = findings.find(f => f.id === r.id);
    if (!finding) throw Error(`Unknown review finding: ${r.id}. Use an ID returned by inspect or record; do not invent IDs.`);
    if (finding.resolution) {
      if (finding.resolution.change === r.change && finding.resolution.evidence === r.evidence) continue;
      throw Error(`Already resolved review finding: ${r.id}. Existing resolution history cannot be overwritten.`);
    }
    finding.resolution = { ...r, captureId: capture.id, fingerprint: hash, at: new Date().toISOString() };
  }
  const gaps = params.coverage.filter(c => c.status === 'unverified').map(c => `Acceptance gap: ${c.requirement}: ${c.assertions}`);
  gaps.push(...outcomeEvidence.filter(o => o.status === 'unverified').map(o => `Outcome gap: ${o.id}: ${o.observation}`));
  for (const description of [...params.findings, ...gaps]) {
    const resolvedHere = findings.some(f => f.description === description && resolutions.some(r => r.id === f.id));
    if (!resolvedHere && !findings.some(f => !f.resolution && f.description === description)) findings.push({ id: randomUUID(), description, captureId: capture.id, fingerprint: hash, at: new Date().toISOString() });
  }
  state.reviewFindings = findings;
  delete state.handoff;
  state.status = 'implementing';
  if (findings.some(f => !f.resolution)) {
    delete state.reviewEvidence;
    return { recorded: false, unresolvedFindings: findings.filter(f => !f.resolution), next: 'Findings saved. Repair and recheck, then provide resolutions:[{id,change,evidence}], or finish blocked. Empty findings or limitations cannot clear earlier findings.' };
  }
  state.reviewEvidence = { ...capture, coverage: structuredClone(params.coverage), outcomes: outcomeEvidence, probes: [...params.probes], findings: [], findingHistory: findings, limitations: [...params.limitations], evidence: structuredClone(state.evidence), recordedAt: new Date().toISOString() };
  return state.reviewEvidence;
}
