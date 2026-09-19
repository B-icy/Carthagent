const DEFAULT_CLOUD_URL = 'https://api.carthagent.xyz';
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const MAX_ERROR_DETAIL = 240;

let spawnProcess = null;

export const CARTHAGENT_CLOUD_URL_ENV = 'CARTHAGENT_CLOUD_URL';

export function cloudControlUrl(env = process.env) {
  const override = env?.[CARTHAGENT_CLOUD_URL_ENV]?.trim();
  return (override || DEFAULT_CLOUD_URL).replace(/\/+$/, '');
}

function abortError(signal) {
  return signal?.reason instanceof Error ? signal.reason : new Error('cancelled');
}

export async function openBrowser(url, { platform = process.platform, env = process.env, spawnImpl } = {}) {
  const target = String(url || '').trim();
  if (!/^https?:\/\//i.test(target)) return false;
  if (!spawnImpl) {
    spawnProcess ||= import('node:child_process').then(module => module.spawn);
    spawnImpl = await spawnProcess;
  }
  let command;
  let args;
  if (platform === 'darwin') [command, args] = ['open', [target]];
  else if (platform === 'win32') [command, args] = ['cmd.exe', ['/d', '/s', '/c', 'start', '', target.replace(/&/g, '^&')]];
  else if (env?.WSL_DISTRO_NAME || env?.WSL_INTEROP) [command, args] = ['cmd.exe', ['/d', '/s', '/c', 'start', '', target.replace(/&/g, '^&')]];
  else [command, args] = ['xdg-open', [target]];
  return new Promise(resolve => {
    try {
      const child = spawnImpl(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
      let settled = false;
      const done = value => { if (!settled) { settled = true; resolve(value); } };
      child.once?.('error', () => done(false));
      child.once?.('spawn', () => { child.unref?.(); done(true); });
      setTimeout(() => done(true), 100).unref?.();
    } catch { resolve(false); }
  });
}

export function delay(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, Math.max(0, ms));
    function done() { signal?.removeEventListener('abort', cancelled); resolve(); }
    function cancelled() { clearTimeout(timer); signal?.removeEventListener('abort', cancelled); reject(abortError(signal)); }
    signal?.addEventListener('abort', cancelled, { once: true });
  });
}

function errorCode(payload, fallback) {
  if (typeof payload?.error === 'string' && payload.error) return payload.error;
  if (typeof payload?.error?.code === 'string' && payload.error.code) return payload.error.code;
  if (typeof payload?.error?.message === 'string' && payload.error.message) return payload.error.message;
  return fallback;
}

function errorWithCode(code, status, detail) {
  const error = new Error(code || `cloud_http_${status}`);
  error.code = code || `cloud_http_${status}`;
  error.status = status;
  if (detail) error.detail = detail;
  return error;
}

export class CloudClient {
  constructor({ baseUrl = cloudControlUrl(), fetchImpl = globalThis.fetch, sleep = delay } = {}) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.fetch = fetchImpl;
    this.sleep = sleep;
  }

  async request(path, { method = 'GET', accessToken, body, signal } = {}) {
    if (typeof this.fetch !== 'function') throw new Error('Carthagent Cloud requires fetch support.');
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method, headers, signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = null; }
    }
    if (!response.ok) {
      const fallback = `cloud_http_${response.status}`;
      throw errorWithCode(errorCode(payload, fallback), response.status, text.slice(0, MAX_ERROR_DETAIL));
    }
    return payload ?? {};
  }

  createDeviceAuthorization({ clientName = 'Carthagent CLI', signal } = {}) {
    return this.request('/v1/device/authorizations', { method: 'POST', body: { clientName }, signal });
  }

  pollDeviceToken({ deviceCode, signal } = {}) {
    return this.request('/v1/device/token', { method: 'POST', body: { deviceCode }, signal });
  }

  refresh({ refreshToken, signal } = {}) {
    return this.request('/v1/token/refresh', { method: 'POST', body: { refreshToken }, signal });
  }

  account({ accessToken, signal } = {}) {
    return this.request('/v1/account', { accessToken, signal });
  }

  revokeCurrent({ accessToken, signal } = {}) {
    return this.request('/v1/token/revoke', { method: 'POST', accessToken, signal });
  }

  revokeSession({ accessToken, sessionId, signal } = {}) {
    return this.request(`/v1/account/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE', accessToken, signal });
  }

  checkout({ accessToken, successUrl, cancelUrl, signal } = {}) {
    return this.request('/v1/billing/checkout', { method: 'POST', accessToken, body: { successUrl, cancelUrl }, signal });
  }

  portal({ accessToken, returnUrl, signal } = {}) {
    return this.request('/v1/billing/portal', { method: 'POST', accessToken, body: { returnUrl }, signal });
  }

  async authorizeDevice({ clientName = 'Carthagent CLI', notify = () => {}, signal } = {}) {
    const authorization = await this.createDeviceAuthorization({ clientName, signal });
    const verificationUri = authorization.verificationUriComplete || authorization.verificationUri;
    notify({
      type: 'device_code',
      userCode: authorization.userCode,
      verificationUri,
      intervalSeconds: authorization.interval,
      expiresInSeconds: authorization.expiresIn,
    });
    notify({ type: 'auth_url', url: verificationUri, instructions: `Approve device code ${authorization.userCode} in your browser.` });
    const deadline = Date.now() + Number(authorization.expiresIn || 600) * 1000;
    const interval = Math.max(1_000, Number(authorization.interval || DEFAULT_POLL_INTERVAL_MS / 1000) * 1000);
    while (Date.now() < deadline) {
      if (signal?.aborted) throw abortError(signal);
      try {
        return await this.pollDeviceToken({ deviceCode: authorization.deviceCode, signal });
      } catch (error) {
        if (error.code !== 'authorization_pending') throw error;
      }
      notify({ type: 'progress', message: 'Waiting for browser approval…' });
      await this.sleep(interval, signal);
    }
    throw errorWithCode('expired_token', 410);
  }
}

export function oauthCredentials(tokens, now = Date.now()) {
  if (!tokens?.accessToken || !tokens?.refreshToken || !Number.isFinite(Number(tokens.expiresIn))) throw new Error('invalid_token_response');
  return {
    access: tokens.accessToken,
    refresh: tokens.refreshToken,
    expires: now + Math.max(1, Number(tokens.expiresIn)) * 1000,
  };
}

export function formatNanoUsd(value) {
  if (!Number.isSafeInteger(value)) return 'unavailable';
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  const dollars = Math.floor(absolute / 1_000_000_000);
  const cents = Math.floor((absolute % 1_000_000_000) / 10_000_000);
  return `${sign}$${dollars}.${String(cents).padStart(2, '0')}`;
}

export function formatCloudAccount(account) {
  const subscription = account?.subscription || {};
  const lines = [
    `Carthagent Cloud account ${account?.accountId || 'unknown'}`,
    `Credit: ${formatNanoUsd(account?.balance?.availableNanoUsd)} available`,
    `Plan: ${subscription.status && subscription.status !== 'none' ? `Builder (${subscription.status})` : 'Free'}`,
  ];
  if (Number.isFinite(Number(subscription.current_period_end))) lines.push(`Renews/ends: ${new Date(Number(subscription.current_period_end) * 1000).toISOString()}`);
  const sessions = Array.isArray(account?.sessions) ? account.sessions : [];
  const active = sessions.filter(session => !session.revoked_at).length;
  lines.push(`CLI sessions: ${active} active, ${sessions.length - active} revoked`);
  return lines.join('\n');
}
