import { readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { OPENCODE_VERSION, processAlive, provisionRuntime, resolveOpenCode, runtimeEnvironment, runtimeIdentity, runtimePaths, withFileLock, atomicWrite, workspaceEnvironment } from './runtime.mjs';

function authHeaders(info) {
  if (!info.password) return {};
  return { authorization: `Basic ${Buffer.from(`opencode:${info.password}`).toString('base64')}` };
}

async function registration(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw new Error(`Cannot read isolated OpenCode service registration: ${error.message}`); }
}

async function inspect(info, timeout = 1000) {
  try {
    const response = await fetch(new URL('/api/info', info.url), { headers: authHeaders(info), signal: AbortSignal.timeout(timeout) });
    if (!response.ok) return undefined;
    const payload = await response.json();
    const body = payload.data ?? payload;
    if (body.version !== (info.runtimeIdentity?.version ?? info.version) || (info.pid && body.pid !== info.pid)) return undefined;
    if (info.runtimeIdentity?.capabilities?.shellOrigin === true
      && body.capabilities?.shellOrigin !== info.runtimeIdentity.capabilities.shellOrigin) return undefined;
    return { version: body.version, pid: body.pid, server: body, url: info.url };
  } catch { return undefined; }
}

/** Ensure one authenticated, persistent service under CTG's private XDG roots. */
export async function ensureService(options = {}) {
  const paths = await provisionRuntime(options);
  const binary = await resolveOpenCode(options);
  const identity = await runtimeIdentity(binary, options);
  const env = runtimeEnvironment(options);
  return withFileLock(paths.lifecycleLock, async () => {
    // Serialize profile provisioning with lifecycle startup so concurrent
    // launchers cannot race while installing the same theme files.
    const { provisionDefaultNativeTheme } = await import('../../plugins/carthagent/src/ui/theme-provision.mjs');
    await provisionDefaultNativeTheme(paths.configDir);
    const info = await registration(paths.serviceFile);
    if (info) {
      const sameIdentity = JSON.stringify(info.runtimeIdentity) === JSON.stringify(identity);
      const healthy = await inspect(info, options.healthTimeout ?? 1500);
      if (healthy && sameIdentity) return Object.freeze({ ...healthy, info, headers: authHeaders(info), paths, binary, runtimeIdentity: identity });
      if (processAlive(info.pid)) {
        if (!sameIdentity) {
          throw serviceIdentityMismatch(info, identity, paths);
        }
        throw new Error(`CTG OpenCode service process ${info.pid} is alive but unhealthy at ${info.url}; registration was retained to avoid orphaning or duplicating it.`);
      }
      const current = await registration(paths.serviceFile);
      if (current?.id === info.id && current?.pid === info.pid) await rm(paths.serviceFile, { force: true });
    }
    return startService({ paths, binary, env, options, identity });
  }, { timeout: options.lockTimeout ?? 20000 });
}

function serviceIdentityMismatch(info, expected, paths) {
  return new Error(
    `CTG OpenCode service profile is already running runtime ${info.runtimeIdentity?.version ?? 'with unknown identity'} `
    + `(${info.runtimeIdentity?.kind ?? 'legacy'}). This invocation selected ${expected.version} (${expected.kind}). `
    + `The active service was left running; no process was stopped or replaced. `
    + `To switch runtimes, explicitly stop the registered service with stopService({ root: ${JSON.stringify(paths.root)} }) `
    + `while selecting its registered runtime, or choose a separate CTG_OPENCODE_HOME profile.`,
  );
}

