import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import os from 'node:os';

const packageVersion = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).version;
import {
  installIdPath, shipInstallId, providerMode,
  noteEngineSession, noteAgentTurn, shipRequestHeaders, resetShipContext,
} from '../lib/ship-telemetry.mjs';
import { managedCloudRequestOptions } from '../lib/providers/experiential.mjs';
import { fetchLatestRelease } from '../lib/update.mjs';
import { CloudClient } from '../lib/cloud/client.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tmp = t => {
  const dir = mkdtempSync(join(os.tmpdir(), 'ctg-telemetry-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('install id persists across runs and is regenerated when the file is corrupt', t => {
  const agentDir = tmp(t);
  const first = shipInstallId({ agentDir });
  assert.match(first, UUID);
  assert.equal(shipInstallId({ agentDir }), first);
  assert.equal(readFileSync(installIdPath(agentDir), 'utf8').trim(), first);
  writeFileSync(installIdPath(agentDir), 'garbage-not-a-uuid');
  const regenerated = shipInstallId({ agentDir });
  assert.match(regenerated, UUID);
  assert.notEqual(regenerated, first);
  assert.equal(shipInstallId({ agentDir }), regenerated);
});

test('concurrent first runs and corrupt repairs converge on one install id', async t => {
  const lib = new URL('../lib/ship-telemetry.mjs', import.meta.url).href;
  const run = agentDir => new Promise((resolve, reject) =>
    execFile(process.execPath, ['--input-type=module', '-e',
      `import { shipInstallId } from '${lib}'; console.log(shipInstallId({ agentDir: ${JSON.stringify(agentDir)} }));`],
      (error, stdout) => error ? reject(error) : resolve(stdout.trim())));
  // Fresh directory: racing launches adopt a single id.
  const fresh = tmp(t);
  const ids = await Promise.all([run(fresh), run(fresh), run(fresh), run(fresh)]);
  assert.equal(new Set(ids).size, 1);
  assert.match(ids[0], UUID);
  assert.equal(readFileSync(installIdPath(fresh), 'utf8').trim(), ids[0]);
  // Corrupt file: racing repairs also converge.
  const corrupt = tmp(t);
  writeFileSync(installIdPath(corrupt), 'garbage');
  const repaired = await Promise.all([run(corrupt), run(corrupt), run(corrupt), run(corrupt)]);
  assert.equal(new Set(repaired).size, 1);
  assert.equal(readFileSync(installIdPath(corrupt), 'utf8').trim(), repaired[0]);
});

test('provider mode reflects ship, byok, both, or no credentials', t => {
  const agentDir = tmp(t);
  assert.equal(providerMode({ agentDir, env: {} }), 'none');
  assert.equal(providerMode({ agentDir, env: { ANTHROPIC_API_KEY: 'k' } }), 'byok');
  writeFileSync(join(agentDir, 'auth.json'), JSON.stringify({ 'experiential-labs': { type: 'oauth', access: 'a', refresh: 'r', expires: 1 } }));
  assert.equal(providerMode({ agentDir, env: {} }), 'ship');
  assert.equal(providerMode({ agentDir, env: { OPENAI_API_KEY: 'k' } }), 'ship+byok');
  // A direct api_key under the Ship provider id is BYOK, not a Ship account.
  writeFileSync(join(agentDir, 'auth.json'), JSON.stringify({ 'experiential-labs': { type: 'api_key', key: 'k' } }));
  assert.equal(providerMode({ agentDir, env: {} }), 'byok');
  writeFileSync(join(agentDir, 'auth.json'), JSON.stringify({ anthropic: { type: 'api_key', key: 'k' } }));
  assert.equal(providerMode({ agentDir, env: {} }), 'byok');
  // A direct key in models.json — even under the Ship provider id — is BYOK.
  writeFileSync(join(agentDir, 'auth.json'), '{}');
  writeFileSync(join(agentDir, 'models.json'), JSON.stringify({ providers: { 'experiential-labs': { apiKey: 'direct' } } }));
  assert.equal(providerMode({ agentDir, env: {} }), 'byok');
  writeFileSync(join(agentDir, 'auth.json'), JSON.stringify({ 'experiential-labs': { type: 'oauth', access: 'a' } }));
  assert.equal(providerMode({ agentDir, env: {} }), 'ship+byok');
});

