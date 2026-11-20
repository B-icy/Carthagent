import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RUNTIME_ASSETS,
  collectResponses,
  decideHealthIssueAction,
  evaluateHealth,
  fetchWithRetry,
  healthSignature,
  parseArgs,
  renderMarkdown,
  syncHealthIssue,
} from '../tools/release-health.mjs';
import { alertMarker, readSignature } from '../tools/github-issues.mjs';

const VERSION = '1.1.3';
const json = (body, status = 200) => ({ ok: true, status, body: JSON.stringify(body), attempts: 1 });

function githubRelease(overrides = {}) {
  return {
    tag_name: `v${VERSION}`,
    name: `v${VERSION}`,
    draft: false,
    prerelease: false,
    published_at: '2026-11-20T03:04:21Z',
    assets: [
      ...RUNTIME_ASSETS.map((name, index) => ({
        name,
        size: 1000 + index,
        state: 'uploaded',
        download_count: index + 1,
        browser_download_url: `https://example.test/${name}`,
      })),
      { name: 'runtime-release.json', size: 10, state: 'uploaded', download_count: 4, browser_download_url: 'https://example.test/runtime-release.json' },
    ],
    ...overrides,
  };
}

function healthyResponses(overrides = {}) {
  return {
    generatedAt: '2026-11-20T00:00:00.000Z',
    github: json(githubRelease()),
    npm: json({ 'dist-tags': { latest: VERSION, next: '1.1.0-beta.8' }, versions: { [VERSION]: {} } }),
    npmDownloads: json({ downloads: 269, start: '2026-11-12', end: '2026-11-18', package: 'carthagent' }),
    installer: { ok: true, status: 200, body: '#!/bin/sh\nset -eu\n', attempts: 1 },
    manifest: json({ version: VERSION, tag: `v${VERSION}`, installSpec: `github:B-icy/Carthagent#v${VERSION}`, minNode: '22.22.2' }),
    assetProbes: Object.fromEntries(RUNTIME_ASSETS.map(name => [name, { ok: true, status: 200, body: '', attempts: 1 }])),
    ...overrides,
  };
}

const failedIds = report => report.checks.filter(item => !item.ok).map(item => item.id);

test('a consistent release is healthy and records impact metrics', () => {
  const report = evaluateHealth(healthyResponses());
  assert.equal(report.healthy, true, JSON.stringify(report.checks));
  assert.equal(report.version, VERSION);
  assert.equal(report.metrics.npmWeeklyDownloads, 269);
  assert.equal(report.metrics.runtimeArchiveDownloads, 15);
  assert.equal(report.metrics.assets.length, 6);
  const markdown = renderMarkdown(report);
  assert.match(markdown, /healthy \(v1\.1\.3\)/);
  assert.match(markdown, /\| npm weekly downloads \(2026-11-12\.\.2026-11-18\) \| 269 \|/);
});

test('missing or empty runtime archives fail the health check', () => {
  const release = githubRelease();
  release.assets = release.assets.filter(asset => asset.name !== 'opencode-windows-x64.tar.gz');
  release.assets[0].size = 0;
  const report = evaluateHealth(healthyResponses({ github: json(release) }));
  assert.deepEqual(failedIds(report), ['runtime-assets']);
  const detail = report.checks.find(item => item.id === 'runtime-assets').detail;
  assert.match(detail, /opencode-windows-x64\.tar\.gz missing/);
  assert.match(detail, /opencode-linux-x64\.tar\.gz is empty/);
});

test('draft or prerelease latest releases fail every version comparison', () => {
  const report = evaluateHealth(healthyResponses({ github: json(githubRelease({ prerelease: true })) }));
  assert.equal(report.healthy, false);
  assert.deepEqual(failedIds(report), ['github-release', 'runtime-assets', 'npm-latest', 'update-manifest']);
});

test('npm dist-tag drift and a stale control-plane manifest are failures', () => {
  const report = evaluateHealth(
    healthyResponses({
      npm: json({ 'dist-tags': { latest: '1.1.2' }, versions: { '1.1.2': {}, [VERSION]: {} } }),
      manifest: json({ version: '1.1.2', tag: 'v1.1.2' }),
    }),
  );
  assert.deepEqual(failedIds(report), ['npm-latest', 'update-manifest']);
  assert.match(report.checks.find(item => item.id === 'npm-latest').detail, /latest = 1\.1\.2, expected 1\.1\.3/);
});

test('a manifest the CLI would reject is a failure', () => {
  const report = evaluateHealth(healthyResponses({ manifest: json({ version: VERSION, installSpec: 'github:evil/fork#v1.1.3' }) }));
  assert.deepEqual(failedIds(report), ['update-manifest']);
});

test('installer and asset download outages are failures; metrics outages are not', () => {
  const report = evaluateHealth(
    healthyResponses({
      installer: { ok: true, status: 200, body: '<html>', attempts: 1 },
      assetProbes: { ...healthyResponses().assetProbes, [RUNTIME_ASSETS[0]]: { ok: false, error: 'fetch failed', attempts: 3 } },
      npmDownloads: { ok: true, status: 503, body: '', attempts: 3 },
    }),
  );
  assert.deepEqual(failedIds(report), ['asset-downloads', 'installer']);
  assert.equal(report.metrics.npmWeeklyDownloads, null);
  assert.match(renderMarkdown(report), /unavailable: HTTP 503/);
});

