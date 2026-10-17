import type { Context } from '@opencode/plugin/promise/plugin';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { resolve, join } from 'node:path';
import { listTasks } from '../../../../lib/opencode/workspace.mjs';
import { localReviewSnapshot } from '../../../../lib/opencode/review.mjs';
import { PullRequests, type PullRequestRecord } from '../pull-request-rpc';

const execFileAsync = promisify(execFile);
type TaskRecord = { id: string; sessionID: string; worktree: string };
type PRJson = {
  number?: unknown; html_url?: unknown; state?: unknown; draft?: unknown;
  head?: { sha?: unknown; ref?: unknown; repo?: { full_name?: unknown } | null };
  base?: { sha?: unknown; ref?: unknown; repo?: { full_name?: unknown } | null };
};
export type PullRequestOptions = {
  /** Injectable process boundary for deterministic offline tests. */
  run?: (command: string, args: string[], cwd: string, signal?: AbortSignal) => Promise<string>;
};

function validPR(value: unknown, expectedNumber: number): PRJson {
  if (!value || typeof value !== 'object') throw new Error('GitHub returned malformed pull request metadata');
  const pr = value as PRJson;
  if (pr.number !== expectedNumber || typeof pr.html_url !== 'string' || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(pr.html_url) || !['open', 'closed'].includes(String(pr.state)) || typeof pr.draft !== 'boolean' || typeof pr.head?.sha !== 'string' || !/^[a-f0-9]{40,64}$/i.test(pr.head.sha) || typeof pr.head.ref !== 'string' || typeof pr.base?.sha !== 'string' || !/^[a-f0-9]{40,64}$/i.test(pr.base.sha) || typeof pr.base.ref !== 'string' || typeof pr.head.repo?.full_name !== 'string' || typeof pr.base.repo?.full_name !== 'string') {
    throw new Error('GitHub returned incomplete or malformed pull request metadata');
  }
  return pr;
}

async function defaultRun(command: string, args: string[], cwd: string, signal?: AbortSignal): Promise<string> {
  const result = await execFileAsync(command, args, { cwd, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 30_000, signal });
  return result.stdout;
}

