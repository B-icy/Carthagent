/**
 * Self-update support for `ctg update` and the passive once-a-day console notice.
 *
 * Release resolution order:
 *   1. Control plane  GET <CARTHAGENT_CLOUD_URL|api.carthagent.xyz>/v1/cli/releases/latest
 *      (operator-controlled "latest" pointer — staged rollouts, pullbacks)
 *   2. GitHub releases API for B-icy/Carthagent — fallback while the endpoint is
 *      unconfigured (503/404) or unreachable.
 *
 * Install methods:
 *   - clone  : the package root contains .git (installed via `npm install -g .` from a
 *              clone) → checkout the tag in place, `npm ci`, re-link.
 *   - npm    : global `github:` install → `npm install -g --install-links=true <spec>`.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { cloudControlUrl } from './cloud/client.mjs';

export const GITHUB_REPO = 'B-icy/Carthagent';
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The installed package version (package.json next to lib/). */
export function packageVersion() {
  try { return JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version; }
  catch { return null; }
}

/** Semver-ish ordering: numeric triple, then a release outranks its prereleases. */
export function compareVersions(a, b) {
  const parse = value => {
    const m = String(value || '').trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
    if (!m) return null;
    return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || '' };
  };
  const left = parse(a), right = parse(b);
  if (!left || !right) throw new Error(`cannot compare versions '${a}' and '${b}'`);
  for (let i = 0; i < 3; i++) if (left.nums[i] !== right.nums[i]) return left.nums[i] - right.nums[i];
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  const lp = left.pre.split('.'), rp = right.pre.split('.');
  for (let i = 0; i < Math.max(lp.length, rp.length); i++) {
    if (lp[i] === undefined) return -1;
    if (rp[i] === undefined) return 1;
    if (lp[i] === rp[i]) continue;
    const ln = /^\d+$/.test(lp[i]), rn = /^\d+$/.test(rp[i]);
    if (ln && rn) return Number(lp[i]) - Number(rp[i]);
    if (ln !== rn) return ln ? -1 : 1; // numeric identifiers rank below alphanumeric
    return lp[i] < rp[i] ? -1 : 1;
  }
  return 0;
}

/** Normalize a control-plane or GitHub releases payload into the manifest shape. */
export function normalizeRelease(raw, { githubRepo = GITHUB_REPO } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  // GitHub releases/latest shape: { tag_name, name, published_at, body }
  const tag = String(raw.tag || raw.tag_name || '').trim();
  const version = String(raw.version || tag.replace(/^v/, '')).trim();
  if (!SEMVER_RE.test(version)) return null;
  return {
    version,
    tag: tag || `v${version}`,
    installSpec: String(raw.installSpec || `github:${githubRepo}#${tag || `v${version}`}`).trim(),
    minNode: String(raw.minNode || '22.19.0').trim(),
    note: typeof raw.note === 'string' && raw.note.trim() ? raw.note.trim()
      : typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : undefined,
    publishedAt: raw.publishedAt || raw.published_at || undefined,
  };
}

/** Latest release manifest: control plane first, GitHub releases as fallback. */
export async function fetchLatestRelease({ cloudUrl = cloudControlUrl(), githubRepo = GITHUB_REPO, fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const getJson = async url => {
    const res = await fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': `carthagent-cli` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  };
  try {
    const { status, body } = await getJson(`${String(cloudUrl).replace(/\/+$/, '')}/v1/cli/releases/latest`);
    if (status === 200) {
      const release = normalizeRelease(body, { githubRepo });
      if (release) return { release, source: 'control-plane' };
    }
    if (![404, 503].includes(status)) throw new Error(`control plane returned ${status}`);
  } catch (error) {
    if (!/control plane|fetch|network|abort|timed? ?out|connect|socket/i.test(error?.message || String(error))) throw error;
    // unreachable/unconfigured control plane → fall through to GitHub
  }
  const { status, body } = await getJson(`https://api.github.com/repos/${githubRepo}/releases/latest`);
  if (status !== 200) throw new Error(status === 404 ? 'no tagged GitHub release exists yet' : `GitHub releases returned ${status}`);
  const release = normalizeRelease(body, { githubRepo });
  if (!release) throw new Error('GitHub release payload missing a semver tag');
  return { release, source: 'github' };
}

/** 'clone' when the running package root is a git checkout, else 'npm'. */
export function detectInstallMethod(root) {
  return existsSync(join(root, '.git')) ? 'clone' : 'npm';
}

/** Passive-check cache (~/.carthagent/update-check.json). */
export function updateCheckPath(env = process.env) {
  return env.CARTHAGENT_UPDATE_CHECK_FILE || join(os.homedir(), '.carthagent', 'update-check.json');
}

export function updateCheckEnabled(env = process.env) {
  const off = env.CARTHAGENT_NO_UPDATE_CHECK || env.CARTHAGENT_UPDATE_CHECK === '0' || env.CARTHAGENT_UPDATE_CHECK === 'false';
  return !off;
}

export function readUpdateCache(path = updateCheckPath()) {
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch { return null; }
}

export function writeUpdateCache(entry, path = updateCheckPath()) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(entry));
    renameSync(tmp, path);
  } catch { /* cache is best-effort */ }
}

/**
 * Latest release for the passive notice, throttled to one fetch per day.
 * Cache writes happen on every attempt (success or failure) so a failing
 * network doesn't get retried every launch.
 */
export async function latestReleaseCached({ cachePath = updateCheckPath(), now = Date.now(), intervalMs = UPDATE_CHECK_INTERVAL_MS, ...fetchOpts } = {}) {
  const cached = readUpdateCache(cachePath);
  if (cached && Number.isFinite(cached.checkedAt) && now - cached.checkedAt < intervalMs) {
    return { release: cached.release || null, fresh: true };
  }
  try {
    const { release, source } = await fetchLatestRelease(fetchOpts);
    writeUpdateCache({ checkedAt: now, release, source }, cachePath);
    return { release, fresh: false };
  } catch {
    writeUpdateCache({ checkedAt: now, release: cached?.release || null }, cachePath);
    return { release: cached?.release || null, fresh: false };
  }
}
