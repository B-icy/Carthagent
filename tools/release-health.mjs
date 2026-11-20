import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { normalizeRelease } from '../lib/update.mjs';
import { alertMarker, applyAlertAction, createIssueClient, findAlertIssue, readSignature, replaceSignature, signatureMarker } from './github-issues.mjs';

export const RUNTIME_ASSETS = [
  'opencode-linux-x64.tar.gz',
  'opencode-linux-arm64.tar.gz',
  'opencode-darwin-x64.tar.gz',
  'opencode-darwin-arm64.tar.gz',
  'opencode-windows-x64.tar.gz',
];
export const RELEASE_HEALTH_LABELS = ['source: release-health', 'priority: P0', 'area: release'];
export const RELEASE_HEALTH_ALERT_KEY = 'release-health';
const DEFAULT_OPTIONS = {
  githubRepo: 'B-icy/Carthagent',
  npmPackage: 'carthagent',
  installerUrl: 'https://carthagent.xyz/install',
  cloudUrl: 'https://api.carthagent.xyz',
};
const USER_AGENT = 'carthagent-release-health';
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const FETCH_DEFAULTS = { fetchImpl: globalThis.fetch, method: 'GET', headers: {}, retries: 2, baseDelayMs: 1000, timeoutMs: 15000, sleep: delay };

async function attemptFetch(url, settings, attempt) {
  try {
    const res = await settings.fetchImpl(url, {
      method: settings.method,
      headers: { 'user-agent': USER_AGENT, ...settings.headers },
      redirect: 'follow',
      signal: AbortSignal.timeout(settings.timeoutMs),
    });
    const body = settings.method === 'HEAD' ? '' : await res.text();
    return { ok: true, status: res.status, body, attempts: attempt + 1 };
  } catch (error) {
    return { ok: false, error: error?.message || String(error), attempts: attempt + 1 };
  }
}

export async function fetchWithRetry(url, options = {}) {
  const settings = { ...FETCH_DEFAULTS, ...options };
  let last;
  for (let attempt = 0; attempt <= settings.retries; attempt++) {
    if (attempt > 0) await settings.sleep(settings.baseDelayMs * 2 ** (attempt - 1));
    last = await attemptFetch(url, settings, attempt);
    if (last.ok && !RETRYABLE_STATUS.has(last.status)) return last;
  }
  return last;
}
function parseJson(response) {
  if (!response?.ok || response.status !== 200) return null;
  try {
    return JSON.parse(response.body);
  } catch {
    return null;
  }
}

function describeFailure(response) {
  if (!response) return 'not requested';
  if (!response.ok) return `request failed after ${response.attempts} attempt(s): ${response.error}`;
  return `HTTP ${response.status}`;
}

function check(id, label, ok, detail) {
  return { id, label, ok, detail };
}

export function checkGithubRelease(response) {
  const body = parseJson(response);
  if (!body) return { result: check('github-release', 'GitHub latest release', false, describeFailure(response)), release: null };
  const release = normalizeRelease(body);
  if (!release || body.draft || body.prerelease || release.prerelease) {
    return {
      result: check('github-release', 'GitHub latest release', false, `latest release ${body.tag_name} is draft, prerelease or not a canonical vX.Y.Z tag`),
      release: null,
    };
  }
  return {
    result: check('github-release', 'GitHub latest release', true, `${body.tag_name} published ${body.published_at}`),
    release: { ...release, assets: body.assets || [] },
  };
}

export function checkRuntimeAssets(release, requiredAssets = RUNTIME_ASSETS) {
  if (!release) return check('runtime-assets', 'Runtime archives', false, 'no stable GitHub release to inspect');
  const byName = new Map(release.assets.map(asset => [asset.name, asset]));
  const problems = requiredAssets.flatMap(name => {
    const asset = byName.get(name);
    if (!asset) return [`${name} missing`];
    if (asset.state && asset.state !== 'uploaded') return [`${name} state ${asset.state}`];
    return asset.size > 0 ? [] : [`${name} is empty`];
  });
  return check(
    'runtime-assets',
    'Runtime archives',
    problems.length === 0,
    problems.length ? problems.join('; ') : `${requiredAssets.length}/${requiredAssets.length} present and non-empty`,
  );
}

export function checkAssetDownloads(probes, requiredAssets = RUNTIME_ASSETS) {
  if (!probes) return { ...check('asset-downloads', 'Runtime archive downloads', true, 'skipped'), skipped: true };
  const problems = requiredAssets.filter(name => !(probes[name]?.ok && probes[name].status === 200)).map(name => `${name}: ${describeFailure(probes[name])}`);
  return check('asset-downloads', 'Runtime archive downloads', problems.length === 0, problems.length ? problems.join('; ') : 'all download URLs return 200');
}