/** Stop only the process registered by this CTG profile; never signal a shared service. */
export async function stopService(options = {}) {
  const paths = runtimePaths(options);
  return withFileLock(paths.lifecycleLock, async () => {
    const info = await registration(paths.serviceFile);
    if (!info?.pid) return false;
    const healthy = await inspect(info, options.healthTimeout ?? 1500);
    if (!healthy) {
      if (!processAlive(info.pid)) {
        const current = await registration(paths.serviceFile);
        if (current?.id === info.id && current?.pid === info.pid) await rm(paths.serviceFile, { force: true });
        return false;
      }
      throw new Error(`Refusing to stop CTG OpenCode PID ${info.pid}: the registered process is alive but its service identity cannot be verified. Registration was retained.`);
    }
    const current = await registration(paths.serviceFile);
    if (current?.id !== info.id || current?.pid !== info.pid || current?.url !== info.url) return false;
    try { process.kill(info.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    const deadline = Date.now() + (options.stopTimeout ?? 5000);
    while (Date.now() < deadline) {
      if (!processAlive(info.pid)) {
        const latest = await registration(paths.serviceFile);
        if (latest?.id === info.id && latest?.pid === info.pid) await rm(paths.serviceFile, { force: true });
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`CTG OpenCode service process ${info.pid} did not stop within ${options.stopTimeout ?? 5000}ms`);
  }, { timeout: options.lockTimeout ?? 20000 });
}

async function startService({ paths, binary, env: baseEnv, options, identity }) {
  const deadline = Date.now() + (options.startupTimeout ?? 20000);
  const password = randomBytes(32).toString('base64url');
  const env = { ...baseEnv, OPENCODE_SERVER_PASSWORD: password };
  let output = '';
  let child;
  let settled = false;
  let endpoint;
  let startupFailure;
  let startupTimer;
  const started = new Promise((resolve, reject) => {
    const spawnImpl = options.spawnImpl ?? spawn;
    child = spawnImpl(binary, ['serve', '--hostname', '127.0.0.1', '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const collect = (chunk) => {
      output = (output + chunk.toString()).slice(-8192);
      endpoint = output.match(/server listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1]
        ?? output.match(/"url":"(http:\/\/127\.0\.0\.1:\d+)"/)?.[1]
        ?? endpoint;
      if (endpoint && !settled) { settled = true; clearTimeout(startupTimer); resolve(endpoint); }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', (error) => { startupFailure = error; if (!settled) { settled = true; clearTimeout(startupTimer); reject(error); } });
    child.once('exit', (code, signal) => {
      if (!settled) { settled = true; clearTimeout(startupTimer); reject(new Error(`OpenCode exited ${code ?? signal} before listening: ${output.replaceAll(password, '[redacted]')}`)); }
    });
    startupTimer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error(`OpenCode startup timed out after ${options.startupTimeout ?? 20000}ms`)); }
    }, Math.max(1, deadline - Date.now()));
    child.unref();
  });
  try {
    if (child.pid) {
      await atomicWrite(paths.serviceFile, `${JSON.stringify({
        id: `ctg-${child.pid}-${randomBytes(8).toString('hex')}`,
        pid: child.pid,
        state: 'starting',
        version: identity.version,
        runtimeIdentity: identity,
      })}\n`);
    }
    const url = await started;
    child.stdout.unref?.();
    child.stderr.unref?.();
    const info = { id: `ctg-${child.pid}-${randomBytes(8).toString('hex')}`, pid: child.pid, url, password, version: identity.version, runtimeIdentity: identity };
    await atomicWrite(paths.serviceFile, `${JSON.stringify(info)}\n`);
    const healthy = await inspect(info, Math.max(250, deadline - Date.now()));
    if (!healthy) throw new Error('OpenCode listener started but authenticated service identity did not validate');
    return Object.freeze({ ...healthy, info, headers: authHeaders(info), paths, binary, runtimeIdentity: identity });
  } catch (error) {
    let stopped = !child?.pid || !processAlive(child.pid);
    if (child?.pid && processAlive(child.pid)) {
      try { child.kill('SIGTERM'); } catch {}
      await waitForExit(child.pid, Math.min(5000, options.stopTimeout ?? 5000));
      if (processAlive(child.pid)) {
        try { process.kill(child.pid, 'SIGKILL'); } catch {}
        await waitForExit(child.pid, options.killTimeout ?? 2000);
      }
      stopped = !processAlive(child.pid);
    }
    const registered = await registration(paths.serviceFile).catch(() => undefined);
    if (stopped && registered?.pid === child?.pid) await rm(paths.serviceFile, { force: true });
    if (!stopped) {
      throw new Error(`CTG OpenCode startup failed and process ${child.pid} could not be stopped; ownership registration was retained at ${paths.serviceFile}.`, { cause: error });
    }
    throw new Error(`Unable to start CTG OpenCode service: ${startupFailure?.message ?? error.message}${output ? `\n${output.replaceAll(password, '[redacted]')}` : ''}`, { cause: error });
  }
}

async function waitForExit(pid, milliseconds) {
  const until = Date.now() + milliseconds;
  while (Date.now() < until && processAlive(pid)) await new Promise((resolve) => setTimeout(resolve, 50));
}

/** Send a native OpenCode HTTP API request to an ensured CTG service. */
export async function serviceRequest(service, method, endpoint, options = {}) {
  const url = new URL(endpoint, service.url);
  if (options.location && !url.searchParams.has('location[directory]')) {
    const directory = normalizeDirectory(options.location);
    url.searchParams.set('location[directory]', directory);
  }
  const response = await fetch(url, {
    method,
    headers: { ...service.headers, ...(options.body === undefined ? {} : { 'content-type': 'application/json' }), ...(options.headers ?? {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  if (!response.ok) {
    const error = new Error(`OpenCode API ${method} ${url.pathname} failed (${response.status}): ${typeof data === 'string' ? data : JSON.stringify(data)}`);
    error.status = response.status;
    error.body = data;
    throw error;
  }
  return data;
}

export async function createSession(service, workspace, options = {}) {
  const directory = normalizeDirectory(workspace);
  const result = await serviceRequest(service, 'POST', '/api/session', { ...options, location: directory, body: { ...(options.body ?? {}), location: { directory } } });
  return result?.data ?? result;
}

export async function promptSession(service, sessionID, prompt, options = {}) {
  const result = await serviceRequest(service, 'POST', `/api/session/${encodeURIComponent(sessionID)}/prompt`, {
    ...options,
    location: options.location,
    body: { ...(options.body ?? {}), text: prompt },
  });
  return result?.data ?? result;
}

export async function cancelSession(service, sessionID, options = {}) {
  const { timeout = 5000, ...requestOptions } = options;
  const result = await serviceRequest(service, 'POST', `/api/session/${encodeURIComponent(sessionID)}/interrupt?resume=false`, {
    ...requestOptions,
    location: options.location,
    signal: options.signal ?? AbortSignal.timeout(timeout),
  });
  return result?.data ?? result;
}

export async function sessionMessages(service, sessionID, options = {}) {
  const result = await serviceRequest(service, 'GET', `/api/session/${encodeURIComponent(sessionID)}/message`, { ...options, location: options.location });
  return result?.data ?? result;
}

export async function listPlugins(service, options = {}) {
  const result = await serviceRequest(service, 'GET', '/api/plugin', options);
  return result?.data ?? result;
}

export async function getSession(service, sessionID, options = {}) {
  const result = await serviceRequest(service, 'GET', `/api/session/${encodeURIComponent(sessionID)}`, options);
  return result?.data ?? result;
}

/** Apply the workspace process environment to OpenCode shell commands for a session. */
export async function setSessionEnvironment(service, sessionID, env, options = {}) {
  const directory = normalizeDirectory(options.location ?? process.cwd());
  const result = await serviceRequest(service, 'PUT', `/api/session/${encodeURIComponent(sessionID)}/environment`, {
    ...options,
    location: directory,
    body: { variables: workspaceEnvironment(directory, env) },
  });
  return result?.data ?? result;
}

function normalizeDirectory(location) {
  const directory = typeof location === 'string' ? location : location?.directory;
  if (typeof directory !== 'string' || !directory) throw new TypeError('OpenCode location must include a directory');
  return directory;
}

export function launchTui(service, workspace, options = {}) {
  const args = ['--server', service.url, workspace];
  if (options.sessionID) args.push('--session', options.sessionID);
  if (options.continue) args.push('--continue');
  const child = (options.spawnImpl ?? spawn)(service.binary, args, {
    cwd: workspace,
    env: {
      ...runtimeEnvironment({ root: service.paths.root, env: options.env }),
      OPENCODE_PASSWORD: service.info?.password ?? service.password,
      CTG_WORKSPACE: workspaceEnvironment(workspace, options.env ?? process.env).CTG_WORKSPACE,
    },
    stdio: 'inherit',
  });
  return child;
}

export { runtimePaths, workspaceEnvironment };
