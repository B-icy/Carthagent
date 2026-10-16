import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const OPENCODE_VERSION = '2.0.32';
const DEFAULT_ROOT = path.join(homedir(), '.carthagent', 'opencode');

function abs(value) { return path.resolve(value); }

/** Return the isolated CTG OpenCode filesystem layout. */
export function runtimePaths(options = {}) {
  const root = abs(options.root ?? process.env.CTG_OPENCODE_HOME ?? DEFAULT_ROOT);
  return Object.freeze({
    root,
    config: path.join(root, 'config'),
    data: path.join(root, 'data'),
    state: path.join(root, 'state'),
    cache: path.join(root, 'cache'),
    serviceFile: path.join(root, 'state', 'opencode', 'service.json'),
    credentials: path.join(root, 'data', 'opencode', 'auth.json'),
    configFile: path.join(root, 'config', 'opencode.json'),
  });
}

/** Find a CTG/OpenCode executable without downloading or replacing user binaries. */
export async function resolveOpenCode(options = {}) {
  const candidates = [options.binary, process.env.CTG_OPENCODE_BIN,
    path.join(homedir(), '.opencode', 'bin', 'opencode'), 'opencode'].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate.includes(path.sep)) {
      try {
        const result = await runCapture(candidate, ['--version'], { timeout: 5000 });
        const version = result.stdout.trim().match(/(?:opencode\s+)?v?(\d+\.\d+\.\d+)/i)?.[1];
        if (version !== OPENCODE_VERSION) throw new Error(`OpenCode ${OPENCODE_VERSION} is required; found ${version ?? 'unknown'} at ${candidate}`);
        return abs(candidate);
      } catch (error) {
        if (/is required/.test(error.message)) throw error;
      }
    } else {
      try {
        const result = await runCapture(candidate, ['--version'], { timeout: 5000 });
        const version = result.stdout.trim().match(/(?:opencode\s+)?v?(\d+\.\d+\.\d+)/i)?.[1];
        if (version !== OPENCODE_VERSION) throw new Error(`OpenCode ${OPENCODE_VERSION} is required; found ${version ?? 'unknown'} on PATH`);
        return candidate;
      } catch (error) {
        if (/is required/.test(error.message)) throw error;
      }
    }
  }
  throw new Error(`OpenCode ${OPENCODE_VERSION} was not found. Set CTG_OPENCODE_BIN to its executable; CTG will not replace another OpenCode installation.`);
}

/** Construct the environment for CTG-owned OpenCode children. */
export function runtimeEnvironment(options = {}) {
  const paths = runtimePaths(options);
  const env = { ...process.env, ...(options.env ?? {}) };
  Object.assign(env, {
    XDG_CONFIG_HOME: paths.config,
    XDG_DATA_HOME: paths.data,
    XDG_STATE_HOME: paths.state,
    XDG_CACHE_HOME: paths.cache,
    OPENCODE_DB: path.join(paths.data, 'opencode.db'),
    OPENCODE_CONFIG: paths.configFile,
    OPENCODE_DISABLE_AUTOUPDATE: 'true',
    CTG_OPENCODE_HOME: paths.root,
  });
  return env;
}

/** Ensure private persistent directories and CTG profile/plugin config exist. */
export async function provisionRuntime(options = {}) {
  const paths = runtimePaths(options);
  for (const directory of [paths.root, paths.config, paths.data, paths.state, path.dirname(paths.serviceFile), paths.cache]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => {});
  }
  const profile = options.profile ?? {};
  const plugin = options.pluginPath;
  const config = {
    $schema: 'https://opencode.ai/config.json',
    ...profile,
    ...(plugin ? { plugins: [abs(plugin), ...(profile.plugins ?? []).filter((x) => x !== plugin)] } : {}),
  };
  await writeFile(paths.configFile, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(paths.configFile, 0o600).catch(() => {});
  return paths;
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
