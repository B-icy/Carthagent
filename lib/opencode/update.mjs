/** Shared native update operation for CLI and interactive callers. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { compareVersions, cleanStaleGlobalInstall, detectInstallMethod as detectDefaultInstallMethod, fetchLatestRelease, packageVersion } from '../update.mjs';

const SEMVER_TAG = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const MAX_OUTPUT = 64 * 1024;

function withoutRuntimeGithubToken(env) {
  const sanitized = { ...env };
  for (const key of Object.keys(sanitized)) {
    if (key.toUpperCase() === 'CTG_RUNTIME_GITHUB_TOKEN') delete sanitized[key];
  }
  return sanitized;
}

/** Run a bounded child process and retain only a bounded combined output tail. */
export function runUpdateCommand(argv, { cwd, timeoutSeconds = 600, env = process.env, signal } = {}) {
  return new Promise(resolve => {
    let output = '';
    let timedOut = false;
    let settled = false;
    if (signal?.aborted) { resolve({ code: 1, output: String(signal.reason ?? 'aborted'), timedOut: false, cancelled: true }); return; }
    const child = spawn(argv[0], argv.slice(1), { cwd, env: withoutRuntimeGithubToken(env), windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const append = chunk => {
      output = (output + chunk.toString()).slice(-MAX_OUTPUT);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    let hardStop;
    let killTimer;
    let cancelled = false;
    const stop = (force = false) => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
        else {
          if (process.platform === 'win32' && child.pid) {
            const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', ...(force ? ['/f'] : [])], { windowsHide: true, stdio: 'ignore' });
            killer.unref();
          }
          child.kill(force ? 'SIGKILL' : 'SIGTERM');
        }
      } catch { /* already exited */ }
    };
    const onAbort = () => {
      cancelled = true;
      stop();
      killTimer = setTimeout(() => stop(true), 1500);
      killTimer.unref?.();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
      hardStop = setTimeout(() => stop(true), 5000);
      hardStop.unref?.();
    }, Math.max(1, timeoutSeconds) * 1000);
    timer.unref?.();
    const finish = code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(hardStop);
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ code: Number.isInteger(code) ? code : 1, output, timedOut, cancelled });
    };
    child.on('error', error => { append(error.message); finish(1); });
    child.on('close', finish);
  });
}

function npmArgv(args, platform = process.platform) {
  // npm is a .cmd shim on Windows. Keep arguments as argv rather than a shell string.
  return platform === 'win32' ? ['cmd.exe', '/d', '/s', '/c', 'npm', ...args] : ['npm', ...args];
}

function emit(io, level, message) {
  const fn = io?.[level] || io?.log;
  if (typeof fn === 'function') fn.call(io, message);
}

function commandSucceeded(result) {
  return result?.code === 0 && result.timedOut !== true && result.cancelled !== true;
}

function commandFailure(label, result) {
  const status = result?.timedOut ? ' (timed out)' : result?.cancelled ? ' (cancelled)' : '';
  const detail = result?.output?.trim();
  return new Error(`${label} failed${status}${detail ? `:\n${detail}` : ''}`);
}

function validatedRelease(release) {
  if (!release || typeof release !== 'object') throw new Error('Latest release response is invalid.');
  const version = String(release.version || '');
  const tag = String(release.tag || '');
  if (!SEMVER_TAG.test(tag) || !SEMVER_TAG.test(version) || tag.replace(/^v/, '') !== version.replace(/^v/, '')) {
    throw new Error('Latest release has an invalid or mismatched version tag.');
  }
  const expectedSpec = `github:B-icy/Carthagent#${tag}`;
  if (release.installSpec !== expectedSpec) throw new Error('Latest release install spec is not pinned to its validated release tag.');
  return { ...release, version, tag, installSpec: expectedSpec };
}

/**
 * Resolve and apply an update without terminating the host process.
 *
 * Returns `{status, release, method}` where status is `updated`, `current`,
 * `ahead`, or `available` (`--check`). Failures throw after a bounded command
 * reports a non-zero exit, allowing CLI/UI hosts to choose their own UX.
 */