/** Explicit-only GitHub reads and a task-worktree scoped durable cache. */
export async function registerPullRequests(ctx: Context, options: PullRequestOptions = {}) {
  const root = resolve(ctx.location.project.canonical);
  const projectID = ctx.location.project.id;
  const run = options.run ?? defaultRun;
  const taskRecords = () => listTasks({ canonical: root, includeOperations: false }) as unknown as TaskRecord[];
  const taskFor = async (sessionID: string, taskID: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const task = taskRecords().find(item => item.id === taskID && item.sessionID === sessionID);
    if (!task) throw new Error('Task/session association is not owned by this workspace');
    const session = await ctx.session.get({ sessionID }, { signal });
    const directory = resolve(task.worktree);
    if (session.projectID !== projectID || resolve(session.location.directory) !== directory) throw new Error('Session does not own the recorded task worktree');
    let canonical: string;
    try { canonical = realpathSync(directory); } catch { throw new Error('Task worktree is unavailable'); }
    if (canonical !== directory || canonical === root) throw new Error('Task worktree path is not an exact owned directory');
    const journalPath = join(directory, '.harness', 'pull-requests.json');
    if (existsSync(join(directory, '.harness')) && realpathSync(join(directory, '.harness')) !== join(directory, '.harness')) throw new Error('Task PR cache directory resolves outside its owned worktree');
    if (existsSync(journalPath) && lstatSync(journalPath).isSymbolicLink()) throw new Error('Task PR cache file cannot be a symbolic link');
    return { task, directory, journalPath };
  };
  const read = (path: string, taskID: string): PullRequestRecord[] => {
    if (!existsSync(path)) return [];
    let value: unknown;
    try { value = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new Error('Pull request cache is invalid JSON'); }
    if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1 || !Array.isArray((value as { pullRequests?: unknown }).pullRequests)) throw new Error('Pull request cache has an invalid schema');
    const records = (value as { pullRequests: unknown[] }).pullRequests;
    for (const value of records) {
      if (!value || typeof value !== 'object') throw new Error('Pull request cache contains an invalid record');
      const pr = value as Partial<PullRequestRecord>;
      if (pr.taskID !== taskID || !Number.isSafeInteger(pr.number) || typeof pr.url !== 'string' || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(pr.url) || !['open', 'closed'].includes(String(pr.state)) || typeof pr.draft !== 'boolean' || typeof pr.head !== 'string' || !/^[a-f0-9]{40,64}$/i.test(pr.head) || typeof pr.headRef !== 'string' || !pr.headRef || typeof pr.headRepository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(pr.headRepository) || typeof pr.base !== 'string' || !/^[a-f0-9]{40,64}$/i.test(pr.base) || typeof pr.baseRef !== 'string' || !pr.baseRef || !['passed', 'failed', 'pending', 'partial', 'none'].includes(String(pr.checks)) || !['approved-unverified', 'changes-requested', 'unverified', 'unreviewed'].includes(String(pr.review)) || !['current', 'stale-source'].includes(String(pr.source)) || typeof pr.sourceSnapshot !== 'string' || !/^[a-f0-9]{40,64}$/i.test(pr.sourceSnapshot) || typeof pr.updatedAt !== 'string' || !Number.isFinite(Date.parse(pr.updatedAt)) || !pr.url.endsWith(`/pull/${pr.number}`)) throw new Error('Pull request cache contains an invalid or foreign-task record');
    }
    return records as PullRequestRecord[];
  };
  const write = (path: string, pullRequests: PullRequestRecord[]) => {
    const directory = resolve(path, '..');
    mkdirSync(directory, { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ version: 1, pullRequests }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  };
  const repository = async (directory: string) => {
    const remote = (await run('git', ['remote', 'get-url', 'origin'], directory)).trim();
    const match = remote.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
    if (!match) throw new Error('Task worktree origin must be a GitHub repository');
    return match[1];
  };
  const fetch = async (directory: string, repo: string, number: number, taskID: string, signal?: AbortSignal): Promise<PullRequestRecord> => {
    signal?.throwIfAborted();
    const api = async (endpoint: string, paginate = false) => {
      signal?.throwIfAborted();
      const output = await run('gh', ['api', ...(paginate ? ['--paginate', '--slurp'] : []), endpoint], directory, signal);
      signal?.throwIfAborted();
      return JSON.parse(output) as unknown;
    };
    const pr = validPR(await api(`repos/${repo}/pulls/${number}`), number);
    const baseRepo = String(pr.base!.repo!.full_name);
    const headRepo = String(pr.head!.repo!.full_name);
    if (baseRepo.toLowerCase() !== repo.toLowerCase() || !/^[\w.-]+\/[\w.-]+$/.test(headRepo)) throw new Error('Pull request base repository must match the task origin and head must be a GitHub repository');
    if (pr.html_url !== `https://github.com/${baseRepo}/pull/${number}`) throw new Error('GitHub pull request URL does not match its repository and number');
    const [checksPages, statusesPages, reviewsPages, currentHead] = await Promise.all([
      api(`repos/${repo}/commits/${pr.head!.sha}/check-runs?per_page=100`, true),
      api(`repos/${repo}/commits/${pr.head!.sha}/status?per_page=100`, true),
      api(`repos/${repo}/pulls/${number}/reviews?per_page=100`, true),
      run('git', ['rev-parse', 'HEAD'], directory),
    ]);
    const pages = (value: unknown): unknown[] => {
      if (!Array.isArray(value) || !value.every(page => page && typeof page === 'object')) throw new Error('GitHub returned malformed paginated metadata');
      return value;
    };
    const checks = pages(checksPages).map(page => page as { check_runs?: unknown; total_count?: unknown });
    const statuses = pages(statusesPages).map(page => page as { statuses?: unknown; state?: unknown; total_count?: unknown });
    const reviewPages = pages(reviewsPages);
    if (!checks.every(page => Array.isArray(page.check_runs) && Number.isInteger(page.total_count)) || !statuses.every(page => Array.isArray(page.statuses) && Number.isInteger(page.total_count))) throw new Error('GitHub returned malformed checks/status metadata');
    const runs = checks.flatMap(page => page.check_runs as Array<{ status?: unknown; conclusion?: unknown }>);
    const commitStatuses = statuses.flatMap(page => page.statuses as Array<{ state?: unknown }>);
    const totalChecks = Number(checks[0]?.total_count ?? 0) + Number(statuses[0]?.total_count ?? 0);
    const observedChecks = runs.length + commitStatuses.length;
    const checkStatus = observedChecks < totalChecks ? 'partial' : observedChecks === 0 ? 'none' : runs.some(check => check.status !== 'completed') || commitStatuses.some(check => check.state === 'pending') ? 'pending' : runs.some(check => check.conclusion !== 'success') || commitStatuses.some(check => check.state !== 'success') ? 'failed' : 'passed';
    const reviews = reviewPages.flatMap(page => {
      if (!Array.isArray(page)) throw new Error('GitHub returned malformed review metadata');
      return page as Array<{ state?: unknown; submitted_at?: unknown; commit_id?: unknown; user?: { login?: unknown } }>;
    });
    const sha = String(pr.head!.sha);
    const latestByReviewer = new Map<string, typeof reviews[number]>();
    for (const review of reviews.filter(item => item.commit_id === sha && typeof item.user?.login === 'string' && ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(String(item.state))).sort((a, b) => String(a.submitted_at).localeCompare(String(b.submitted_at)))) latestByReviewer.set(review.user!.login as string, review);
    const headReviews = [...latestByReviewer.values()];
    const reviewStatus = headReviews.some(review => review.state === 'CHANGES_REQUESTED') ? 'changes-requested' : headReviews.some(review => review.state === 'APPROVED') ? 'approved-unverified' : reviews.some(review => ['APPROVED', 'CHANGES_REQUESTED'].includes(String(review.state))) ? 'unverified' : 'unreviewed';
    const localHead = currentHead.trim();
    return {
      taskID, number, url: String(pr.html_url), state: String(pr.state), draft: pr.draft as boolean,
      head: sha, headRef: String(pr.head!.ref), headRepository: headRepo, base: String(pr.base!.sha), baseRef: String(pr.base!.ref), checks: checkStatus, review: reviewStatus,
      source: localHead === sha ? 'current' : 'stale-source', sourceSnapshot: localReviewSnapshot(directory).snapshot, updatedAt: new Date().toISOString(),
    };
  };
  const registration = await ctx.rpc.register(PullRequests, {
    list: async (value, call) => {
      const input = value as { sessionID: string; taskID: string };
      const owned = await taskFor(input.sessionID, input.taskID, call.signal);
      const current = localReviewSnapshot(owned.directory);
      const pullRequests = read(owned.journalPath, owned.task.id);
      return { pullRequests: pullRequests.map(pr => ({ ...pr, taskID: owned.task.id, source: current.snapshot === pr.sourceSnapshot && current.head === pr.head ? 'current' : 'stale-source' })) };
    },
    associate: async (value, call) => {
      const input = value as { sessionID: string; taskID: string; number?: number };
      if (!Number.isSafeInteger(input.number) || input.number! < 1) throw new Error('A positive pull request number is required');
      const owned = await taskFor(input.sessionID, input.taskID, call.signal);
      const repo = await repository(owned.directory);
      const record = await fetch(owned.directory, repo, input.number!, owned.task.id, call.signal);
      const records = read(owned.journalPath, owned.task.id).filter(item => item.number !== record.number);
      records.push(record);
      write(owned.journalPath, records);
      return { pullRequest: record };
    },
    refresh: async (value, call) => {
      const input = value as { sessionID: string; taskID: string; number?: number };
      const owned = await taskFor(input.sessionID, input.taskID, call.signal);
      const records = read(owned.journalPath, owned.task.id);
      const number = input.number ?? records.at(-1)?.number;
      if (!Number.isSafeInteger(number) || number! < 1 || !records.some(item => item.number === number)) throw new Error('Pull request is not associated with this task');
      const repo = await repository(owned.directory);
      const record = await fetch(owned.directory, repo, number!, owned.task.id, call.signal);
      write(owned.journalPath, records.map(item => item.number === number ? record : item));
      return { pullRequest: record };
    },
  });
  return () => registration.dispose();
}
