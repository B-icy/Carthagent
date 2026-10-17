import type { Context } from '@opencode/plugin/promise/plugin';
import { execFile, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync, fsyncSync } from 'node:fs';
import { promisify } from 'node:util';
import { resolve, join } from 'node:path';
import { listTasks } from '../../../../lib/opencode/workspace.mjs';
import { localReviewSnapshot } from '../../../../lib/opencode/review.mjs';
import { PullRequests, type PullRequestRecord } from '../pull-request-rpc';

const execFileAsync = promisify(execFile);
const MAX_CACHE_BYTES = 256 * 1024;
const MAX_ASSOCIATIONS = 100;
const LOCK_WAIT_MS = 5_000;
const LOCK_RETRY_MS = 25;
const LOCK_STALE_MS = 30_000;
type FailureCode = 'invalid_request' | 'not_owned' | 'not_associated' | 'github_unavailable' | 'github_invalid' | 'cache_invalid' | 'cache_limit' | 'cache_busy' | 'worktree_unavailable' | 'canceled' | 'internal';
class PullRequestFailure extends Error {
  constructor(readonly code: FailureCode, message: string) { super(message); }
}
function failure(call: { error: (type: 'pull_request_error', message: string, data: { code: FailureCode }) => unknown }, error: unknown) {
  if (error instanceof PullRequestFailure) return call.error('pull_request_error', publicFailureMessage(error.code), { code: error.code });
  if (error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('cancel'))) return call.error('pull_request_error', publicFailureMessage('canceled'), { code: 'canceled' });
  const message = error instanceof Error ? error.message : String(error);
  const code: FailureCode = /Unexpected property|Expected property|JSON|Unexpected end/i.test(message) ? 'github_invalid'
    : /not owned|another workspace|does not own|foreign-task/i.test(message) ? 'not_owned'
    : /not associated/i.test(message) ? 'not_associated'
      : /cache is invalid|invalid schema|invalid record|foreign-task|symbolic link/i.test(message) ? 'cache_invalid'
        : /cache.*limit|maximum of|100 association/i.test(message) ? 'cache_limit'
          : /cache is busy/i.test(message) ? 'cache_busy'
              : /GitHub returned|pull request repository|GitHub pull request URL|base repository/i.test(message) ? 'github_invalid'
              : /gh unavailable|ENOENT.*gh|timed out/i.test(message) ? 'github_unavailable'
                : /worktree is unavailable|task worktree/i.test(message) ? 'worktree_unavailable'
                  : 'internal';
  return call.error('pull_request_error', publicFailureMessage(code), { code });
}
function publicFailureMessage(code: FailureCode): string {
  const messages: Record<FailureCode, string> = {
    invalid_request: 'A valid pull request number is required',
    not_owned: 'The task/session association is not owned by this workspace',
    not_associated: 'The pull request is not associated with this task',
    github_unavailable: 'GitHub could not be reached; retry later',
    github_invalid: 'GitHub returned invalid pull request data',
    cache_invalid: 'The task pull request cache is invalid or inaccessible',
    cache_limit: 'The task pull request cache has reached its configured limit',
    cache_busy: 'The pull request cache is busy; retry later',
    worktree_unavailable: 'The task worktree is unavailable',
    canceled: 'The pull request operation was canceled',
    internal: 'The pull request operation failed',
  };
  return messages[code];
}
type TaskRecord = { id: string; sessionID: string; worktree: string };
/** Resolve symlinked ancestors (such as macOS /tmp -> /private/tmp) while requiring
 * the requested directory itself to be the real directory, not a symlink leaf. */
