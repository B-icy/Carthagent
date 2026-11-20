import { fetchWithRetry, isTransientNetworkError } from '../http-resilience.mjs';
import { getLogger } from '../logger.mjs';

const API_ROOT = 'https://api.github.com/repos/B-icy/Carthagent';
const API_VERSION = '2022-11-28';
const ASSET_NAMES = new Set([
  'opencode-linux-x64.tar.gz',
  'opencode-linux-arm64.tar.gz',
  'opencode-darwin-x64.tar.gz',
  'opencode-darwin-arm64.tar.gz',
  'opencode-windows-x64.tar.gz',
]);
const MAX_RELEASE_PAGES = 20;
const MAX_ASSET_PAGES = 20;
const log = getLogger('runtime-transport');

/**
 * Add opt-in authenticated access to one exact Carthagent release asset.
 * The credential is used only for fixed api.github.com GET requests. Redirects
 * are left to the ordinary downloader, which calls this wrapper again without
 * credentials for every non-canonical URL.
 */
export function createRuntimeGithubFetch({ token, fetchImpl = globalThis.fetch } = {}) {
  if (typeof token !== 'string' || !token.trim()) throw new TypeError('A non-empty GitHub token is required.');
  if (typeof fetchImpl !== 'function') throw new TypeError('GitHub runtime transport requires fetch support.');

  return async (input, init = {}) => {
    const requested = new URL(input);
    const match = requested.href.match(
      /^https:\/\/github\.com\/B-icy\/Carthagent\/releases\/download\/v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\/([^/?#]+)$/,
    );
    if (!match || requested.search || requested.hash) return fetchImpl(input, init);

    const [, version, encodedName] = match;
    let assetName;
    try {
      assetName = decodeURIComponent(encodedName);
    } catch {
      throw new Error('Invalid encoded Carthagent runtime asset URL.');
    }
    // Non-runtime assets use the ordinary URL transport. Only this strict
    // allowlist is eligible for credentials or draft lookup.
    if (!ASSET_NAMES.has(assetName) || encodeURIComponent(assetName) !== encodedName) return fetchImpl(input, init);

    const release = await findRelease({ version, token, fetchImpl, signal: init.signal });
    const asset = await findAsset({ release, assetName, token, fetchImpl, signal: init.signal });
    // The asset GET is not retried here: the downloader restarts the whole
    // transfer (including this lookup) on transient failures.
    const response = await apiGet(`${API_ROOT}/releases/assets/${asset.id}`, token, fetchImpl, init.signal, 'application/octet-stream', false);
    // GitHub may stream the bytes or redirect to a signed CDN URL. Keep the
    // redirect manual so the downloader re-requests it without this token.
    return response;
  };
}

async function findRelease({ version, token, fetchImpl, signal }) {
  const expectedTag = `v${version}`;
  const matches = [];
  for (let page = 1; page <= MAX_RELEASE_PAGES; page++) {
    const result = await apiJson(`${API_ROOT}/releases?per_page=100&page=${page}`, token, fetchImpl, signal);
    if (!Array.isArray(result)) throw new Error('GitHub returned invalid release-list metadata.');
    matches.push(...result.filter(item => item?.tag_name === expectedTag));
    if (result.length < 100) {
      if (matches.length !== 1)
        throw new Error(matches.length ? 'GitHub returned duplicate exact-version releases.' : 'The exact Carthagent runtime release was not found.');
      const release = matches[0];
      if (!Number.isSafeInteger(release.id) || release.id <= 0) throw new Error('GitHub returned invalid exact-version release metadata.');
      return release;
    }
  }
  throw new Error('GitHub release pagination exceeded its safety limit.');
}

async function findAsset({ release, assetName, token, fetchImpl, signal }) {
  const matches = [];
  for (let page = 1; page <= MAX_ASSET_PAGES; page++) {
    const url = `${API_ROOT}/releases/${release.id}/assets?per_page=100&page=${page}`;
    const result = await apiJson(url, token, fetchImpl, signal);
    if (!Array.isArray(result)) throw new Error('GitHub returned invalid release-asset metadata.');
    matches.push(...result.filter(item => item?.name === assetName));
    if (result.length < 100) {
      if (matches.length !== 1)
        throw new Error(matches.length ? `GitHub returned duplicate ${assetName} assets.` : `The exact Carthagent runtime asset ${assetName} was not found.`);
      const asset = matches[0];
      const canonicalAssetUrl = `${API_ROOT}/releases/assets/${asset.id}`;
      if (
        !Number.isSafeInteger(asset.id) ||
        asset.id <= 0 ||
        asset.state !== 'uploaded' ||
        !Number.isSafeInteger(asset.size) ||
        asset.size <= 0 ||
        asset.url !== canonicalAssetUrl
      ) {
        throw new Error(`GitHub returned invalid metadata for ${assetName}.`);
      }
      return asset;
    }
  }
  throw new Error('GitHub release-asset pagination exceeded its safety limit.');
}

async function apiJson(url, token, fetchImpl, signal) {
  const response = await apiGet(url, token, fetchImpl, signal, 'application/vnd.github+json', true);
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => {});
    throw new Error('GitHub API unexpectedly redirected a metadata request.');
  }
  if (!response.ok) throw new Error(`GitHub API metadata request failed with HTTP ${response.status}.`);
  try {
    return await response.json();
  } catch {
    throw new Error('GitHub API returned invalid JSON metadata.');
  }
}

async function apiGet(url, token, fetchImpl, signal, accept, retry) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid GitHub API request URL.');
  }
  if (parsed.origin !== 'https://api.github.com' || !parsed.pathname.startsWith('/repos/B-icy/Carthagent/')) {
    throw new Error('Runtime transport refused a noncanonical GitHub API URL.');
  }
  const init = {
    method: 'GET',
    redirect: 'manual',
    ...(signal ? { signal } : {}),
    headers: {
      accept,
      authorization: `Bearer ${token}`,
      'x-github-api-version': API_VERSION,
    },
  };
  try {
    return await fetchWithRetry(parsed, init, { fetchImpl, ...(retry ? {} : { policy: { maxAttempts: 1 } }) });
  } catch (error) {
    // Do not propagate fetch errors or causes: an injected adapter may include
    // request headers in its diagnostic text.
    log.debug('GitHub API request failed', { path: parsed.pathname, error: { name: error?.name, code: error?.code ?? error?.cause?.code } });
    throw Object.assign(new Error('GitHub API request failed before a response was received.'), { transient: !retry && isTransientNetworkError(error) });
  }
}