export function checkNpmLatest(response, version, npmPackage = DEFAULT_OPTIONS.npmPackage) {
  const body = parseJson(response);
  if (!body) return check('npm-latest', `npm ${npmPackage}@latest`, false, describeFailure(response));
  const latest = body['dist-tags']?.latest;
  if (!version) return check('npm-latest', `npm ${npmPackage}@latest`, false, `latest is ${latest}; no GitHub release to compare`);
  const published = Boolean(body.versions?.[version]);
  const ok = latest === version && published;
  return check(
    'npm-latest',
    `npm ${npmPackage}@latest`,
    ok,
    ok ? `latest = ${latest}` : `latest = ${latest}, expected ${version}${published ? '' : ` (${version} is not published)`}`,
  );
}

export function checkInstaller(response, installerUrl = DEFAULT_OPTIONS.installerUrl) {
  if (!response?.ok || response.status !== 200) return check('installer', 'Installer script', false, `${installerUrl}: ${describeFailure(response)}`);
  const ok = response.body.startsWith('#!');
  return check(
    'installer',
    'Installer script',
    ok,
    ok ? `${installerUrl} returns a ${response.body.length}-byte script` : `${installerUrl} returned 200 without a #! script`,
  );
}

export function checkUpdateManifest(response, version, githubRepo = DEFAULT_OPTIONS.githubRepo) {
  const body = parseJson(response);
  if (!body) return check('update-manifest', 'Control-plane update manifest', false, describeFailure(response));
  const manifest = normalizeRelease(body, { githubRepo });
  if (!manifest)
    return check('update-manifest', 'Control-plane update manifest', false, `manifest rejected by the CLI validator: ${JSON.stringify(body).slice(0, 200)}`);
  const ok = Boolean(version) && manifest.version === version;
  return check(
    'update-manifest',
    'Control-plane update manifest',
    ok,
    ok ? `advertises ${manifest.version}` : `advertises ${manifest.version}, expected ${version ?? 'a stable GitHub release'}`,
  );
}

export function releaseMetrics(release, downloadsResponse) {
  const assets = (release?.assets || []).map(asset => ({ name: asset.name, size: asset.size, downloads: asset.download_count ?? 0 }));
  const runtimeDownloads = assets.filter(asset => RUNTIME_ASSETS.includes(asset.name)).reduce((sum, asset) => sum + asset.downloads, 0);
  const downloads = parseJson(downloadsResponse);
  return {
    assets,
    runtimeArchiveDownloads: runtimeDownloads,
    npmWeeklyDownloads: typeof downloads?.downloads === 'number' ? downloads.downloads : null,
    npmWeeklyRange: downloads?.start && downloads?.end ? `${downloads.start}..${downloads.end}` : null,
    npmWeeklyError: typeof downloads?.downloads === 'number' ? null : describeFailure(downloadsResponse),
  };
}

export function evaluateHealth(responses, options = {}) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const { result: githubCheck, release } = checkGithubRelease(responses.github);
  const version = release?.version ?? null;
  const checks = [
    githubCheck,
    checkRuntimeAssets(release),
    checkAssetDownloads(responses.assetProbes),
    checkNpmLatest(responses.npm, version, settings.npmPackage),
    checkInstaller(responses.installer, settings.installerUrl),
    checkUpdateManifest(responses.manifest, version, settings.githubRepo),
  ];
  return {
    generatedAt: responses.generatedAt ?? new Date().toISOString(),
    repo: settings.githubRepo,
    version,
    tag: release?.tag ?? null,
    healthy: checks.every(item => item.ok),
    checks,
    metrics: releaseMetrics(release, responses.npmDownloads),
  };
}

function escapeCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');
}

export function renderMarkdown(report) {
  const status = item => (item.skipped ? 'SKIP' : item.ok ? 'PASS' : 'FAIL');
  const lines = [
    `## Release health: ${report.healthy ? 'healthy' : 'UNHEALTHY'} (${report.tag ?? 'no stable release'})`,
    '',
    `Generated ${report.generatedAt} for ${report.repo}.`,
    '',
    '| Check | Status | Detail |',
    '| --- | --- | --- |',
    ...report.checks.map(item => `| ${escapeCell(item.label)} | ${status(item)} | ${escapeCell(item.detail)} |`),
    '',
    '### Release impact metrics',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| npm weekly downloads${report.metrics.npmWeeklyRange ? ` (${report.metrics.npmWeeklyRange})` : ''} | ${report.metrics.npmWeeklyDownloads ?? `unavailable: ${escapeCell(report.metrics.npmWeeklyError)}`} |`,
    `| Runtime archive downloads (${report.tag ?? 'n/a'}) | ${report.metrics.runtimeArchiveDownloads} |`,
    ...report.metrics.assets.map(asset => `| ${escapeCell(asset.name)} downloads | ${asset.downloads} |`),
  ];
  return lines.join('\n') + '\n';
}

export async function collectResponses(options = {}, { fetchImpl = globalThis.fetch, env = process.env, sleep = delay } = {}) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const get = (url, headers) => fetchWithRetry(url, { fetchImpl, headers, sleep });
  const githubHeaders = { accept: 'application/vnd.github+json', ...(env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}) };
  const [github, npm, npmDownloads, installer, manifest] = await Promise.all([
    get(`https://api.github.com/repos/${settings.githubRepo}/releases/latest`, githubHeaders),
    get(`https://registry.npmjs.org/${settings.npmPackage}`, { accept: 'application/json' }),
    get(`https://api.npmjs.org/downloads/point/last-week/${settings.npmPackage}`, { accept: 'application/json' }),
    get(settings.installerUrl),
    get(`${settings.cloudUrl.replace(/\/+$/, '')}/v1/cli/releases/latest`, { accept: 'application/json', 'x-carthagent-ci': '1' }),
  ]);
  const responses = { github, npm, npmDownloads, installer, manifest, generatedAt: new Date().toISOString() };
  if (settings.probeAssets === false) return responses;
  const assets = parseJson(github)?.assets || [];
  const entries = await Promise.all(
    RUNTIME_ASSETS.map(async name => {
      const asset = assets.find(item => item.name === name);
      return [name, asset ? await fetchWithRetry(asset.browser_download_url, { fetchImpl, method: 'HEAD', sleep }) : undefined];
    }),
  );
  responses.assetProbes = Object.fromEntries(entries);
  return responses;
}