export function canonicalDirectory(path: string): string {
  const absolute = resolve(path);
  if (lstatSync(absolute).isSymbolicLink()) throw new PullRequestFailure('not_owned', 'Directory path is not an exact owned directory');
  return realpathSync(absolute);
}
function hasDirtySource(directory: string): boolean {
  const result = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', '.', ':(exclude).harness/**'], { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5_000 });
  return result.trim().length > 0;
}
type PRJson = {
  number?: unknown; html_url?: unknown; state?: unknown; draft?: unknown;
  head?: { sha?: unknown; ref?: unknown; repo?: { full_name?: unknown } | null };
  base?: { sha?: unknown; ref?: unknown; repo?: { full_name?: unknown } | null };
};
export type PullRequestOptions = {
  /** Injectable process boundary for deterministic offline tests. */
  run?: (command: string, args: string[], cwd: string, signal?: AbortSignal) => Promise<string>;
};

async function acquireLock(lockPath: string, signal?: AbortSignal): Promise<() => void> {
  mkdirSync(resolve(lockPath, '..'), { recursive: true });
  const started = Date.now();
  while (true) {
    signal?.throwIfAborted();
    const recoveryPath = `${lockPath}.recovering`;
    if (existsSync(recoveryPath)) {
      recoverDeadOwner(recoveryPath);
      if (existsSync(recoveryPath)) { await waitLock(started, signal); continue; }
    }
    try {
      const token = randomUUID();
      const fd = publishExclusive(lockPath, { pid: process.pid, token, createdAt: new Date().toISOString() });
      const identity = fstatSync(fd);
      return () => {
        try {
          const current = lstatSync(lockPath);
          const owner = JSON.parse(readBoundedFile(lockPath, 1024).toString('utf8')) as { token?: string };
          if (current.dev === identity.dev && current.ino === identity.ino && owner.token === token) unlinkSync(lockPath);
        } catch { /* Never remove a lock unless this owner still has the same inode and token. */ }
        closeSync(fd);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (recoverDeadOwner(lockPath)) continue;
      await waitLock(started, signal);
    }
  }
}

/** Publish a complete owner record atomically at its exclusive name. A crash while
 * writing the private temporary file can never leave a nameless/partial owner that
 * blocks future acquisitions. Hard-link publication fails rather than replacing. */
export function publishExclusive(path: string, record: { pid: number; token: string; createdAt: string }, onStage?: (stage: 'empty' | 'partial' | 'published') => void): number {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    onStage?.('empty');
    const contents = JSON.stringify(record);
    const midpoint = Math.max(1, Math.floor(contents.length / 2));
    writeFileSync(fd, contents.slice(0, midpoint));
    onStage?.('partial');
    writeFileSync(fd, contents.slice(midpoint));
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    linkSync(temporary, path);
    const published = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    onStage?.('published');
    return published;
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch { /* A crash may leave harmless uniquely named temp debris. */ }
  }
}