export async function runNativeUpdate({
  args = [], io = console, cwd = process.cwd(), root = cwd,
  fetchLatestRelease: fetchRelease = fetchLatestRelease,
  detectInstallMethod = detectDefaultInstallMethod,
  runCommand = runUpdateCommand,
  cleanStaleInstall = cleanStaleGlobalInstall,
  currentVersion,
  platform = process.platform,
  nodeVersion = process.versions.node,
  signal,
  allowCloneUpdate = true,
} = {}) {
  signal?.throwIfAborted();
  let checkOnly = false;
  let force = false;
  for (const arg of args) {
    if (arg === '--check') checkOnly = true;
    else if (arg === '--force') force = true;
    else throw new Error(`Unknown update option: ${arg}`);
  }

  const resolved = await fetchRelease({ signal });
  signal?.throwIfAborted();
  const release = validatedRelease(resolved?.release ?? resolved);
  const installed = currentVersion || packageVersion();
  if (!installed) throw new Error('Cannot determine the installed Carthagent version.');
  const delta = compareVersions(installed, release.version);
  if (release.minNode && compareVersions(nodeVersion, release.minNode) < 0) {
    throw new Error(`Carthagent ${release.version} requires Node ≥ ${release.minNode} — this runtime is ${nodeVersion}`);
  }
  if (delta === 0 && !force) {
    emit(io, 'log', `Carthagent ${installed} is already the latest release.`);
    return { status: 'current', release };
  }
  if (delta > 0 && !force) {
    emit(io, 'log', `Installed ${installed} is ahead of latest release ${release.version} — pass --force to reinstall anyway.`);
    return { status: 'ahead', release };
  }
  if (checkOnly) {
    emit(io, 'log', `Carthagent ${release.version} is available${release.note ? ` — ${release.note}` : ''} (installed: ${installed}) — run ctg update`);
    return { status: 'available', release };
  }

  const method = detectInstallMethod(root);
  signal?.throwIfAborted();
  emit(io, 'log', `Updating Carthagent ${installed} → ${release.version} (${method} install)`);
  const run = async (argv, label, timeoutSeconds = 600) => {
    signal?.throwIfAborted();
    const result = await runCommand(argv, { cwd: root, timeoutSeconds, ...(signal ? { signal } : {}) });
    if (!commandSucceeded(result)) throw commandFailure(label, result);
    return result;
  };
  const installGlobal = async (argv, label) => {
    signal?.throwIfAborted();
    let result = await runCommand(argv, { cwd: root, timeoutSeconds: 600, ...(signal ? { signal } : {}) });
    if (!commandSucceeded(result) && !result?.timedOut && !result?.cancelled && /\bENOTDIR\b|\bEEXIST\b|\bENOTEMPTY\b/.test(result?.output || '')) {
      const probe = await runCommand(npmArgv(['root', '-g'], platform), { cwd: root, timeoutSeconds: 30, ...(signal ? { signal } : {}) });
      const removed = commandSucceeded(probe) ? cleanStaleInstall(probe.output.trim()) : [];
      if (removed.length) {
        emit(io, 'log', `Removed stale global install ${removed.length === 1 ? 'entry' : 'entries'} — retrying.`);
        result = await runCommand(argv, { cwd: root, timeoutSeconds: 600, ...(signal ? { signal } : {}) });
      }
    }
    if (!commandSucceeded(result)) throw commandFailure(label, result);
  };

  if (method === 'clone') {
    if (!allowCloneUpdate) throw new Error('Native update refuses to checkout a release into the active source tree. Install Carthagent as an npm package or use `ctg update --check`.');
    signal?.throwIfAborted();
    const dirty = await runCommand(['git', 'status', '--porcelain'], { cwd: root, timeoutSeconds: 30, ...(signal ? { signal } : {}) });
    if (!commandSucceeded(dirty)) throw new Error(`Cannot inspect the clone at ${root}${dirty?.output ? `: ${dirty.output.trim()}` : dirty?.timedOut ? ' (timed out)' : dirty?.cancelled ? ' (cancelled)' : ''}`);
    if (dirty.output?.trim()) throw new Error(`The clone at ${root} has uncommitted changes. Commit, stash, or update it manually.`);
    // Fetch this specific remote tag into a fresh private ref. This avoids
    // trusting a pre-existing local tag and never overwrites user's local tags.
    const fetchedRef = `refs/opencode-update/${randomUUID()}`;
    let fetched = false;
    try {
      await run(['git', 'fetch', '--no-tags', 'origin', `refs/tags/${release.tag}:${fetchedRef}`], `git fetch ${release.tag}`, 120);
      fetched = true;
      const resolved = await run(['git', 'rev-parse', '--verify', `${fetchedRef}^{commit}`], `resolve fetched tag ${release.tag}`, 30);
      const commit = resolved.output.trim();
      if (!/^[0-9a-f]{40,64}$/i.test(commit)) throw new Error(`Could not resolve fetched release tag ${release.tag} to a commit.`);
      await run(['git', 'checkout', '--detach', commit], `git checkout ${release.tag}`, 60);
    } finally {
      if (fetched) {
        // Deleting our uniquely generated ref is best-effort and cannot touch
        // any existing user tag or branch.
        await runCommand(['git', 'update-ref', '-d', fetchedRef], { cwd: root, timeoutSeconds: 30, ...(signal ? { signal } : {}) });
      }
    }
    await run(npmArgv(['ci'], platform), 'npm ci');
    await installGlobal(npmArgv(['install', '-g', '.'], platform), 'npm install -g .');
  } else if (method === 'npm') {
    await installGlobal(npmArgv(['install', '-g', '--install-links=true', release.installSpec], platform), `npm install ${release.installSpec}`);
  } else {
    throw new Error(`Unsupported install method: ${method}`);
  }
  emit(io, 'log', `Carthagent updated to ${release.version}. Restart any running console to pick it up.`);
  return { status: 'updated', release, method };
}

export { npmArgv as npmUpdateArgv };
