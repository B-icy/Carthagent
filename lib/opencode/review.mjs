import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { beginReview, parseFindings } from '../review-state.mjs';

function reviewVerdict(output) {
  const line = output.trim().split(/\r?\n/).at(-1);
  const match = /^VERDICT: (APPROVE|CHANGES-REQUESTED)$/.exec(line || '');
  if (!match) throw Error('Reviewer output must end with an exact structured VERDICT line');
  return match[1];
}

function localSource(root, git) {
  const diff = git('diff', 'HEAD', '--binary', { trim: false });
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(path => path && path !== '.harness' && !path.startsWith('.harness/')).sort();
  return `${diff}\0UNTRACKED\0${untracked.map(path => `${path}\0${readFileSync(join(root, path)).toString('base64')}`).join('\0')}`;
}

function assistantText(messages, session) {
  if (session?.outcome && session.outcome !== 'succeeded') throw Error(`Reviewer execution did not succeed (${session.outcome})`);
  const terminal = messages.at(-1);
  if (terminal?.type !== 'idle' || terminal.outcome !== 'succeeded') throw Error(`Reviewer execution did not reach a successful terminal state (${terminal?.type === 'idle' ? terminal.outcome : 'missing'})`);
  const assistant = [...messages.slice(0, -1)].reverse().find(message => message.type === 'assistant');
  if (!assistant || assistant.finish !== 'stop' || !Array.isArray(assistant.content)) throw Error('Reviewer did not return a completed assistant response');
  return assistant.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
}

const READ_ONLY_PERMISSIONS = [
  { action: '*', resource: '*', effect: 'deny' },
  { action: 'shell', resource: '*', effect: 'deny' },
  { action: 'edit', resource: '*', effect: 'deny' },
  { action: 'write', resource: '*', effect: 'deny' },
  { action: 'external_directory', resource: '*', effect: 'deny' },
  { action: 'execute', resource: '*', effect: 'deny' },
  { action: 'subagent', resource: '*', effect: 'deny' },
  { action: 'skill', resource: '*', effect: 'deny' },
  { action: 'read', resource: '*', effect: 'allow' },
  { action: 'glob', resource: '*', effect: 'allow' },
  { action: 'grep', resource: '*', effect: 'allow' },
];

