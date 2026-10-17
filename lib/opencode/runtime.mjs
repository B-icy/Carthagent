import { chmod, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const OPENCODE_VERSION = '2.0.32';
const DEFAULT_ROOT = path.join(homedir(), '.carthagent', 'opencode');
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function abs(value) { return path.resolve(value); }

/** Return the isolated CTG OpenCode filesystem layout. */
export function runtimePaths(options = {}) {
  const root = abs(options.root ?? process.env.CTG_OPENCODE_HOME ?? DEFAULT_ROOT);
  return Object.freeze({
    root,
    home: path.join(root, 'home'),
    appData: path.join(root, 'home', 'AppData', 'Roaming'),
    localAppData: path.join(root, 'home', 'AppData', 'Local'),
    config: path.join(root, 'config'),
    configDir: path.join(root, 'config', 'opencode'),
    data: path.join(root, 'data'),
    state: path.join(root, 'state'),
    cache: path.join(root, 'cache'),
    serviceFile: path.join(root, 'state', 'opencode', 'service.json'),
    credentials: path.join(root, 'data', 'opencode', 'auth.json'),
    configFile: path.join(root, 'config', 'opencode', 'opencode.json'),
    lifecycleLock: path.join(root, 'state', 'opencode', 'lifecycle.lock'),
    profileLock: path.join(root, 'state', 'opencode', 'profile.lock'),
  });
}

/** Find a CTG/OpenCode executable without downloading or replacing user binaries. */
export async function resolveOpenCode(options = {}) {
  const explicit = options.binary ?? process.env.CTG_OPENCODE_BIN;
  const packaged = path.join(PACKAGE_ROOT, 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe');
  const candidates = explicit ? [explicit] : [packaged];
  for (const candidate of candidates) {
    if (candidate.includes(path.sep)) {
      try {
        const result = await runCapture(candidate, ['--version'], { timeout: 5000 });
        const version = result.stdout.trim().match(/(?:opencode\s+)?v?(\d+\.\d+\.\d+)/i)?.[1];
        if (version !== OPENCODE_VERSION) throw new Error(`OpenCode ${OPENCODE_VERSION} is required; found ${version ?? 'unknown'} at ${candidate}`);
        return abs(candidate);
      } catch (error) {
        if (explicit || /is required/.test(error.message)) throw error;
      }
    } else {
      try {
        const result = await runCapture(candidate, ['--version'], { timeout: 5000 });
        const version = result.stdout.trim().match(/(?:opencode\s+)?v?(\d+\.\d+\.\d+)/i)?.[1];
        if (version !== OPENCODE_VERSION) throw new Error(`OpenCode ${OPENCODE_VERSION} is required; found ${version ?? 'unknown'} on PATH`);
        return candidate;
      } catch (error) {
        if (explicit || /is required/.test(error.message)) throw error;
      }
    }
  }
  throw new Error(`Packaged OpenCode ${OPENCODE_VERSION} was not found at ${packaged}. Reinstall CTG or set CTG_OPENCODE_BIN explicitly; CTG will not use or replace another OpenCode installation.`);
}

/** Construct the environment for CTG-owned OpenCode children. */
export function runtimeEnvironment(options = {}) {
  const paths = runtimePaths(options);
  // OpenCode has many profile/config switches; do not inherit ambient host
  // overrides. Workspace child environments are restored through the native
  // session.environment API, not through this host process environment.
  const inherited = { ...process.env, ...(options.env ?? {}) };
  const env = Object.fromEntries(Object.entries(inherited).filter(([key]) => !key.startsWith('OPENCODE_')));
  Object.assign(env, {
    XDG_CONFIG_HOME: paths.config,
    XDG_DATA_HOME: paths.data,
    XDG_STATE_HOME: paths.state,
    XDG_CACHE_HOME: paths.cache,
    HOME: paths.home,
    APPDATA: paths.appData,
    LOCALAPPDATA: paths.localAppData,
    OPENCODE_TEST_HOME: paths.home,
    USERPROFILE: paths.home,
    OPENCODE_DB: path.join(paths.data, 'opencode.db'),
    OPENCODE_CONFIG: paths.configFile,
    OPENCODE_CONFIG_DIR: paths.configDir,
    OPENCODE_CONFIG_PROJECT_DISABLE: 'true',
    OPENCODE_DISABLE_MODELS_FETCH: 'true',
    OPENCODE_DISABLE_CLAUDE_CODE: 'true',
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: 'true',
    OPENCODE_DISABLE_AUTOUPDATE: 'true',
    CTG_OPENCODE_HOME: paths.root,
  });
  return env;
}

/** Ensure private persistent directories and CTG profile/plugin config exist. */
export async function provisionRuntime(options = {}) {
  const paths = runtimePaths(options);
  for (const directory of [paths.root, paths.home, paths.appData, paths.localAppData, paths.config, paths.configDir, paths.data, paths.state, path.dirname(paths.serviceFile), paths.cache]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => {});
  }
  await withFileLock(paths.profileLock, async () => {
    let current = {};
    try {
      current = JSON.parse(await readFile(paths.configFile, 'utf8'));
      if (!current || typeof current !== 'object' || Array.isArray(current)) throw new Error('expected a JSON object');
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Cannot preserve CTG OpenCode profile at ${paths.configFile}: ${error.message}`);
    }
    const config = { ...current, ...(options.profile ?? {}), $schema: current.$schema ?? 'https://opencode.ai/config.json' };
    if (options.pluginPath) {
      const plugin = abs(options.pluginPath);
      config.plugins = [...new Set([...(Array.isArray(config.plugins) ? config.plugins : []), plugin])];
    }
    await atomicWrite(paths.configFile, `${JSON.stringify(config, null, 2)}\n`, 0o600);
  });
  return paths;
}

export async function atomicWrite(file, contents, mode = 0o600) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', mode);
  try {
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    await rename(temporary, file);
    await chmod(file, mode).catch(() => {});
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/** Cross-process exclusive lock with bounded wait and dead-owner recovery. */
export async function withFileLock(file, action, options = {}) {
  const timeout = options.timeout ?? 15000;
  const deadline = Date.now() + timeout;
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  let handle;
  const token = randomUUID();
  while (!handle) {
    if (Date.now() >= deadline) throw lockTimeoutError(file);
    try {
      handle = await open(file, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, token, startedAt: Date.now() }));
      await handle.sync();
    } catch (error) {
      if (error.code !== 'EEXIST') {
        await handle?.close().catch(() => {});
        handle = undefined;
        await rm(file, { force: true }).catch(() => {});
        throw error;
      }
      let owner;
      let observed;
      try { observed = await readFile(file, 'utf8'); owner = JSON.parse(observed); } catch {}
      const abandoned = owner?.pid ? !processAlive(owner.pid) : await stat(file)
        .then((details) => Date.now() - details.mtimeMs >= (options.staleLockAge ?? 5000))
        .catch(() => false);
      if (abandoned) {
        await options.afterStaleLockCheck?.({ file, owner });
        // Recovery itself is serialized. Never rename/unlink the contested
        // pathname after inspecting it: another contender may have replaced
        // that pathname with a fresh lock in the meantime.
        let recovery;
        try { recovery = await open(`${file}.recovery`, 'wx', 0o600); }
        catch (lockError) {
          if (lockError.code !== 'EEXIST') throw lockError;
          await new Promise((resolve) => setTimeout(resolve, Math.min(options.pollInterval ?? 40, Math.max(1, deadline - Date.now()))));
          continue;
        }
        const recoveryToken = JSON.stringify({ pid: process.pid, token: randomUUID() });
        try {
          await recovery.writeFile(recoveryToken);
          await recovery.sync();
          const latest = await readFile(file, 'utf8').catch(() => '');
          let latestOwner;
          try { latestOwner = JSON.parse(latest); } catch {}
          if (latest === observed) {
            const stillAbandoned = latestOwner?.pid
              ? !processAlive(latestOwner.pid)
              : await stat(file).then((details) => Date.now() - details.mtimeMs >= (options.staleLockAge ?? 5000)).catch(() => false);
            if (stillAbandoned) await rm(file, { force: true });
          }
        } finally {
          const currentRecovery = await readFile(`${file}.recovery`, 'utf8').catch(() => '');
          try { if (currentRecovery === recoveryToken) await rm(`${file}.recovery`, { force: true }); } catch {}
          await recovery.close();
        }
        continue;
      }
      if (Date.now() >= deadline) throw lockTimeoutError(file, owner);
      await new Promise((resolve) => setTimeout(resolve, Math.min(options.pollInterval ?? 40, Math.max(1, deadline - Date.now()))));
    }
  }
  try { return await action(); }
  finally {
    const owner = await readFile(file, 'utf8').catch(() => '');
    try { if (JSON.parse(owner).token === token) await rm(file, { force: true }); } catch {}
    await handle.close();
  }
}

function lockTimeoutError(file, owner) {
  const recovery = `${file}.recovery`;
  return new Error(`Timed out waiting for CTG runtime lock ${file}${owner?.pid ? ` held by process ${owner.pid}` : ''}. If no CTG process is recovering it, inspect and remove the stale lock/recovery files (${file} and ${recovery}) before retrying.`);
}

export function processAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

/** Run a child process with bounded startup and captured diagnostic output. */
export function runCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const cap = options.maxOutput ?? 256 * 1024;
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout = (stdout + chunk).slice(-cap); });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr = (stderr + chunk).slice(-cap); });
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`${command} timed out after ${options.timeout ?? 30000}ms`)); }, options.timeout ?? 30000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr, code });
      else reject(new Error(`${command} exited ${code ?? signal}: ${(stderr || stdout).trim().slice(-4000)}`));
    });
  });
}

/** Preserve workspace authentication/environment: do not apply CTG host XDG overrides. */
export function workspaceEnvironment(workspace, env = process.env) {
  return { ...env, CTG_WORKSPACE: abs(workspace) };
}

export async function readRuntimeCredentials(options = {}) {
  const file = runtimePaths(options).credentials;
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}
