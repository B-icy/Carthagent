import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
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

test('install id seed remains authoritative across primary-file corruption and deletion', t => {
  const agentDir = tmp(t);
  const first = shipInstallId({ agentDir });
  assert.match(first, UUID);
  assert.equal(shipInstallId({ agentDir }), first);
  assert.equal(readFileSync(installIdPath(agentDir), 'utf8').trim(), first);
  writeFileSync(installIdPath(agentDir), 'garbage-not-a-uuid');
  const regenerated = shipInstallId({ agentDir });
  assert.match(regenerated, UUID);
  assert.equal(regenerated, first);
  writeFileSync(installIdPath(agentDir), 'different-corrupt-content');
  assert.equal(shipInstallId({ agentDir }), first);
  rmSync(installIdPath(agentDir));
  assert.equal(shipInstallId({ agentDir }), first);
});

test('concurrent first runs and corrupt repairs converge on one install id', async t => {
  const lib = new URL('../lib/ship-telemetry.mjs', import.meta.url).href;
  const startTogether = async (agentDir, label, count = 6) => {
    const gate = join(agentDir, `${label}.start`);
    const children = Array.from({ length: count }, (_, index) => {
      const ready = join(agentDir, `${label}.${index}.ready`);
      const code = `import { existsSync, writeFileSync } from 'node:fs';
        import { shipInstallId } from '${lib}';
        const ready = ${JSON.stringify(ready)};
        while (true) { try { writeFileSync(ready, 'ready', { flag: 'wx' }); break; } catch { if (existsSync(ready)) break; } }
        const gate = ${JSON.stringify(gate)};
        while (!existsSync(gate)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
        console.log(shipInstallId({ agentDir: ${JSON.stringify(agentDir)} }));`;
      const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
      child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
      const result = new Promise((resolve, reject) => child.once('error', reject).once('close', code => {
        if (code !== 0) reject(new Error(`install-id worker exited ${code}: ${stderr}`));
        else resolve(stdout.trim());
      }));
      return { child, ready, result };
    });
    try {
      const deadline = Date.now() + 10_000;
      while (!children.every(worker => existsSync(worker.ready))) {
        assert.ok(Date.now() < deadline, 'all worker processes should reach the start barrier');
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      writeFileSync(gate, 'go');
      return await Promise.all(children.map(worker => worker.result));
    } finally {
      // A barrier timeout must not strand workers in their polling loops and
      // keep Node's test process alive.
      for (const worker of children) {
        if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill('SIGKILL');
      }
      await Promise.race([
        Promise.allSettled(children.map(worker => worker.result)),
        new Promise(resolve => {
          const timer = setTimeout(resolve, 2_000);
          Promise.allSettled(children.map(worker => worker.result)).then(() => clearTimeout(timer));
        }),
      ]);
    }
  };
  // Fresh directory: racing launches adopt a single id.
  const fresh = tmp(t);
  const ids = await startTogether(fresh, 'fresh');
  assert.equal(new Set(ids).size, 1, `fresh IDs diverged: ${ids.join(', ')}`);
  assert.match(ids[0], UUID);
  assert.equal(readFileSync(installIdPath(fresh), 'utf8').trim(), ids[0]);
  assert.equal(readFileSync(`${installIdPath(fresh)}.seed`, 'utf8').trim(), ids[0]);
  // Corrupt file: racing repairs also converge.
  const corrupt = tmp(t);
  writeFileSync(installIdPath(corrupt), 'garbage');
  const lockPath = `${installIdPath(corrupt)}.lock`;
  writeFileSync(lockPath, 'legacy-stale-lock');
  const repaired = await startTogether(corrupt, 'corrupt');
  assert.equal(new Set(repaired).size, 1, `repaired IDs diverged: ${repaired.join(', ')}`);
  assert.equal(readFileSync(installIdPath(corrupt), 'utf8').trim(), repaired[0]);
  assert.match(repaired[0], UUID);
  assert.equal(readFileSync(lockPath, 'utf8'), 'legacy-stale-lock', 'legacy lock is not stolen or deleted');
  // Empty/missing-primary contenders also repair to the seed rather than
  // independently minting identities.
  rmSync(installIdPath(corrupt));
  const afterDelete = await startTogether(corrupt, 'deleted');
  assert.equal(new Set(afterDelete).size, 1);
  assert.equal(afterDelete[0], repaired[0]);
});

test('a valid legacy primary id seeds future repairs without identity churn', t => {
  const agentDir = tmp(t);
  const legacyId = '11111111-2222-4333-8444-555555555555';
  writeFileSync(installIdPath(agentDir), `${legacyId}\n`);
  assert.equal(shipInstallId({ agentDir }), legacyId);
  assert.equal(readFileSync(`${installIdPath(agentDir)}.seed`, 'utf8').trim(), legacyId);
  rmSync(installIdPath(agentDir));
  assert.equal(shipInstallId({ agentDir }), legacyId);
});

test('a valid legacy primary remains canonical when an existing seed is malformed', t => {
  const agentDir = tmp(t);
  const legacyId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  writeFileSync(installIdPath(agentDir), `${legacyId}\n`);
  const seed = `${installIdPath(agentDir)}.seed`;
  writeFileSync(seed, 'not-a-uuid\n');
  writeFileSync(`${seed}.repair-lock`, 'abandoned-owner');
  assert.equal(shipInstallId({ agentDir }), legacyId);
  assert.equal(readFileSync(`${seed}.recovery`, 'utf8').trim(), legacyId);
  assert.equal(readFileSync(seed, 'utf8').trim(), 'not-a-uuid');
  rmSync(installIdPath(agentDir));
  assert.equal(shipInstallId({ agentDir }), legacyId);
  assert.equal(readFileSync(installIdPath(agentDir), 'utf8').trim(), legacyId);
});

test('concurrent malformed-seed repair preserves a valid legacy primary', async t => {
  const agentDir = tmp(t);
  const legacyId = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
  writeFileSync(installIdPath(agentDir), `${legacyId}\n`);
  writeFileSync(`${installIdPath(agentDir)}.seed`, 'corrupt-seed');
  const repaired = await (async () => {
    const lib = new URL('../lib/ship-telemetry.mjs', import.meta.url).href;
    const gate = join(agentDir, 'legacy-seed.start');
    const children = Array.from({ length: 6 }, (_, index) => {
      const ready = join(agentDir, `legacy-seed.${index}.ready`);
      const code = `import { existsSync, writeFileSync } from 'node:fs';
        import { shipInstallId } from '${lib}';
        const ready = ${JSON.stringify(ready)};
        writeFileSync(ready, 'ready');
        const gate = ${JSON.stringify(gate)};
        while (!existsSync(gate)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
        console.log(shipInstallId({ agentDir: ${JSON.stringify(agentDir)} }));`;
      const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
      child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
      const result = new Promise((resolve, reject) => child.once('error', reject).once('close', code => {
        if (code !== 0) reject(new Error(`install-id worker exited ${code}: ${stderr}`));
        else resolve(stdout.trim());
      }));
      return { child, ready, result };
    });
    try {
      const deadline = Date.now() + 10_000;
      while (!children.every(worker => existsSync(worker.ready))) {
        assert.ok(Date.now() < deadline, 'all worker processes should reach the start barrier');
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      writeFileSync(gate, 'go');
      return await Promise.all(children.map(worker => worker.result));
    } finally {
      for (const worker of children) {
        if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill('SIGKILL');
      }
      await Promise.allSettled(children.map(worker => worker.result));
    }
  })();
  assert.deepEqual(new Set(repaired), new Set([legacyId]));
  assert.equal(readFileSync(`${installIdPath(agentDir)}.seed.recovery`, 'utf8').trim(), legacyId);
  rmSync(installIdPath(agentDir));
  assert.equal(shipInstallId({ agentDir }), legacyId);
});

test('when all identity copies are corrupt, deterministic recovery stays stable', t => {
  const agentDir = tmp(t);
  const path = installIdPath(agentDir);
  writeFileSync(path, 'bad-primary');
  writeFileSync(`${path}.seed`, 'bad-seed');
  writeFileSync(`${path}.seed.recovery`, 'bad-recovery');
  const id = shipInstallId({ agentDir });
  assert.match(id, UUID);
  assert.equal(shipInstallId({ agentDir }), id);
  rmSync(path);
  assert.equal(shipInstallId({ agentDir }), id);
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