test('skipping asset probes reports SKIP without failing', () => {
  const report = evaluateHealth(healthyResponses({ assetProbes: undefined }));
  assert.equal(report.healthy, true);
  assert.match(renderMarkdown(report), /Runtime archive downloads \| SKIP/);
});

test('fetchWithRetry retries network errors and 5xx with backoff, not 4xx', async () => {
  const delays = [];
  const sleep = async ms => delays.push(ms);
  let calls = 0;
  const flaky = async () => {
    calls++;
    if (calls === 1) throw new Error('ECONNRESET');
    if (calls === 2) return new Response('busy', { status: 503 });
    return new Response('ok', { status: 200 });
  };
  const result = await fetchWithRetry('https://example.test', { fetchImpl: flaky, sleep, baseDelayMs: 10 });
  assert.equal(result.status, 200);
  assert.equal(result.attempts, 3);
  assert.deepEqual(delays, [10, 20]);
  let notFoundCalls = 0;
  const notFound = await fetchWithRetry('https://example.test', { fetchImpl: async () => (notFoundCalls++, new Response('', { status: 404 })), sleep });
  assert.equal(notFound.status, 404);
  assert.equal(notFoundCalls, 1);
  const down = await fetchWithRetry('https://example.test', { fetchImpl: async () => Promise.reject(new Error('ENOTFOUND')), sleep, retries: 1 });
  assert.deepEqual([down.ok, down.attempts, down.error], [false, 2, 'ENOTFOUND']);
});

test('collectResponses uses public endpoints and sends the token only to the GitHub API', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, method: init.method, auth: init.headers.authorization });
    if (url.includes('/releases/latest') && url.includes('api.github.com')) return new Response(JSON.stringify(githubRelease()), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  const responses = await collectResponses({ cloudUrl: 'https://cloud.test/' }, { fetchImpl, env: { GITHUB_TOKEN: 'secret' }, sleep: async () => {} });
  assert.equal(Object.keys(responses.assetProbes).length, RUNTIME_ASSETS.length);
  assert.ok(seen.some(call => call.url === 'https://cloud.test/v1/cli/releases/latest'));
  assert.ok(seen.some(call => call.url === 'https://api.npmjs.org/downloads/point/last-week/carthagent'));
  assert.deepEqual(
    seen.filter(call => call.auth).map(call => call.url),
    ['https://api.github.com/repos/B-icy/Carthagent/releases/latest'],
  );
  assert.equal(seen.filter(call => call.method === 'HEAD').length, RUNTIME_ASSETS.length);
});

test('issue sync opens once, comments only when failures change, and closes when healthy', () => {
  const unhealthy = evaluateHealth(healthyResponses({ manifest: json({ version: '1.1.2' }) }));
  const created = decideHealthIssueAction({ report: unhealthy, openIssue: null, runUrl: 'https://run' });
  assert.equal(created.type, 'create');
  assert.deepEqual(created.issue.labels, ['source: release-health', 'priority: P0', 'area: release']);
  assert.ok(created.issue.body.startsWith(alertMarker('release-health')));
  assert.equal(readSignature(created.issue.body), healthSignature(unhealthy));
  const openIssue = { number: 5, body: created.issue.body };
  assert.equal(decideHealthIssueAction({ report: unhealthy, openIssue }).type, 'none');
  const worse = evaluateHealth(healthyResponses({ manifest: json({ version: '1.1.2' }), installer: { ok: false, error: 'timeout', attempts: 3 } }));
  const changed = decideHealthIssueAction({ report: worse, openIssue });
  assert.equal(changed.type, 'comment');
  assert.equal(readSignature(changed.body), healthSignature(worse));
  const healthy = evaluateHealth(healthyResponses());
  assert.equal(decideHealthIssueAction({ report: healthy, openIssue }).type, 'close');
  assert.equal(decideHealthIssueAction({ report: healthy, openIssue: null }).type, 'none');
});

test('syncHealthIssue applies the decided action through the issue client', () => {
  const calls = [];
  const client = {
    listOpenIssues: () => [{ number: 5, body: alertMarker('release-health'), state: 'open' }],
    comment: (number, body) => calls.push(['comment', number, body]),
    close: number => calls.push(['close', number]),
  };
  const result = syncHealthIssue(evaluateHealth(healthyResponses()), { client, log: () => {} });
  assert.equal(result.type, 'close');
  assert.deepEqual(
    calls.map(call => call.slice(0, 2)),
    [
      ['comment', 5],
      ['close', 5],
    ],
  );
});

test('parses arguments and rejects unknown flags', () => {
  const options = parseArgs(['--json', '--skip-asset-probe', '--json-out', 'r.json'], {});
  assert.deepEqual([options.json, options.probeAssets, options.jsonOut, options.cloudUrl], [true, false, 'r.json', 'https://api.carthagent.xyz']);
  assert.equal(parseArgs([], { CARTHAGENT_CLOUD_URL: 'https://staging.test' }).cloudUrl, 'https://staging.test');
  assert.throws(() => parseArgs(['--json-out']), /incomplete/);
  assert.throws(() => parseArgs(['--nope']), /Unknown/);
});