export function healthSignature(report) {
  const failing = report.checks.filter(item => !item.ok).map(item => item.id);
  return `${report.tag ?? 'none'}/${failing.sort().join(',')}`;
}

function failureSummary(report, runUrl) {
  const failing = report.checks.filter(item => !item.ok).map(item => `- **${item.label}**: ${item.detail}`);
  return [
    `Release health check for ${report.tag ?? 'the latest release'} is failing (${report.generatedAt}).`,
    '',
    ...failing,
    '',
    runUrl ? `Run: ${runUrl}` : '',
  ]
    .join('\n')
    .trim();
}

export function decideHealthIssueAction({ report, openIssue, runUrl }) {
  const signature = healthSignature(report);
  if (report.healthy) {
    if (!openIssue) return { type: 'none', reason: 'healthy' };
    return {
      type: 'close',
      number: openIssue.number,
      comment: `Release health recovered for ${report.tag} (${report.generatedAt}).${runUrl ? ` Run: ${runUrl}` : ''} Closing this alert.`,
    };
  }
  if (!openIssue) {
    return {
      type: 'create',
      issue: {
        title: `Release health failing for ${report.tag ?? 'the latest release'}`,
        labels: RELEASE_HEALTH_LABELS,
        body: [
          alertMarker(RELEASE_HEALTH_ALERT_KEY),
          signatureMarker(signature),
          failureSummary(report, runUrl),
          '',
          'Opened by the release health workflow; it comments when the failing checks change and closes this issue when every check passes. See docs/deployment-observability.md.',
        ].join('\n'),
      },
    };
  }
  if (readSignature(openIssue.body) === signature) return { type: 'none', number: openIssue.number, reason: 'failure unchanged' };
  return { type: 'comment', number: openIssue.number, body: replaceSignature(openIssue.body, signature), comment: failureSummary(report, runUrl) };
}

export function syncHealthIssue(report, { client, runUrl, log = console.log }) {
  const openIssue = findAlertIssue(client.listOpenIssues(), RELEASE_HEALTH_ALERT_KEY);
  const result = applyAlertAction(client, decideHealthIssueAction({ report, openIssue, runUrl }));
  log(`Release health issue: ${result.type}${result.number ? ` #${result.number}` : ''}${result.issue ? ` #${result.issue.number}` : ''}.`);
  return result;
}

const VALUE_FLAGS = {
  '--json-out': 'jsonOut',
  '--sync-issue': 'syncIssue',
  '--repo': 'githubRepo',
  '--npm-package': 'npmPackage',
  '--installer-url': 'installerUrl',
  '--cloud-url': 'cloudUrl',
};

export function parseArgs(argv, env = process.env) {
  const options = { json: false, probeAssets: true, cloudUrl: env.CARTHAGENT_CLOUD_URL || DEFAULT_OPTIONS.cloudUrl };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--skip-asset-probe') options.probeAssets = false;
    else if (VALUE_FLAGS[arg] && argv[i + 1]) options[VALUE_FLAGS[arg]] = argv[++i];
    else
      throw new Error(
        `Unknown or incomplete argument: ${arg}\nUsage: node tools/release-health.mjs [--json] [--json-out file] [--skip-asset-probe] [--repo owner/name] | --sync-issue report.json`,
      );
  }
  return options;
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.syncIssue) {
    const report = JSON.parse(readFileSync(options.syncIssue, 'utf8'));
    const repo = process.env.GITHUB_REPOSITORY || options.githubRepo || DEFAULT_OPTIONS.githubRepo;
    const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}` : undefined;
    syncHealthIssue(report, { client: createIssueClient({ repo }), runUrl });
    return;
  }
  const report = evaluateHealth(await collectResponses(options), options);
  if (options.jsonOut) writeFileSync(options.jsonOut, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(options.json ? JSON.stringify(report, null, 2) + '\n' : renderMarkdown(report));
  if (!report.healthy) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