async function waitLock(started: number, signal?: AbortSignal) {
  if (Date.now() - started >= LOCK_WAIT_MS) throw new PullRequestFailure('cache_busy', 'Pull request cache is busy; retry later');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, LOCK_RETRY_MS);
    const abort = () => { clearTimeout(timer); reject(new PullRequestFailure('canceled', 'Pull request cache lock wait was canceled')); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Only remove a sufficiently old lock with a provably dead PID. A marker serializes
 * recovery contenders, and inode/token checks ensure neither recovery nor release
 * unlinks a replacement lock. */
export function recoverDeadOwner(lockPath: string, afterMarker?: () => void): boolean {
  let observed;
  let owner: { pid?: unknown; token?: unknown };
  try {
    observed = lstatSync(lockPath);
    if (!observed.isFile() || observed.size > 1024 || Date.now() - observed.mtimeMs < LOCK_STALE_MS) return false;
    owner = JSON.parse(readBoundedFile(lockPath, 1024).toString('utf8')) as { pid?: unknown; token?: unknown };
  } catch { return false; }
  if (!Number.isSafeInteger(owner.pid) || typeof owner.token !== 'string' || !owner.token) return false;
  try { process.kill(owner.pid as number, 0); return false; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false; }
  const recoveryPath = `${lockPath}.recovering`;
  const recoveryToken = randomUUID();
  let recoveryFD: number;
  try { recoveryFD = publishExclusive(recoveryPath, { pid: process.pid, token: recoveryToken, createdAt: new Date().toISOString() }); }
  catch { return false; }
  const recoveryStat = fstatSync(recoveryFD);
  try {
    afterMarker?.();
    const current = lstatSync(lockPath);
    const currentOwner = JSON.parse(readBoundedFile(lockPath, 1024).toString('utf8')) as { pid?: unknown; token?: unknown };
    if (current.dev !== observed.dev || current.ino !== observed.ino || currentOwner.pid !== owner.pid || currentOwner.token !== owner.token || Date.now() - current.mtimeMs < LOCK_STALE_MS) return false;
    try { process.kill(owner.pid as number, 0); return false; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false; }
    unlinkSync(lockPath);
    return true;
  } catch { return false; }
  finally {
    closeSync(recoveryFD);
    try {
      const marker = lstatSync(recoveryPath);
      if (marker.dev === recoveryStat.dev && marker.ino === recoveryStat.ino) unlinkSync(recoveryPath);
    } catch { /* Do not remove a marker replaced by another process. */ }
  }
}

export function readBoundedFile(path: string, maximum: number, afterOpen?: () => void): Buffer {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const fd = openSync(path, constants.O_RDONLY | noFollow);
  try {
    const opened = fstatSync(fd);
    afterOpen?.();
    const named = lstatSync(path);
    if (!opened.isFile() || named.isSymbolicLink() || opened.dev !== named.dev || opened.ino !== named.ino) throw new PullRequestFailure('cache_invalid', 'Pull request cache target changed while opening');
    if (opened.size > maximum) throw new PullRequestFailure('cache_limit', `Pull request cache exceeds the ${maximum} byte read limit`);
    const buffer = Buffer.alloc(maximum + 1);
    let count = 0;
    while (count < buffer.length) {
      const read = readSync(fd, buffer, count, buffer.length - count, count);
      if (read === 0) break;
      count += read;
    }
    if (count > maximum) throw new PullRequestFailure('cache_limit', `Pull request cache exceeds the ${maximum} byte read limit`);
    return buffer.subarray(0, count);
  } finally { closeSync(fd); }
}

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
  const root = canonicalDirectory(ctx.location.project.canonical);
  const projectID = ctx.location.project.id;
  const run = options.run ?? defaultRun;
  const taskRecords = () => listTasks({ canonical: root, includeOperations: false }) as unknown as TaskRecord[];
  const taskFor = async (sessionID: string, taskID: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const task = taskRecords().find(item => item.id === taskID && item.sessionID === sessionID);
    if (!task) throw new PullRequestFailure('not_owned', 'Task/session association is not owned by this workspace');
    const session = await ctx.session.get({ sessionID }, { signal });
    let directory: string;
    let sessionDirectory: string;
    try {
      directory = canonicalDirectory(task.worktree);
      sessionDirectory = canonicalDirectory(session.location.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new PullRequestFailure('worktree_unavailable', 'Task worktree is unavailable');
      throw error;
    }
    if (session.projectID !== projectID || sessionDirectory !== directory) throw new PullRequestFailure('not_owned', 'Session does not own the recorded task worktree');
    if (directory === root) throw new PullRequestFailure('not_owned', 'Task worktree path is not an exact owned directory');
    const journalPath = join(directory, '.harness', 'pull-requests.json');
    const lockPath = join(directory, '.harness', 'pull-requests.lock');
    if (existsSync(join(directory, '.harness')) && realpathSync(join(directory, '.harness')) !== join(directory, '.harness')) throw new PullRequestFailure('cache_invalid', 'Task PR cache directory resolves outside its owned worktree');
    if (existsSync(journalPath) && lstatSync(journalPath).isSymbolicLink()) throw new PullRequestFailure('cache_invalid', 'Task PR cache file cannot be a symbolic link');
    if (existsSync(lockPath) && lstatSync(lockPath).isSymbolicLink()) throw new PullRequestFailure('cache_invalid', 'Task PR lock file cannot be a symbolic link');
    return { task, directory, journalPath, lockPath };
  };
  const read = (path: string, taskID: string): PullRequestRecord[] => {
    if (!existsSync(path)) return [];
    let value: unknown;
    try {
      const contents = readBoundedFile(path, MAX_CACHE_BYTES);
      value = JSON.parse(contents.toString('utf8'));
    } catch (error) { if (error instanceof PullRequestFailure) throw error; throw new PullRequestFailure('cache_invalid', 'Pull request cache is invalid JSON'); }
    if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1 || !Array.isArray((value as { pullRequests?: unknown }).pullRequests)) throw new PullRequestFailure('cache_invalid', 'Pull request cache has an invalid schema');
    const records = (value as { pullRequests: unknown[] }).pullRequests;
    if (records.length > MAX_ASSOCIATIONS) throw new PullRequestFailure('cache_limit', 'Pull request cache exceeds the 100 association limit');
    for (const value of records) {
      if (!value || typeof value !== 'object') throw new PullRequestFailure('cache_invalid', 'Pull request cache contains an invalid record');
      const pr = value as Partial<PullRequestRecord>;
      if (pr.taskID !== taskID || pr.taskID.length > 128 || !Number.isSafeInteger(pr.number) || typeof pr.url !== 'string' || pr.url.length > 2048 || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(pr.url) || !['open', 'closed'].includes(String(pr.state)) || typeof pr.draft !== 'boolean' || typeof pr.head !== 'string' || !/^[a-f0-9]{40,64}$/i.test(pr.head) || typeof pr.headRef !== 'string' || !pr.headRef || pr.headRef.length > 255 || typeof pr.headRepository !== 'string' || pr.headRepository.length > 511 || !/^[\w.-]+\/[\w.-]+$/.test(pr.headRepository) || typeof pr.base !== 'string' || !/^[a-f0-9]{40,64}$/i.test(pr.base) || typeof pr.baseRef !== 'string' || !pr.baseRef || pr.baseRef.length > 255 || !['passed', 'failed', 'pending', 'partial', 'none'].includes(String(pr.checks)) || !['approved-unverified', 'changes-requested', 'unverified', 'unreviewed'].includes(String(pr.review)) || !['current', 'stale-source'].includes(String(pr.source)) || typeof pr.sourceSnapshot !== 'string' || !/^[a-f0-9]{40,64}$/i.test(pr.sourceSnapshot) || typeof pr.updatedAt !== 'string' || pr.updatedAt.length > 40 || !Number.isFinite(Date.parse(pr.updatedAt)) || !pr.url.endsWith(`/pull/${pr.number}`)) throw new PullRequestFailure(pr.taskID !== taskID ? 'not_owned' : 'cache_invalid', 'Pull request cache contains an invalid or foreign-task record');
    }
    return records as PullRequestRecord[];
  };
  const write = (path: string, pullRequests: PullRequestRecord[]) => {
    if (pullRequests.length > MAX_ASSOCIATIONS) throw new PullRequestFailure('cache_limit', 'Task already has the maximum of 100 associated pull requests');
    const directory = resolve(path, '..');
    mkdirSync(directory, { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    const serialized = `${JSON.stringify({ version: 1, pullRequests }, null, 2)}\n`;
    if (Buffer.byteLength(serialized) > MAX_CACHE_BYTES) throw new PullRequestFailure('cache_limit', 'Pull request cache would exceed the 256 KiB limit');
    writeFileSync(temporary, serialized, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  };
  const repository = async (directory: string) => {
    const remote = (await run('git', ['remote', 'get-url', 'origin'], directory)).trim();
    const match = remote.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
    if (!match) throw new PullRequestFailure('github_invalid', 'Task worktree origin must be a GitHub repository');
    return match[1];
  };
  const fetch = async (directory: string, repo: string, number: number, taskID: string, signal?: AbortSignal): Promise<PullRequestRecord> => {
    signal?.throwIfAborted();
    const requestedAt = new Date().toISOString();
    const api = async (endpoint: string, paginate = false) => {
      signal?.throwIfAborted();
      let output: string;
      try { output = await run('gh', ['api', ...(paginate ? ['--paginate', '--slurp'] : []), endpoint], directory, signal); }
      catch (error) {
        signal?.throwIfAborted();
        throw new PullRequestFailure('github_unavailable', error instanceof Error ? error.message : 'GitHub CLI request failed');
      }
      signal?.throwIfAborted();
      return JSON.parse(output) as unknown;
    };
    const pr = validPR(await api(`repos/${repo}/pulls/${number}`), number);
    const baseRepo = String(pr.base!.repo!.full_name);
    const headRepo = String(pr.head!.repo!.full_name);
    if (baseRepo.toLowerCase() !== repo.toLowerCase() || !/^[\w.-]+\/[\w.-]+$/.test(headRepo)) throw new PullRequestFailure('github_invalid', 'Pull request base repository must match the task origin and head must be a GitHub repository');
    if (pr.html_url !== `https://github.com/${baseRepo}/pull/${number}`) throw new PullRequestFailure('github_invalid', 'GitHub pull request URL does not match its repository and number');
    const [checksPages, statusesPages, reviewsPages, currentHead] = await Promise.all([
      api(`repos/${repo}/commits/${pr.head!.sha}/check-runs?per_page=100`, true),
      api(`repos/${repo}/commits/${pr.head!.sha}/status?per_page=100`, true),
      api(`repos/${repo}/pulls/${number}/reviews?per_page=100`, true),
      run('git', ['rev-parse', 'HEAD'], directory),
    ]);
    const pages = (value: unknown, label: string): unknown[] => {
      if (!Array.isArray(value)) throw new Error(`GitHub returned malformed ${label} metadata`);
      const unwrapped = value.every(Array.isArray) ? value.flat() : value;
      if (!unwrapped.every(page => page && typeof page === 'object' && !Array.isArray(page))) throw new Error(`GitHub returned malformed ${label} metadata`);
      return unwrapped;
    };
    const checks = pages(checksPages, 'checks').map(page => page as { check_runs?: unknown; total_count?: unknown });
    const statuses = pages(statusesPages, 'statuses').map(page => page as { statuses?: unknown; state?: unknown; total_count?: unknown });
    const reviewPages = pages(reviewsPages, 'reviews');
    if (!checks.every(page => Array.isArray(page.check_runs) && Number.isInteger(page.total_count)) || !statuses.every(page => Array.isArray(page.statuses) && Number.isInteger(page.total_count))) throw new Error('GitHub returned malformed checks/status metadata');
    const runs = checks.flatMap(page => page.check_runs as Array<{ status?: unknown; conclusion?: unknown }>);
    const commitStatuses = statuses.flatMap(page => page.statuses as Array<{ state?: unknown }>);
    const totalChecks = Number(checks[0]?.total_count ?? 0) + Number(statuses[0]?.total_count ?? 0);
    const observedChecks = runs.length + commitStatuses.length;
    const checkStatus = observedChecks < totalChecks ? 'partial' : observedChecks === 0 ? 'none' : runs.some(check => check.status !== 'completed') || commitStatuses.some(check => check.state === 'pending') ? 'pending' : runs.some(check => check.conclusion !== 'success') || commitStatuses.some(check => check.state !== 'success') ? 'failed' : 'passed';
    const reviews = reviewPages as Array<{ state?: unknown; submitted_at?: unknown; commit_id?: unknown; user?: { login?: unknown } }>;
    const sha = String(pr.head!.sha);
    const latestByReviewer = new Map<string, typeof reviews[number]>();
    for (const review of reviews.filter(item => item.commit_id === sha && typeof item.user?.login === 'string' && ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(String(item.state))).sort((a, b) => String(a.submitted_at).localeCompare(String(b.submitted_at)))) latestByReviewer.set(review.user!.login as string, review);
    const headReviews = [...latestByReviewer.values()];
    const reviewStatus = headReviews.some(review => review.state === 'CHANGES_REQUESTED') ? 'changes-requested' : headReviews.some(review => review.state === 'APPROVED') ? 'approved-unverified' : reviews.some(review => ['APPROVED', 'CHANGES_REQUESTED'].includes(String(review.state))) ? 'unverified' : 'unreviewed';
    const currentSource = localReviewSnapshot(directory);
    const localHead = currentHead.trim();
    return {
      taskID, number, url: String(pr.html_url), state: String(pr.state), draft: pr.draft as boolean,
      head: sha, headRef: String(pr.head!.ref), headRepository: headRepo, base: String(pr.base!.sha), baseRef: String(pr.base!.ref), checks: checkStatus, review: reviewStatus,
      source: localHead === sha && currentSource.snapshot === localReviewSnapshot(directory).snapshot && !hasDirtySource(directory) ? 'current' : 'stale-source',
      sourceSnapshot: currentSource.snapshot, updatedAt: requestedAt,
    };
  };
  const registration = await ctx.rpc.register(PullRequests, {
    list: async (value, call) => {
      try {
        const input = value as { sessionID: string; taskID: string };
        const owned = await taskFor(input.sessionID, input.taskID, call.signal);
        const current = localReviewSnapshot(owned.directory);
        const dirty = hasDirtySource(owned.directory);
        const pullRequests = read(owned.journalPath, owned.task.id);
        return { pullRequests: pullRequests.map(pr => ({ ...pr, taskID: owned.task.id, source: !dirty && current.snapshot === pr.sourceSnapshot && current.head === pr.head ? 'current' : 'stale-source' })) };
      } catch (error) { return failure(call, error); }
    },
    associate: async (value, call) => {
      try {
        const input = value as { sessionID: string; taskID: string; number?: number };
        if (!Number.isSafeInteger(input.number) || input.number! < 1) throw new PullRequestFailure('invalid_request', 'A positive pull request number is required');
        const owned = await taskFor(input.sessionID, input.taskID, call.signal);
        const repo = await repository(owned.directory);
        const record = await fetch(owned.directory, repo, input.number!, owned.task.id, call.signal);
        const unlock = await acquireLock(owned.lockPath, call.signal);
        try {
          const records = read(owned.journalPath, owned.task.id);
          const previous = records.find(item => item.number === record.number);
          const chosen = previous && Date.parse(previous.updatedAt) >= Date.parse(record.updatedAt) ? previous : record;
          const merged = records.filter(item => item.number !== record.number);
          if (!previous && merged.length >= MAX_ASSOCIATIONS) throw new PullRequestFailure('cache_limit', 'Task already has the maximum of 100 associated pull requests');
          merged.push(chosen);
          write(owned.journalPath, merged);
          return { pullRequest: chosen };
        } finally { unlock(); }
      } catch (error) { return failure(call, error); }
    },
    refresh: async (value, call) => {
      try {
        const input = value as { sessionID: string; taskID: string; number?: number };
        const owned = await taskFor(input.sessionID, input.taskID, call.signal);
        const before = read(owned.journalPath, owned.task.id);
        const number = input.number ?? before.at(-1)?.number;
        if (!Number.isSafeInteger(number) || number! < 1 || !before.some(item => item.number === number)) throw new PullRequestFailure('not_associated', 'Pull request is not associated with this task');
        const repo = await repository(owned.directory);
        const record = await fetch(owned.directory, repo, number!, owned.task.id, call.signal);
        const unlock = await acquireLock(owned.lockPath, call.signal);
        try {
          const records = read(owned.journalPath, owned.task.id);
          const index = records.findIndex(item => item.number === number);
          if (index < 0) throw new PullRequestFailure('not_associated', 'Pull request association was removed during refresh');
          const current = records[index]!;
          const chosen = Date.parse(current.updatedAt) >= Date.parse(record.updatedAt) ? current : record;
          records[index] = chosen;
          write(owned.journalPath, records);
          return { pullRequest: chosen };
        } finally { unlock(); }
      } catch (error) { return failure(call, error); }
    },
  });
  return () => registration.dispose();
}