test('update check sends the install headers to the control plane only', async t => {
  const agentDir = tmp(t);
  const seen = [];
  const { release, source } = await fetchLatestRelease({
    cloudUrl: 'https://cloud.test', env: {}, agentDir,
    fetchImpl: async (url, options) => {
      seen.push({ url, headers: options.headers });
      if (url.includes('/v1/cli/releases/latest')) return { status: 503, json: async () => ({}) };
      return { status: 200, json: async () => ({ tag_name: 'v9.9.9', published_at: '2026-01-01T00:00:00Z' }) };
    },
  });
  assert.equal(source, 'github');
  assert.equal(release.version, '9.9.9');
  const control = seen.find(call => call.url.includes('/v1/cli/releases/latest'));
  const github = seen.find(call => call.url.includes('api.github.com'));
  assert.match(control.headers['x-carthagent-install-id'], UUID);
  assert.equal(control.headers['x-carthagent-os'], process.platform);
  assert.equal(control.headers['x-carthagent-arch'], process.arch);
  assert.equal(control.headers['x-carthagent-node'], process.versions.node);
  assert.equal(control.headers['x-carthagent-provider-mode'], 'none');
  assert.equal(control.headers['x-carthagent-version'], packageVersion);
  assert.equal(github.headers['x-carthagent-install-id'], undefined);
});

test('managed requests carry thread, turn, install and run-mode headers', t => {
  const agentDir = tmp(t);
  const env = { CARTHAGENT_CODING_AGENT_DIR: agentDir, CARTHAGENT_RUN_MODE: 'interactive' };
  const previous = { dir: process.env.CARTHAGENT_CODING_AGENT_DIR, mode: process.env.CARTHAGENT_RUN_MODE };
  t.after(() => {
    for (const [key, value] of [['CARTHAGENT_CODING_AGENT_DIR', previous.dir], ['CARTHAGENT_RUN_MODE', previous.mode]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    resetShipContext();
  });
  process.env.CARTHAGENT_CODING_AGENT_DIR = agentDir;
  process.env.CARTHAGENT_RUN_MODE = 'interactive';
  resetShipContext();

  const sessionId = '11111111-2222-4333-8444-555555555555';
  noteEngineSession(sessionId);
  noteAgentTurn();
  const first = managedCloudRequestOptions({}, () => 'op-1').requestHeaders;
  assert.equal(first['x-carthagent-thread-id'], sessionId);
  assert.equal(first['x-carthagent-turn'], '1');
  assert.match(first['x-carthagent-install-id'], UUID);
  assert.equal(first['x-carthagent-run-mode'], 'interactive');
  assert.equal(first['x-carthagent-version'], packageVersion);
  assert.equal(first['Idempotency-Key'], 'op-1');

  // More model calls inside the same user turn keep the turn number; the next
  // user turn advances it.
  assert.equal(managedCloudRequestOptions({}, () => 'op-2').requestHeaders['x-carthagent-turn'], '1');
  noteAgentTurn();
  assert.equal(managedCloudRequestOptions({}, () => 'op-3').requestHeaders['x-carthagent-turn'], '2');

  // session_start with the same id (extension reload) keeps the turn count.
  noteEngineSession('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  noteAgentTurn();
  noteEngineSession('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  const headers = shipRequestHeaders({ env });
  assert.equal(headers['x-carthagent-thread-id'], 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  assert.equal(headers['x-carthagent-turn'], '1');
  // A different session id rethreads and restarts the counter.
  noteEngineSession('cccccccc-dddd-4eee-8fff-000000000000');
  assert.equal(shipRequestHeaders({ env })['x-carthagent-turn'], '0');

  // Without a session event a thread id is still minted; print mode is stamped.
  noteEngineSession(null);
  const print = shipRequestHeaders({ env: { ...env, CARTHAGENT_RUN_MODE: 'print' } });
  assert.match(print['x-carthagent-thread-id'], UUID);
  assert.equal(print['x-carthagent-run-mode'], 'print');
});

test('device authorization sends the install id', async t => {
  const agentDir = tmp(t);
  const installId = shipInstallId({ agentDir });
  const bodies = [];
  const client = new CloudClient({
    baseUrl: 'https://cloud.test', sleep: async () => {},
    fetchImpl: async (url, options) => {
      bodies.push(JSON.parse(options.body));
      if (url.endsWith('/v1/device/authorizations')) {
        return { status: 201, ok: true, text: async () => JSON.stringify({ deviceCode: 'd', userCode: 'U', verificationUri: 'https://v', expiresIn: 1, interval: 1 }) };
      }
      return { status: 200, ok: true, text: async () => JSON.stringify({ accessToken: 'a', refreshToken: 'r', expiresIn: 1 }) };
    },
  });
  await client.authorizeDevice({ installId, signal: new AbortController().signal });
  assert.equal(bodies[0].installId, installId);

  // Older flows without an install id keep working — the field is omitted.
  const legacy = new CloudClient({
    baseUrl: 'https://cloud.test',
    fetchImpl: async (url, options) => {
      bodies.push(JSON.parse(options.body));
      return { status: 201, ok: true, text: async () => '{}' };
    },
  });
  await legacy.createDeviceAuthorization({});
  assert.equal(bodies.at(-1).installId, undefined);
});
