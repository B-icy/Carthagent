import { open, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { OPENCODE_VERSION, provisionRuntime, resolveOpenCode, runtimeEnvironment, runtimePaths } from './runtime.mjs';

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
    if (body.version !== OPENCODE_VERSION || (info.pid && body.pid !== info.pid)) return undefined;
    return { version: body.version, pid: body.pid, server: body, url: info.url };
  } catch { return undefined; }
}

/** Ensure one authenticated, persistent service under CTG's private XDG roots. */
export async function ensureService(options = {}) {
  const paths = await provisionRuntime(options);
  const binary = await resolveOpenCode(options);
  const env = runtimeEnvironment(options);
  const deadline = Date.now() + (options.startupTimeout ?? 15000);
  let child;
  let spawnError;
  let lock;
  let ownsLock = false;
  let lastError;
  while (Date.now() < deadline) {
    const info = await registration(paths.serviceFile).catch((error) => { lastError = error; return undefined; });
    if (info) {
      const healthy = await inspect(info, Math.min(1000, Math.max(100, deadline - Date.now())));
      if (healthy) {
        await lock?.close().catch(() => {});
        if (ownsLock) await rm(`${paths.serviceFile}.lock`, { force: true });
        return Object.freeze({ ...healthy, info, headers: authHeaders(info), paths, binary });
      }
      if (info.pid) {
        let alive = true;
        try { process.kill(info.pid, 0); } catch { alive = false; }
        if (!alive) await rm(paths.serviceFile, { force: true });
      }
    }
    if (spawnError) throw new Error(`Unable to start CTG OpenCode service: ${spawnError.message}`, { cause: spawnError });
    if (!lock) {
      try { lock = await open(`${paths.serviceFile}.lock`, 'wx', 0o600); ownsLock = true; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    if (lock && !child) {
      const port = await reservePort();
      let stderr = '';
      child = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
        env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
      });
      const onOutput = (chunk) => {
        stderr = (stderr + chunk).slice(-8192);
        const password = stderr.match(/server password\s+([^\s]+)/)?.[1];
        if (password && child.pid) writeFile(paths.serviceFile, JSON.stringify({ id: `ctg-${child.pid}`, pid: child.pid, url: `http://127.0.0.1:${port}`, password, version: OPENCODE_VERSION }), { mode: 0o600 }).catch((error) => { spawnError = error; });
      };
      child.stdout.setEncoding('utf8').on('data', onOutput);
      child.stderr.setEncoding('utf8').on('data', onOutput);
      child.stdout.unref?.();
      child.stderr.unref?.();
      child.unref();
      child.once('error', (error) => { spawnError = error; });
      child.once('exit', (code, signal) => {
        if (code !== 0 && code !== null) spawnError = new Error(`process exited ${code} (${signal ?? 'no signal'}): ${stderr}`);
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await lock?.close().catch(() => {});
  if (ownsLock) await rm(`${paths.serviceFile}.lock`, { force: true });
  if (spawnError) throw new Error(`Unable to start CTG OpenCode service: ${spawnError.message}`, { cause: spawnError });
  throw new Error(`CTG OpenCode service did not become healthy within ${options.startupTimeout ?? 15000}ms${lastError ? ` (${lastError.message})` : ''}`);
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Send a native OpenCode HTTP API request to an ensured CTG service. */
export async function serviceRequest(service, method, endpoint, options = {}) {
  const url = new URL(endpoint, service.url);
  const response = await fetch(url, {
    method,
    headers: { ...service.headers, ...(options.body === undefined ? {} : { 'content-type': 'application/json' }), ...(options.headers ?? {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  if (!response.ok) throw new Error(`OpenCode API ${method} ${url.pathname} failed (${response.status}): ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}

export async function createSession(service, workspace, options = {}) {
  const result = await serviceRequest(service, 'POST', '/api/session', { ...options, body: { ...(options.body ?? {}), location: { directory: workspace } } });
  return result?.data ?? result;
}

export async function promptSession(service, sessionID, prompt, options = {}) {
  const result = await serviceRequest(service, 'POST', `/api/session/${encodeURIComponent(sessionID)}/prompt`, {
    ...options,
    body: { ...(options.body ?? {}), text: prompt },
  });
  return result?.data ?? result;
}

export async function cancelSession(service, sessionID, options = {}) {
  const result = await serviceRequest(service, 'POST', `/api/session/${encodeURIComponent(sessionID)}/interrupt`, options);
  return result?.data ?? result;
}

export async function sessionMessages(service, sessionID, options = {}) {
  const result = await serviceRequest(service, 'GET', `/api/session/${encodeURIComponent(sessionID)}/message`, options);
  return result?.data ?? result;
}

export function launchTui(service, workspace, options = {}) {
  const args = [workspace];
  if (options.sessionID) args.push('--session', options.sessionID);
  if (options.continue) args.push('--continue');
  const child = spawn(service.binary, args, {
    cwd: workspace,
    env: runtimeEnvironment({ root: service.paths.root, env: options.env }),
    stdio: 'inherit',
  });
  return child;
}

export { runtimePaths };
