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
    if (typeof this.fetch !== 'function') throw new Error('Carthagent Ship requires fetch support.');
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

  createDeviceAuthorization({ clientName = 'Carthagent CLI', installId = null, signal } = {}) {
    const body = { clientName };
    if (installId) body.installId = installId;
    return this.request('/v1/device/authorizations', { method: 'POST', body, signal });
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

  usage({ accessToken, limit = 50, signal } = {}) {
    const bounded = Number.isSafeInteger(limit) ? Math.max(1, Math.min(200, limit)) : 50;
    return this.request(`/v1/account/usage?limit=${bounded}`, { accessToken, signal });
  }

  revokeCurrent({ accessToken, signal } = {}) {
    return this.request('/v1/token/revoke', { method: 'POST', accessToken, signal });
  }

  revokeSession({ accessToken, sessionId, signal } = {}) {
    return this.request(`/v1/account/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE', accessToken, signal });
  }

  checkout({ accessToken, successUrl, cancelUrl, priceId, signal } = {}) {
    return this.request('/v1/billing/checkout', { method: 'POST', accessToken, body: { successUrl, cancelUrl, priceId }, signal });
  }

  portal({ accessToken, returnUrl, signal } = {}) {
    return this.request('/v1/billing/portal', { method: 'POST', accessToken, body: { returnUrl }, signal });
  }

  async authorizeDevice({ clientName = 'Carthagent CLI', installId = null, notify = () => {}, signal } = {}) {
    const authorization = await this.createDeviceAuthorization({ clientName, installId, signal });
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

function formatEpochSeconds(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
}

export function cloudManagedUsageRecovery(value) {
  const text = String(value?.code || value?.message || value || '');
  if (/daily_limit_reached|managed daily usage limit/i.test(text)) return 'Managed daily usage is exhausted. It resets at 00:00 UTC. Use /account for headroom or /login for BYOK.';
  if (/monthly_allowance_exhausted|managed monthly allowance/i.test(text)) return 'Managed monthly usage is exhausted. Use /billing portal to manage the plan or /login for BYOK.';
  if (/subscription_inactive|managed subscription is not active/i.test(text)) return 'The managed subscription is inactive. Use /billing portal or /login for BYOK.';
  if (/insufficient_quota|insufficient.credit|credit (?:is )?exhausted/i.test(text)) return 'Carthagent Ship credit is exhausted. Use /billing checkout where available or /login for BYOK.';
  return null;
}

const METER_WIDTH = 16;
const meterBar = ratio => {
  const bounded = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
  return '\u2593'.repeat(Math.round(bounded * METER_WIDTH)).padEnd(METER_WIDTH, '\u2591');
};
const meterPercent = ratio => `${Math.round(Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0)) * 100)}%`;
const managedRatio = bucket => {
  const allowance = Number(bucket?.allowanceNanoUsd ?? bucket?.limitNanoUsd);
  const available = Number(bucket?.availableNanoUsd);
  return Number.isFinite(allowance) && allowance > 0 ? (allowance - Math.max(0, available)) / allowance : 0;
};
const shortUtcDate = epochSeconds => {
  const date = epochSeconds ? new Date(Number(epochSeconds) * 1000) : null;
  return date && Number.isFinite(date.getTime())
    ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : null;
};
const utcClock = value => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? `${date.toISOString().slice(11, 16)} UTC` : null;
};
const compactTokens = value => {
  if (!Number.isSafeInteger(value)) return '?';
  return Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(value);
};

export function managedUsageMeterLines(managed, { indent = '' } = {}) {
  const lines = [];
  if (managed?.monthly) {
    const ratio = managedRatio(managed.monthly);
    const renews = shortUtcDate(managed.periodEnd);
    lines.push(`${indent}monthly   ${meterPercent(ratio).padStart(4)}   ${meterBar(ratio)}${renews ? `   renews ${renews}` : ''}`);
  }
  if (managed?.daily) {
    const ratio = managedRatio(managed.daily);
    const resets = utcClock(managed.daily.resetsAt);
    lines.push(`${indent}daily     ${meterPercent(ratio).padStart(4)}   ${meterBar(ratio)}${resets ? `   resets ${resets}` : ''}`);
  }
  return lines;
}

export function formatCloudUsage(payload, { account, byok = false } = {}) {
  const usage = Array.isArray(payload?.data) ? payload.data : [];
  const managed = account?.managedUsage;
  const lines = [];
  lines.push(`\u{10900}  ${managed?.planName ? managed.planName.toUpperCase() : 'SHIP'} \u00b7 USAGE`);
  lines.push(...managedUsageMeterLines(managed, { indent: '    ' }));
  if (byok) lines.push('    this session uses an external provider \u2014 not counted here');
  if (!usage.length) {
    lines.push('    no settled requests yet');
    return lines.join('\n');
  }
  lines.push('    ' + '\u2500'.repeat(44));
  for (const [index, item] of usage.slice(0, 5).entries()) {
    const label = index === 0 ? 'last 5    ' : '          ';
    const status = item?.status && item.status !== 'completed' ? ` \u00b7 ${item.status}` : '';
    lines.push(`    ${label}${item?.alias || 'Ship model'} \u00b7 ${compactTokens(item?.inputTokens)} in / ${compactTokens(item?.outputTokens)} out${status}`);
  }
  return lines.join('\n');
}

export function formatCloudAccount(account, { usage } = {}) {
  const subscription = account?.subscription || {};
  const managed = account?.managedUsage;
  const planName = managed?.planName || 'plan';
  const lines = [
    `Carthagent Ship account ${account?.accountId || 'unknown'}`,
    `Credit: ${formatNanoUsd(account?.balance?.availableNanoUsd)} available`,
    `Plan: ${subscription.status && subscription.status !== 'none' ? `${planName} (${subscription.status})` : 'Free'}`,
  ];
  const subscriptionEnd = formatEpochSeconds(subscription.current_period_end);
  if (subscriptionEnd) lines.push(`Renews/ends: ${subscriptionEnd}`);
  if (managed) {
    lines.push(...managedUsageMeterLines(managed));
  } else if (subscription.status && subscription.status !== 'none' && ['active', 'trialing'].includes(subscription.status)) {
    lines.push('Managed usage: unavailable for the current billing period');
  }
  if (usage) lines.push(formatCloudUsage(usage));
  const sessions = Array.isArray(account?.sessions) ? account.sessions : [];
  const active = sessions.filter(session => !session.revoked_at).length;
  lines.push(`CLI sessions: ${active} active, ${sessions.length - active} revoked`);
  return lines.join('\n');
}