function reviewerSignal(signal, timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw Error('Review timeout must be an integer from 1 to 300000 ms');
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function interruptReviewer(ctx, sessionID) {
  let timer;
  try {
    return await Promise.race([
      ctx.session.interrupt({ sessionID, continue: false }, { signal: AbortSignal.timeout(2_000) }).then(result => result.interrupted === true),
      new Promise(resolveInterrupt => { timer = setTimeout(() => resolveInterrupt(false), 2_000); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

async function selectReviewerAgent(ctx, agent, signal) {
  const list = await ctx.agent.list({}, { signal });
  const agents = Array.isArray(list) ? list : list?.data;
  if (!Array.isArray(agents) || !agents.some(item => item.id === agent)) throw Error(`Reviewer agent ${agent} is not registered at this OpenCode location`);
  return agent;
}

async function runReviewer({ ctx, root, title, prompt, agent, model, signal, timeoutMs }) {
  const requestSignal = reviewerSignal(signal, timeoutMs);
  let reviewer;
  try {
    await selectReviewerAgent(ctx, agent, requestSignal);
    reviewer = await ctx.session.create({ title, agent, model, location: { directory: root }, permissions: READ_ONLY_PERMISSIONS }, { signal: requestSignal });
    await ctx.session.prompt({ sessionID: reviewer.id, text: prompt }, { signal: requestSignal });
    await ctx.session.wait({ sessionID: reviewer.id }, { signal: requestSignal });
    const [messages, session] = await Promise.all([
      ctx.session.context({ sessionID: reviewer.id }, { signal: requestSignal }),
      ctx.session.get({ sessionID: reviewer.id }, { signal: requestSignal }),
    ]);
    return { reviewer, output: assistantText(messages, session) };
  } catch (error) {
    let interrupted = false;
    if (reviewer && (requestSignal.aborted || signal?.aborted)) {
      try { interrupted = await interruptReviewer(ctx, reviewer.id); }
      catch { /* Preserve the cancellation/timeout failure. */ }
    }
    if (requestSignal.aborted) {
      const reason = signal?.aborted ? 'cancelled' : 'timed out';
      const stopped = interrupted ? 'reviewer interruption confirmed' : 'reviewer may still be running; interruption was not confirmed';
      throw Error(`Review ${reason}; ${stopped} (session ${reviewer?.id ?? 'creation pending'})`, { cause: error });
    }
    throw error;
  }
}

export function createReviewSnapshot({ source, head }) {
  return createHash('sha256').update(`${source}\0${head}`).digest('hex');
}

/** Local delivery review. This does not approve or merge a remote PR. */
/** @param {{ ctx: OpenCodeContext, cwd: string, identity?: string, model?: { providerID: string, id: string, variant?: string }, agent?: string, signal?: AbortSignal, timeoutMs?: number }} options */
export async function startReview({ ctx, cwd, identity = 'local-delivery', model = /** @type {{ providerID: string, id: string, variant?: string }} */ ({ providerID: 'lattice', id: 'gpt-6-luna', variant: 'high' }), agent = 'build', signal, timeoutMs = 300_000 }) {
  const root = resolve(cwd);
  const git = (...args) => {
    const options = args.at(-1)?.trim === false ? args.pop() : undefined;
    const output = execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return options ? output : output.trim();
  };
  const head = git('rev-parse', 'HEAD');
  const source = localSource(root, git);
  const snapshot = createReviewSnapshot({ source, head });
  const admission = beginReview(root, identity, snapshot, head);
  let reviewer;
  try {
    const prompt = `Review this exact local delivery source at ${root}. This is a read-only local delivery review, not a PR review. Do not modify files, commit, push, or merge.\nHEAD: ${head}\nSnapshot SHA-256: ${snapshot}\n\nExact source diff and untracked source files (base64 records where applicable):\n${source}\n\nReport findings and end with REVIEW_JSON: {"version":1,"snapshot":"${snapshot}","head":"${head}","findings":[]} followed by VERDICT: APPROVE or VERDICT: CHANGES-REQUESTED.`;
    const result = await runReviewer({ ctx, root, title: `CTG review: ${identity}`, prompt, agent, model, signal, timeoutMs });
    reviewer = result.reviewer;
    const output = result.output;
    const verdict = reviewVerdict(output);
    const findings = parseFindings(output, snapshot, head, verdict);
    const currentHead = await git('rev-parse', 'HEAD');
    const currentSource = localSource(root, git);
    if (currentHead !== head || createReviewSnapshot({ source: currentSource, head: currentHead }) !== snapshot) throw Error('Local review source or HEAD moved while review was running');
    const status = verdict === 'APPROVE' ? 'approved' : 'changes-requested';
    admission.finish(status, { reviewerSessionID: reviewer.id, findings: findings.findings, remote: false });
    return { type: 'local-delivery', identity, head, snapshot, reviewerSessionID: reviewer.id, verdict, findings };
  } catch (error) {
    admission.finish('inconclusive', { message: String(error.message || error) });
    throw error;
  } finally { admission.release(); }
}

function commandOutput(commandRunner, command, args, cwd, { trim = true } = {}) {
  const result = commandRunner(command, args, { cwd, encoding: 'utf8' });
  const output = Buffer.isBuffer(result) ? result.toString('utf8') : String(result);
  return trim ? output.trim() : output;
}

function runDefaultCommand(command, args, options) {
  return execFileSync(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
}

function authoritativePR({ cwd, repository, prNumber, commandRunner }) {
  if (!Number.isInteger(prNumber) || prNumber < 1) throw Error('A positive GitHub pull request number is required');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '')) throw Error('A GitHub repository in owner/name form is required');
  const git = (...args) => commandOutput(commandRunner, 'git', args, cwd);
  const response = commandOutput(commandRunner, 'gh', ['api', `repos/${repository}/pulls/${prNumber}`], cwd);
  let pullRequest;
  try { pullRequest = JSON.parse(response); } catch (error) { throw Error('GitHub CLI returned malformed pull request metadata', { cause: error }); }
  const headRepository = pullRequest?.head?.repo?.full_name;
  const headUrl = pullRequest?.head?.repo?.clone_url;
  const baseRepository = pullRequest?.base?.repo?.full_name;
  const baseUrl = pullRequest?.base?.repo?.clone_url;
  const remoteHead = pullRequest?.head?.sha;
  const baseHead = pullRequest?.base?.sha;
  const headRefName = pullRequest?.head?.ref;
  const baseRefName = pullRequest?.base?.ref;
  if (pullRequest?.state !== 'open' || !headRepository || !headUrl || !baseRepository || !baseUrl || typeof headRefName !== 'string' || typeof baseRefName !== 'string' || !/^[a-f0-9]{40}$/i.test(remoteHead || '') || !/^[a-f0-9]{40}$/i.test(baseHead || '')) throw Error('GitHub PR is not open or did not provide authoritative head/base commits');
  const localHead = git('rev-parse', 'HEAD');
  const headRef = `refs/ctg-review/pr-${prNumber}/head`;
  const baseRef = `refs/ctg-review/pr-${prNumber}/base`;
  if (git('check-ref-format', '--branch', headRefName) !== headRefName || git('check-ref-format', '--branch', baseRefName) !== baseRefName) throw Error('GitHub PR returned an invalid branch ref');
  commandOutput(commandRunner, 'git', ['fetch', '--no-tags', '--no-write-fetch-head', headUrl, `+refs/heads/${headRefName}:${headRef}`], cwd);
  commandOutput(commandRunner, 'git', ['fetch', '--no-tags', '--no-write-fetch-head', baseUrl, `+refs/heads/${baseRefName}:${baseRef}`], cwd);
  if (git('rev-parse', headRef) !== remoteHead || git('rev-parse', baseRef) !== baseHead) throw Error('Fetched GitHub branch refs do not match the authoritative pull request commit IDs');
  if (localHead !== remoteHead) throw Error('Local HEAD does not match the authoritative GitHub PR head');
  const mergeBase = git('merge-base', baseHead, remoteHead);
  const source = commandOutput(commandRunner, 'git', ['diff', '--binary', mergeBase, remoteHead, '--'], cwd, { trim: false });
  if (git('rev-parse', `${remoteHead}^{commit}`) !== remoteHead || git('rev-parse', `${baseHead}^{commit}`) !== baseHead) throw Error('Fetched Git objects do not match the authoritative GitHub PR commits');
  return { repository: repository.toLowerCase(), prNumber, localHead, remoteHead, baseHead, headRepository: headRepository.toLowerCase(), source };
}

/** PR approval is derived from GitHub PR metadata and exact fetched Git objects, never caller-supplied refs/source. */
/** @typedef {import('@opencode/plugin/promise/plugin').Context} OpenCodeContext */
/** @typedef {(command: string, args: string[], options: { cwd: string, encoding: 'utf8' }) => string | Buffer} CommandRunner */
/** @param {{ ctx: OpenCodeContext, cwd: string, repository: string, prNumber: number, commandRunner?: CommandRunner, model?: { providerID: string, id: string, variant?: string }, agent?: string, signal?: AbortSignal, timeoutMs?: number }} options */
export async function startPullRequestReview({ ctx, cwd, repository, prNumber, commandRunner = runDefaultCommand, model = /** @type {{ providerID: string, id: string, variant?: string }} */ ({ providerID: 'lattice', id: 'gpt-6-luna', variant: 'high' }), agent = 'build', signal, timeoutMs = 300_000 }) {
  const root = resolve(cwd);
  const initial = authoritativePR({ cwd: root, repository, prNumber, commandRunner });
  const identity = `${initial.repository}#${initial.prNumber}`;
  const head = initial.remoteHead;
  const snapshot = createReviewSnapshot({ source: initial.source, head });
  const admission = beginReview(root, `pr:${identity}`, snapshot, head);
  try {
    const prompt = `Review this exact GitHub pull request source snapshot. This is remote PR review, not local delivery review. Do not modify files, commit, push, or merge.\nRepository: ${identity}\nVerified PR head: ${head}\nSnapshot SHA-256: ${snapshot}\n\n${initial.source}\n\nReturn REVIEW_JSON: {"version":1,"snapshot":"${snapshot}","head":"${head}","findings":[]} followed by VERDICT: APPROVE or VERDICT: CHANGES-REQUESTED.`;
    const result = await runReviewer({ ctx, root, title: `CTG PR review: ${identity}`, prompt, agent, model, signal, timeoutMs });
    const reviewer = result.reviewer;
    const output = result.output;
    const verdict = reviewVerdict(output);
    const findings = parseFindings(output, snapshot, head, verdict);
    const current = authoritativePR({ cwd: root, repository, prNumber, commandRunner });
    if (current.repository !== initial.repository || current.headRepository !== initial.headRepository || current.localHead !== initial.localHead || current.remoteHead !== initial.remoteHead || current.baseHead !== initial.baseHead || createReviewSnapshot({ source: current.source, head: current.remoteHead }) !== snapshot) throw Error('Authoritative GitHub PR refs or source moved while review was running');
    admission.finish(verdict === 'APPROVE' ? 'approved' : 'changes-requested', { reviewerSessionID: reviewer.id, findings: findings.findings, remote: true });
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
