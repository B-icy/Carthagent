import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { beginReview, parseFindings } from '../review-state.mjs';

function textFrom(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach(item => textFrom(item, output));
  else if (value && typeof value === 'object') {
    if (value.type === 'text' && typeof value.text === 'string') output.push(value.text);
    else Object.values(value).forEach(item => textFrom(item, output));
  }
  return output;
}

function reviewVerdict(output) {
  const line = output.trim().split(/\r?\n/).at(-1);
  const match = /^VERDICT: (APPROVE|CHANGES-REQUESTED)$/.exec(line || '');
  if (!match) throw Error('Reviewer output must end with an exact structured VERDICT line');
  return match[1];
}

function localSource(root, git) {
  const diff = git('diff', 'HEAD', '--binary');
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(path => path && path !== '.harness' && !path.startsWith('.harness/')).sort();
  return `${diff}\0UNTRACKED\0${untracked.map(path => `${path}\0${readFileSync(join(root, path)).toString('base64')}`).join('\0')}`;
}

export function createReviewSnapshot({ source, head }) {
  return createHash('sha256').update(`${source}\0${head}`).digest('hex');
}

/** Local delivery review. This does not approve or merge a remote PR. */
export async function startReview({ ctx, cwd, identity = 'local-delivery', model = { providerID: 'lattice', id: 'gpt-6-luna', variant: 'high' }, agent = 'reviewer' }) {
  const root = resolve(cwd);
  const git = async (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const head = await git('rev-parse', 'HEAD');
  const source = localSource(root, git);
  const snapshot = createReviewSnapshot({ source, head });
  const admission = beginReview(root, identity, snapshot, head);
  let reviewer;
  try {
    reviewer = await ctx.session.create({ title: `CTG review: ${identity}`, agent, model, location: { directory: root }, permissions: [{ action: 'edit', resource: '**', effect: 'deny' }, { action: 'bash', resource: '**', effect: 'deny' }] });
    const prompt = `Review this exact local delivery source at ${root}. This is a read-only local delivery review, not a PR review. Do not modify files, commit, push, or merge.\nHEAD: ${head}\nSnapshot SHA-256: ${snapshot}\n\nReview the working-tree diff against HEAD. Report findings and end with REVIEW_JSON: {"version":1,"snapshot":"${snapshot}","head":"${head}","findings":[]} followed by VERDICT: APPROVE or VERDICT: CHANGES-REQUESTED.`;
    await ctx.session.prompt({ sessionID: reviewer.id, text: prompt });
    await ctx.session.wait({ sessionID: reviewer.id });
    const messages = await ctx.session.context({ sessionID: reviewer.id });
    const output = textFrom(messages).join('\n');
    const verdict = reviewVerdict(output);
    const findings = parseFindings(output, snapshot, head, verdict);
    const currentHead = await git('rev-parse', 'HEAD');
    const currentSource = localSource(root, git);
    if (currentHead !== head || createReviewSnapshot({ source: currentSource, head: currentHead }) !== snapshot) throw Error('Local review source or HEAD moved while review was running');
    const status = verdict === 'APPROVE' ? 'approved' : 'changes-requested';
    admission.finish(status, { reviewerSessionID: reviewer.id, findingCount: findings.findings.length, remote: false });
    return { type: 'local-delivery', identity, head, snapshot, reviewerSessionID: reviewer.id, verdict, findings };
  } catch (error) {
    admission.finish('inconclusive', { message: String(error.message || error) });
    throw error;
  } finally { admission.release(); }
}

/** PR review admits only a caller-verified remote source, then rechecks all refs afterward. */
export async function startPullRequestReview({ ctx, cwd, identity, localHead, remoteHead, pullRequestHead, source, readCurrent, model = { providerID: 'lattice', id: 'gpt-6-luna', variant: 'high' }, agent = 'reviewer' }) {
  const root = resolve(cwd);
  verifyPullRequestHeads({ localHead, remoteHead, pullRequestHead });
  if (typeof source !== 'string' || typeof readCurrent !== 'function') throw Error('PR review requires exact source text and a remote/local ref verification callback');
  const head = pullRequestHead;
  const snapshot = createReviewSnapshot({ source, head });
  const admission = beginReview(root, `pr:${identity}`, snapshot, head);
  try {
    const reviewer = await ctx.session.create({ title: `CTG PR review: ${identity}`, agent, model, location: { directory: root }, permissions: [{ action: 'edit', resource: '**', effect: 'deny' }, { action: 'bash', resource: '**', effect: 'deny' }] });
    const prompt = `Review this exact pull request source snapshot. This is remote PR review, not local delivery review. Do not modify files, commit, push, or merge.\nVerified PR head: ${head}\nSnapshot SHA-256: ${snapshot}\n\n${source}\n\nReturn REVIEW_JSON: {"version":1,"snapshot":"${snapshot}","head":"${head}","findings":[]} followed by VERDICT: APPROVE or VERDICT: CHANGES-REQUESTED.`;
    await ctx.session.prompt({ sessionID: reviewer.id, text: prompt });
    await ctx.session.wait({ sessionID: reviewer.id });
    const output = textFrom(await ctx.session.context({ sessionID: reviewer.id })).join('\n');
    const verdict = reviewVerdict(output);
    const findings = parseFindings(output, snapshot, head, verdict);
    const current = await readCurrent();
    verifyPullRequestHeads({ localHead: current.localHead, remoteHead: current.remoteHead, pullRequestHead: current.pullRequestHead });
    if (createReviewSnapshot({ source: current.source, head: current.pullRequestHead }) !== snapshot) throw Error('PR source snapshot moved while review was running');
    admission.finish(verdict === 'APPROVE' ? 'approved' : 'changes-requested', { reviewerSessionID: reviewer.id, findingCount: findings.findings.length, remote: true });
    return { type: 'pull-request', identity, head, snapshot, reviewerSessionID: reviewer.id, verdict, findings };
  } catch (error) {
    admission.finish('inconclusive', { message: String(error.message || error), remote: true });
    throw error;
  } finally { admission.release(); }
}

/** PR review guard: caller supplies the verified source refs from local and remote checks. */
export function verifyPullRequestHeads({ localHead, remoteHead, pullRequestHead }) {
  if (!localHead || !remoteHead || !pullRequestHead || localHead !== remoteHead || remoteHead !== pullRequestHead) throw Error('PR review head mismatch; refresh and review the exact current PR source');
  return { verifiedHead: pullRequestHead };
}
