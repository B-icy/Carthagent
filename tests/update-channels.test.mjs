import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fetchLatestRelease, latestReleaseCached, normalizeRelease } from '../lib/update.mjs';
import { parseUpdateOptions, readUpdateChannel, writeUpdateChannel } from '../lib/update-channel.mjs';

const release = (version, extra = {}) => ({ tag_name: `v${version}`, draft: false, prerelease: version.includes('-'), ...extra });
async function fixture(t, pages = [[]], stable = release('1.0.7')) {
  const dir = await mkdtemp(join(tmpdir(), 'ctg-update-channels-'));
  const env = { CARTHAGENT_UPDATE_CHANNEL_FILE: join(dir, 'channel.json') };
  const requests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    requests.push({ url, headers: req.headers });
    const body = url.pathname.endsWith('/releases/latest') ? stable : pages[Number(url.searchParams.get('page') || 1) - 1] ?? [];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const fetchImpl = (url, options) => fetch(`${base}${new URL(url).pathname}${new URL(url).search}`, options);
  return { dir, env, requests, base, options: { env, agentDir: join(dir, 'agent'), cloudUrl: base, fetchImpl } };
}

test('channel flags are explicit, validated, and do not reinterpret arbitrary update arguments', () => {
  assert.deepEqual(parseUpdateOptions([]), { checkOnly: false, force: false, channel: null });
  assert.deepEqual(parseUpdateOptions(['--channel', 'experimental', '--check']), { checkOnly: true, force: false, channel: 'experimental' });
  assert.equal(parseUpdateOptions(['--channel=beta', '--force']).channel, 'beta');
  for (const args of [['--channel'], ['--channel', 'nightly'], ['--channel', 'beta', '--channel', 'stable'], ['--tag', 'main']]) assert.throws(() => parseUpdateOptions(args));
});

test('channel preference defaults stable, is versioned and isolated, and rejects corrupt opt-in', async t => {
  const f = await fixture(t);
  assert.equal(readUpdateChannel(f.env), 'stable');
  writeUpdateChannel('experimental', f.env);
  assert.equal(readUpdateChannel(f.env), 'experimental');
  assert.deepEqual(JSON.parse(await readFile(f.env.CARTHAGENT_UPDATE_CHANNEL_FILE, 'utf8')), { version: 1, channel: 'experimental' });
  assert.throws(() => writeUpdateChannel('main', f.env));
  await writeFile(f.env.CARTHAGENT_UPDATE_CHANNEL_FILE, '{broken');
  assert.throws(() => readUpdateChannel(f.env), /channel/i);
});

test('stable refuses prereleases even when misadvertised by the control plane or latest API', async t => {
  const f = await fixture(t, [], release('9.0.0-beta.1'));
  await assert.rejects(fetchLatestRelease(f.options), /stable/i);
  assert.equal(f.requests.length, 2);
  assert.equal(normalizeRelease({ version: '1.0.7', tag: 'main' }), null);
});

test('beta selects the greatest eligible semver, ignores drafts, and excludes experimental tags', async t => {
  const f = await fixture(t, [[release('2.0.0-beta.2'), release('2.0.0-beta.10'), release('3.0.0-experimental.1'), release('99.0.0-beta.1', { draft: true }), release('1.0.7'), release('2.0.0-rc.1')]]);
  const result = await fetchLatestRelease({ ...f.options, channel: 'beta' });
  assert.equal(result.release.version, '2.0.0-rc.1');
  assert.equal(result.release.installSpec, 'github:B-icy/Carthagent#v2.0.0-rc.1');
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].headers['x-carthagent-install-id'], undefined);
});

test('experimental opts into all published prereleases and follows saved preference', async t => {
  const f = await fixture(t, [[release('1.1.0-preview.1'), release('1.0.7'), release('1.1.0-beta.2'), release('8.0.0-alpha.1', { draft: true })]]);
  writeUpdateChannel('experimental', f.env);
  const result = await fetchLatestRelease(f.options);
  assert.equal(result.release.version, '1.1.0-preview.1');
  assert.equal(result.source, 'github');
});

test('release selection paginates instead of trusting GitHub creation order', async t => {
  const f = await fixture(t, [Array.from({ length: 100 }, (_, i) => release(`1.0.${i}`)), [release('2.0.0-beta.5')]]);
  assert.equal((await fetchLatestRelease({ ...f.options, channel: 'beta' })).release.version, '2.0.0-beta.5');
  assert.equal(f.requests.length, 2);
});

test('published stable versions supersede beta versions without accepting unknown beta labels', async t => {
  const f = await fixture(t, [[release('2.0.0-beta.2'), release('2.0.0'), release('3.0.0-nightly.1'), release('3.0.0-beta-unsafe.1')]]);
  assert.equal((await fetchLatestRelease({ ...f.options, channel: 'beta' })).release.version, '2.0.0');
});

test('channel caches never leak a cached experimental release into stable', async t => {
  const f = await fixture(t, [[release('2.0.0-preview.1')]]);
  const cachePath = join(f.dir, 'cache.json');
  const first = await latestReleaseCached({ ...f.options, cachePath, channel: 'experimental' });
  assert.equal(first.release.version, '2.0.0-preview.1');
  const stable = await latestReleaseCached({ ...f.options, cachePath, channel: 'stable' });
  assert.equal(stable.release.version, '1.0.7');
  await writeFile(cachePath, JSON.stringify({ checkedAt: Date.now(), channel: 'experimental', release: first.release }));
  const offline = await latestReleaseCached({ ...f.options, cachePath, channel: 'stable', fetchImpl: async () => { throw Error('offline'); } });
  assert.equal(offline.release, null);
});

test('CLI --check previews channel rollback without persisting or installing', async t => {
  const f = await fixture(t, [], release('0.0.1'));
  writeUpdateChannel('experimental', f.env);
  const child = spawn(process.execPath, ['bin/ctg.mjs', 'update', '--channel', 'stable', '--check'], {
    cwd: new URL('..', import.meta.url), env: { ...process.env, ...f.env, CARTHAGENT_CLOUD_URL: f.base, CARTHAGENT_CODING_AGENT_DIR: join(f.dir, 'agent') }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
  const [code] = await once(child, 'close');
  assert.equal(code, 0, output);
  assert.match(output, /0\.0\.1.*available/);
  assert.match(output, /stable/);
  assert.equal(readUpdateChannel(f.env), 'experimental');
});


test('failed real clone update does not persist a requested channel switch', async t => {
  const f = await fixture(t, [], release('999.0.0'));
  const copy = join(f.dir, 'broken-clone');
  await mkdir(copy);
  for (const name of ['lib', 'bin', 'package.json']) await cp(new URL(`../${name}`, import.meta.url), join(copy, name), { recursive: true });
  await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(copy, 'node_modules'), 'junction');
  await mkdir(join(copy, '.git'));
  writeUpdateChannel('experimental', f.env);
  const child = spawn(process.execPath, [join(copy, 'bin/ctg.mjs'), 'update', '--channel', 'stable'], {
    cwd: copy, env: { ...process.env, ...f.env, CARTHAGENT_CLOUD_URL: f.base, CARTHAGENT_CODING_AGENT_DIR: join(f.dir, 'agent') }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
  const [code] = await once(child, 'close');
  assert.equal(code, 1, output);
  assert.match(output, /Cannot inspect the clone/);
  assert.equal(readUpdateChannel(f.env), 'experimental');
});
