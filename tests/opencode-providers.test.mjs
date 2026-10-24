import test from 'node:test';
import assert from 'node:assert/strict';
import { readLegacyCarthagentCredential, refreshSingleFlight, refreshNativeCredential, credentialStorageKey, nativeCredentialFile, nativeCredentialDatabaseFile, readNativeOAuthCredential } from '../lib/opencode/credentials.mjs';
import { createSessionIdentity, managedRequestIdentity, shipTelemetryHeaders } from '../plugins/carthagent/src/server/telemetry.ts';
import { registerProviders, providerConstants } from '../plugins/carthagent/src/server/providers.ts';
import { createDeviceAuthController } from '../plugins/carthagent/src/server/device-auth.ts';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { acquireFileLock } from '../lib/opencode/file-lock.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test('provider shares actual legacy auth.json coordination lease and rejects old unbound receipt before HTTP', async t => {
  const directory = await mkdtemp(join(os.tmpdir(), 'ctg-refresh-legacy-path-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const env = { XDG_DATA_HOME: directory, OPENCODE_DB: join(directory, 'native.sqlite') };
  const vaultFile = nativeCredentialDatabaseFile(env, 'ctg.2.0.32');
  const coordinationFile = nativeCredentialFile(env);
  assert.notEqual(vaultFile, coordinationFile);
  const db = new DatabaseSync(vaultFile);
  t.after(() => db.close());
  db.exec('CREATE TABLE credential (id TEXT PRIMARY KEY, integration_id TEXT, value TEXT)');
  const credential = { type: 'oauth', methodID: 'carthagent-device', access: 'fixture-a', refresh: 'fixture-old', expires: 1 };
  db.prepare('INSERT INTO credential VALUES (?, ?, ?)').run('A', 'experiential-labs', JSON.stringify(credential));
  const digest = createHash('sha256').update(`${credential.methodID}\0${credential.refresh}`).digest('hex').slice(0, 32);
  const lock = `${coordinationFile}.ctg-refresh-${digest}.lock`;
  // This is exactly the legacy helper's path, acquired by its unchanged lock
  // implementation. A new provider must wait on it, not a SQLite sibling.
  const release = await acquireFileLock(lock);
  t.after(release);
  let httpCalls = 0;
  const fake = fakeContext();
  const cleanup = await registerProviders(fake.ctx, { env, fetchImpl: async () => { httpCalls++; throw Error('HTTP must not run'); } });
  t.after(cleanup);
  const result = fake.integrationTransforms[0][0].refresh(credential).then(() => 'unexpected success', error => error);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(httpCalls, 0, 'new provider must honor the old process lease');
  const receipt = JSON.stringify({ pid: process.pid, owner: 'legacy-owner', from: digest, to: 'legacy-rotation', stage: 'complete', createdAt: Date.now() });
  await writeFile(`${lock}.pending`, receipt, { mode: 0o600 });
  await release();
  const error = await result;
  assert.match(error.message, /Unbound or different native credential refresh receipt/);
  assert.equal(httpCalls, 0, 'old receipt at actual legacy namespace must block rotation');
  assert.equal(await readFile(`${lock}.pending`, 'utf8'), receipt, 'do not discard uncertain legacy receipt');
  await assert.rejects(readFile(`${vaultFile}.ctg-refresh-${digest}.lock.pending`), { code: 'ENOENT' });
  await assert.rejects(readFile(coordinationFile), { code: 'ENOENT' }, 'coordination must not create an alternate credential store');
});

test('native vault paths follow runtime channel, XDG data and explicit database overrides', () => {
  assert.equal(nativeCredentialDatabaseFile({ XDG_DATA_HOME: '/data' }, 'ctg.2.0.32'), resolve('/data', 'opencode', 'opencode-ctg.2.0.32.db'));
  assert.equal(nativeCredentialDatabaseFile({ XDG_DATA_HOME: '/data', OPENCODE_DB: '/private/vault.sqlite' }, 'dev'), resolve('/private/vault.sqlite'));
  assert.equal(nativeCredentialDatabaseFile({ XDG_DATA_HOME: '/data', OPENCODE_DB: 'custom.sqlite' }, 'dev'), resolve('/data', 'opencode', 'custom.sqlite'));
  assert.throws(() => nativeCredentialDatabaseFile({}, undefined), /channel is required/);
  assert.throws(() => nativeCredentialDatabaseFile({ OPENCODE_DB: ':memory:' }, 'dev'), /file-backed/);
});

test('expired native resolution refreshes once without reentering resolve and preserves native persistence', { timeout: 5000 }, async t => {
  const directory = await mkdtemp(join(os.tmpdir(), 'ctg-provider-reentry-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const credentialFile = join(directory, 'native.sqlite');
  const db = new DatabaseSync(credentialFile);
  t.after(() => db.close());
  db.exec('CREATE TABLE credential (id TEXT PRIMARY KEY, integration_id TEXT, value TEXT)');
  const expired = { type: 'oauth', methodID: 'carthagent-device', access: 'expired', refresh: 'old-refresh', expires: 1 };
  db.prepare('INSERT INTO credential VALUES (?, ?, ?)').run('cred_fixture', 'experiential-labs', JSON.stringify(expired));
  const connection = { type: 'credential', id: 'cred_fixture', method: 'oauth', label: 'fixture' };
  const fake = fakeContext();
  let resolves = 0;
  let refreshes = 0;
  const cleanup = await registerProviders(fake.ctx, { credentialFile, env: { CARTHAGENT_CLOUD_URL: 'https://cloud.test' },
    fetchImpl: async (url, init) => {
      assert.equal(String(url), 'https://cloud.test/v1/token/refresh');
      assert.ok(init.signal, 'refresh fetch must have a bounded abort signal');
      assert.equal(JSON.parse(init.body).refreshToken, 'old-refresh');
      refreshes++;
      return Response.json({ accessToken: 'rotated-access', refreshToken: 'rotated-refresh', expiresIn: 3600 });
    } });
  t.after(cleanup);
  const method = fake.integrationTransforms[0][0];
  fake.ctx.integration.connection.active = async id => id === 'experiential-labs' ? connection : undefined;
  fake.ctx.integration.connection.resolve = async () => {
    resolves++;
    assert.ok(resolves <= 2, 'refresh reread must not call resolve recursively');
    const stored = JSON.parse(db.prepare('SELECT value FROM credential WHERE id = ?').get(connection.id).value);
    if (stored.expires > Date.now() + 300000) return stored;
    const rotated = await method.refresh(stored);
    db.prepare('UPDATE credential SET value = ? WHERE id = ?').run(JSON.stringify(rotated), connection.id);
    return rotated;
  };
  const results = await Promise.all([fake.ctx.integration.connection.resolve(connection), fake.ctx.integration.connection.resolve(connection)]);
  assert.equal(refreshes, 1);
  assert.equal(resolves, 2);
  assert.equal(results[0].access, 'rotated-access');
  assert.deepEqual(results[0], results[1]);
  assert.equal(JSON.parse(db.prepare('SELECT value FROM credential').get().value).refresh, 'rotated-refresh');
  assert.equal(fake.storage.size, 0, 'plugin storage must not contain credentials');
  db.prepare('UPDATE credential SET value = ?').run('{"type":"oauth","refresh":"secret-invalid"}');
  await assert.rejects(readNativeOAuthCredential({ credentialFile, credentialID: connection.id, integrationID: 'experiential-labs', methodID: 'carthagent-device' }), error => {
    assert.doesNotMatch(error.message, /secret-invalid/);
    return /Unsupported native credential/.test(error.message);
  });
});

test('refresh pins original A despite active B before lock and during receipt wait; legacy receipts fail closed', async t => {
  const directory = await mkdtemp(join(os.tmpdir(), 'ctg-refresh-account-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const credentialFile = join(directory, 'native.sqlite');
  const db = new DatabaseSync(credentialFile);
  t.after(() => db.close());
  db.exec('CREATE TABLE credential (id TEXT PRIMARY KEY, integration_id TEXT, value TEXT)');
  const a = { type: 'oauth', methodID: 'carthagent-device', access: 'a', refresh: 'refresh-a', expires: 1 };
  const b = { ...a, access: 'b', refresh: 'refresh-b' };
  const insert = (id, value) => db.prepare('INSERT INTO credential VALUES (?, ?, ?)').run(id, 'experiential-labs', JSON.stringify(value));
  insert('A', a); insert('B', b);
  const fake = fakeContext();
  const cleanup = await registerProviders(fake.ctx, { credentialFile, env: {}, fetchImpl: async () => Response.json({ accessToken: 'new-a', refreshToken: 'new-refresh-a', expiresIn: 3600 }) });
  t.after(cleanup);
  // Any refresh-time active lookup would select the wrong account.
  fake.ctx.integration.connection.active = async () => ({ type: 'credential', id: 'B' });
  const method = fake.integrationTransforms[0][0];
  const result = await method.refresh(a);
  assert.equal(result.access, 'new-a');
  db.prepare('UPDATE credential SET value = ? WHERE id = ?').run(JSON.stringify(result), 'A');
  assert.deepEqual(JSON.parse(db.prepare('SELECT value FROM credential WHERE id = ?').get('B').value), b);
  const digest = createHash('sha256').update(`${a.methodID}\0${a.refresh}`).digest('hex').slice(0, 32);
  const pending = `${credentialFile}.ctg-refresh-${digest}.lock.pending`;
  await rm(pending);
  db.prepare('UPDATE credential SET value = ? WHERE id = ?').run(JSON.stringify(a), 'A');
  const capture = await readNativeOAuthCredential({ credentialFile, integrationID: 'experiential-labs', methodID: a.methodID, refreshToken: a.refresh });
  assert.equal(capture, 'A');
  await writeFile(pending, JSON.stringify({ pid: process.pid, owner: 'fixture', from: digest, stage: 'complete', createdAt: Date.now(), credentialID: capture }));
  let reads = 0;
  const waited = await refreshNativeCredential({ credential: a, credentialFile, credentialID: capture, timeout: 500,
    reread: async () => {
      if (++reads === 3) db.prepare('UPDATE credential SET value = ? WHERE id = ?').run(JSON.stringify(result), 'A');
      return readNativeOAuthCredential({ credentialFile, credentialID: capture, integrationID: 'experiential-labs', methodID: a.methodID });
    }, refresh: () => { throw Error('must not rotate twice'); } });
  assert.equal(waited.access, 'new-a');
  assert.ok(reads >= 3);
  await writeFile(pending, JSON.stringify({ pid: process.pid, owner: 'old-host', from: digest, stage: 'complete', createdAt: Date.now() }));
  await assert.rejects(refreshNativeCredential({ credential: a, credentialFile, credentialID: capture,
    reread: async () => result, refresh: () => { throw Error('must not refresh'); } }), /Unbound or different/);
  await rm(pending);
  db.prepare('UPDATE credential SET value = ? WHERE id = ?').run(JSON.stringify(a), 'A');
  insert('duplicate-A', a);
  await assert.rejects(method.refresh(a), /Ambiguous native OAuth credential identity/);
  db.prepare('DELETE FROM credential WHERE id IN (?, ?)').run('A', 'duplicate-A');
  await assert.rejects(method.refresh(a), /no longer stored/);
});

function fakeContext({ integrations = ['experiential-labs', 'anthropic', 'openai-codex'], connections = {}, failAt, disposeFailure } = {}) {
  const hooks = [];
  const events = [];
  const providerTransforms = [];
  const integrationTransforms = [];
  const activeRegistrations = new Set();
  const disposeCalls = [];
  const storage = new Map();
  const registrations = name => {
    activeRegistrations.add(name);
    return { async dispose() {
      disposeCalls.push(name);
      activeRegistrations.delete(name);
      if (name.startsWith('hook:')) {
        const hookName = name.slice('hook:'.length);
        const index = hooks.findIndex(hook => hook.name === hookName);
        if (index >= 0) hooks.splice(index, 1);
      }
      this.disposed = true;
      if (disposeFailure === name) throw new Error(`dispose failed: ${name}`);
    } };
  };
  const ctx = {
    app: { name: 'fixture', version: '2.0.32', channel: 'ctg.2.0.32' },
    provider: {
      async transform(callback) {
        const models = new Map();
        const editor = {
          list: () => [],
          remove() {},
          add(record) { providerTransforms.push(record); },
          get(id) { return integrations.includes(id) ? { provider: { id }, models: new Map() } : undefined; },
          models: { set(id, value) { models.set(id, value); } },
        };
        callback(editor);
        if (failAt === 'provider.transform') throw new Error('injected provider transform failure');
        providerTransforms.push({ models });
        return registrations('provider.transform');
      },
      async reload() {},
    },
    integration: {
      async transform(callback) {
        const methods = [];
        const editor = {
          list: () => integrations.map(id => ({ id, name: id })),
          get: id => integrations.includes(id) ? ({ id, name: id }) : undefined,
          update() {}, remove() {},
          method: { update(value) { methods.push(value); }, list: () => [], remove() {} },
        };
        callback(editor);
        if (failAt === 'integration.transform') throw new Error('injected integration transform failure');
        integrationTransforms.push(methods);
        return registrations('integration.transform');
      },
      connection: {
        async active(id) { return connections[id]?.connection; },
        async resolve(connection) { return connection.credential; },
      },
    },
    session: { async hook(name, callback, options) {
      if (failAt === `hook:${name}`) throw new Error(`injected hook failure: ${name}`);
      hooks.push({ name, callback, options });
      return registrations(`hook:${name}`);
    } },
    storage: {
      async get(key) { return storage.get(key); },
      async set(key, value) { storage.set(key, value); },
    },
    event: { async *subscribe({ signal } = {}) { events.push('subscribed'); if (!signal?.aborted) await new Promise(resolve => signal?.addEventListener('abort', resolve, { once: true })); } },
  };
  return { ctx, hooks, events, providerTransforms, integrationTransforms, storage, activeRegistrations, disposeCalls };
}

test('session telemetry uses stable session-derived thread IDs and request-kind identities', () => {
  const identities = createSessionIdentity({ secret: 'fixture' });
  const alpha = identities.thread('ses_native_non_uuid');
  assert.equal(alpha, identities.thread('ses_native_non_uuid'));
  assert.notEqual(alpha, identities.thread('ses_other'));
  assert.match(alpha, /^[0-9a-f-]{36}$/);
  assert.equal(managedRequestIdentity({ sessionID: 's', kind: 'primary', body: '{}', secret: 'x' }),
    managedRequestIdentity({ sessionID: 's', kind: 'primary', body: '{}', secret: 'x' }));
  assert.notEqual(managedRequestIdentity({ sessionID: 's', kind: 'primary', body: '{}', secret: 'x' }),
    managedRequestIdentity({ sessionID: 's', kind: 'title', body: '{}', secret: 'x' }));
  assert.notEqual(identities.request('same-session', 'primary'), identities.request('same-session', 'primary'));
  const headers = shipTelemetryHeaders({ sessionID: 'ses_native_non_uuid', kind: 'generate', body: '{}', env: {}, agentDir: '/missing' , identity: identities, requestSecret: 'x', version: 'test' });
  assert.equal(headers['x-carthagent-thread-id'], alpha);
  assert.equal(headers['x-carthagent-turn'], '1');
  assert.ok(headers['x-carthagent-request-id']);
  assert.equal(headers['x-carthagent-version'], 'test');
});

test('parallel token refresh callers share one rotation result and failures can retry', async () => {
  let calls = 0;
  let release;
  const work = refreshSingleFlight('credential-1:refresh-A', async () => {
    calls++;
    await new Promise(resolve => { release = resolve; });
    return { access: 'next', refresh: 'rotated' };
  });
  const concurrent = refreshSingleFlight('credential-1:refresh-A', async () => { calls++; return null; });
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await Promise.all([work, concurrent]), [
    { access: 'next', refresh: 'rotated' }, { access: 'next', refresh: 'rotated' },
  ]);
  await assert.rejects(refreshSingleFlight('credential-2', async () => { throw new Error('failed'); }), /failed/);
  assert.equal(await refreshSingleFlight('credential-2', async () => 'recovered'), 'recovered');
});

test('native SQLite vault rereads after cross-process lease acquisition and rotates once', async t => {
  const directory = await mkdtemp(join(os.tmpdir(), 'ctg-refresh-vault-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const vault = join(directory, 'native.sqlite');
  const profile = vault;
  const db = new DatabaseSync(vault);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE credential (id TEXT PRIMARY KEY, integration_id TEXT, value TEXT)');
  db.prepare('INSERT INTO credential VALUES (?, ?, ?)').run('cred_fixture', 'experiential-labs', JSON.stringify({ type: 'oauth', methodID: 'carthagent-device', refresh: 'issued-old-token', access: 'old-access', expires: 1 }));
  t.after(() => db.close());
  const moduleUrl = new URL('../lib/opencode/credentials.mjs', import.meta.url).href;
  const worker = join(directory, 'worker.mjs');
  await writeFile(worker, `
    import { readFile, writeFile } from 'node:fs/promises';
    import { DatabaseSync } from 'node:sqlite';
    import { refreshNativeCredential, readNativeOAuthCredential } from ${JSON.stringify(moduleUrl)};
    const [vault, profile, name, gate, rotating, resultFile] = process.argv.slice(2);
    while (true) { try { await readFile(gate); break; } catch { await new Promise(resolve => setTimeout(resolve, 5)); } }
    let rotatedByThisWorker = false;
    const result = await refreshNativeCredential({
      credential: { type: 'oauth', methodID: 'carthagent-device', refresh: 'issued-old-token', access: 'old-access' },
      credentialFile: profile,
      credentialID: 'cred_fixture',
      reread: () => readNativeOAuthCredential({ credentialFile: vault, credentialID: 'cred_fixture', integrationID: 'experiential-labs', methodID: 'carthagent-device' }),
      refresh: async current => {
        if (current.refresh !== 'issued-old-token') throw new Error('unexpected stale vault read');
        await writeFile(rotating, name, { flag: 'wx' });
        const rotated = { refresh: 'rotated-token', access: 'new-access' };
        rotatedByThisWorker = true;
        return { type: 'oauth', methodID: 'carthagent-device', expires: Date.now() + 3600000, ...rotated };
      },
    });
    // Model the native host: the same process that owns the refresh callback
    // persists its result atomically before exiting. Do not let the parent
    // mutate the vault after observing this worker's exit.
    if (rotatedByThisWorker) {
      // Deliberately expose the callback-return/native-write gap to contender.
      await new Promise(resolve => setTimeout(resolve, 150));
      const db = new DatabaseSync(vault);
      db.prepare('UPDATE credential SET value = ? WHERE id = ?').run(JSON.stringify(result), 'cred_fixture');
      db.close();
    }
    await writeFile(resultFile, JSON.stringify({ refresh: result.refresh, access: result.access }));
    console.log(JSON.stringify({ name, refreshed: true }));
  `);
  const rotating = join(directory, 'rotating');
  const resultFiles = ['one', 'two'].map(name => join(directory, `${name}.result`));
  const children = ['one', 'two'].map((name, index) => spawn(process.execPath, [worker, vault, profile, name, join(directory, 'go'), rotating, resultFiles[index]], { stdio: ['ignore', 'pipe', 'pipe'] }));
  const outputsPromise = Promise.all(children.map(child => new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(JSON.parse(stdout.trim())) : reject(new Error(stderr)));
  })));
  await writeFile(join(directory, 'go'), 'start');
  const waitForFile = async file => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try { return await readFile(file, 'utf8'); } catch { await new Promise(resolve => setTimeout(resolve, 10)); }
    }
    throw new Error('Timed out waiting for cross-process refresh fixture state.');
  };
  await waitForFile(rotating);
  const outputs = await outputsPromise;
  assert.deepEqual(outputs.map(output => output.refreshed), [true, true]);
  for (const resultFile of resultFiles) {
    assert.deepEqual(JSON.parse(await readFile(resultFile, 'utf8')), { refresh: 'rotated-token', access: 'new-access' });
  }
  const persisted = await readNativeOAuthCredential({ credentialFile: vault, credentialID: 'cred_fixture', integrationID: 'experiential-labs', methodID: 'carthagent-device' });
  assert.equal(persisted.refresh, 'rotated-token');
  assert.equal(persisted.access, 'new-access');
  const lockFiles = await (await import('node:fs/promises')).readdir(directory);
  assert.equal(lockFiles.some(entry => entry.includes('.ctg-refresh-') && entry.endsWith('.lock')), false, 'completed lease should be released');
  assert.equal(lockFiles.filter(entry => entry.endsWith('.lock.pending')).length, 0, 'the pending receipt is removed after the native vault shows the matching rotation');
  for (const entry of lockFiles) {
    if (!entry.includes('ctg-refresh-')) continue;
    const contents = await readFile(join(directory, entry), 'utf8').catch(() => '');
    assert.doesNotMatch(contents, /issued-old-token|rotated-token|old-access|new-access/);
  }
});

test('native refresh waits are bounded and never retry an uncertain rotation', async t => {
  const directory = await mkdtemp(join(os.tmpdir(), 'ctg-refresh-timeout-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const profile = join(directory, 'auth.json');
  const credential = { type: 'oauth', methodID: 'carthagent-device', refresh: 'issued-old-token', access: 'old-access' };
  const digest = createHash('sha256').update(`${credential.methodID}\0${credential.refresh}`).digest('hex').slice(0, 32);
  const lock = `${profile}.ctg-refresh-${digest}.lock`;
  const pending = `${lock}.pending`;
  await writeFile(pending, JSON.stringify({ pid: process.pid, owner: 'test-owner', from: digest, stage: 'complete', to: 'not-the-old-digest', createdAt: Date.now() }), { mode: 0o600 });
  let refreshCalls = 0;
  await assert.rejects(refreshNativeCredential({
    credential,
    credentialFile: profile,
    timeout: 80,
    reread: async () => credential,
    refresh: async () => { refreshCalls++; return credential; },
  }), /Timed out waiting for Carthagent runtime to persist/);
  assert.equal(refreshCalls, 0, 'a contender must not submit the old single-use token again');
  const receipt = await readFile(pending, 'utf8');
  assert.doesNotMatch(receipt, /issued-old-token|old-access/);
});

test('native refresh fails closed when its owner crashes before vault persistence', async t => {
  const directory = await mkdtemp(join(os.tmpdir(), 'ctg-refresh-owner-crash-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const profile = join(directory, 'auth.json');
  const credential = { type: 'oauth', methodID: 'carthagent-device', refresh: 'issued-old-token', access: 'old-access' };
  const digest = createHash('sha256').update(`${credential.methodID}\0${credential.refresh}`).digest('hex').slice(0, 32);
  const pending = `${profile}.ctg-refresh-${digest}.lock.pending`;
  await writeFile(pending, JSON.stringify({
    pid: Number.MAX_SAFE_INTEGER,
    owner: 'crashed-owner',
    from: digest,
    stage: 'refreshing',
    createdAt: Date.now(),
  }), { mode: 0o600 });

  let refreshCalls = 0;
  await assert.rejects(refreshNativeCredential({
    credential,
    credentialFile: profile,
    processAliveImpl: () => false,
    reread: async () => credential,
    refresh: async () => { refreshCalls++; return credential; },
  }), /ended before its vault write could be confirmed/);
  assert.equal(refreshCalls, 0, 'do not replay a potentially consumed refresh token');
  assert.equal(await readFile(pending, 'utf8').then(Boolean), true, 'preserve the receipt for recovery diagnostics');
});

test('native refresh accepts a vault rotation persisted just before its owner exits', async t => {
  const directory = await mkdtemp(join(os.tmpdir(), 'ctg-refresh-owner-exit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const profile = join(directory, 'auth.json');
  const credential = { type: 'oauth', methodID: 'carthagent-device', refresh: 'issued-old-token', access: 'old-access' };
  const rotated = { type: 'oauth', methodID: 'carthagent-device', refresh: 'rotated-token', access: 'new-access' };
  const digest = createHash('sha256').update(`${credential.methodID}\0${credential.refresh}`).digest('hex').slice(0, 32);
  const rotatedDigest = createHash('sha256').update(`${rotated.methodID}\0${rotated.refresh}`).digest('hex').slice(0, 32);
  const pending = `${profile}.ctg-refresh-${digest}.lock.pending`;
  await writeFile(pending, JSON.stringify({
    pid: Number.MAX_SAFE_INTEGER,
    owner: 'exited-owner',
    from: digest,
    to: rotatedDigest,
    stage: 'complete',
    createdAt: Date.now(),
  }), { mode: 0o600 });

  let reads = 0;
  let refreshCalls = 0;
  const result = await refreshNativeCredential({
    credential,
    credentialFile: profile,
    timeout: 500,
    processAliveImpl: () => false,
    reread: async () => ++reads >= 3 ? rotated : credential,
    refresh: async () => { refreshCalls++; throw new Error('must not rotate again'); },
  });

  assert.deepEqual(result, rotated);
  assert.equal(reads, 3, 'perform a final native-vault read after detecting owner exit');
  assert.equal(refreshCalls, 0, 'never submit the previous single-use refresh token again');
  await assert.rejects(readFile(pending), { code: 'ENOENT' }, 'remove only the matching persisted-rotation receipt');
});

test('provider registration rolls back every completed stage in reverse order after failures', async t => {
  for (const [failAt, expected] of [
    ['integration.transform', []],
    ['provider.transform', ['integration.transform']],
    ['hook:http.request', ['provider.transform', 'integration.transform']],
    ['hook:model.request', ['hook:http.request', 'provider.transform', 'integration.transform']],
    ['hook:retry', ['hook:model.request', 'hook:http.request', 'provider.transform', 'integration.transform']],
    ['hook:http.response', ['hook:retry', 'hook:model.request', 'hook:http.request', 'provider.transform', 'integration.transform']],
  ]) {
    const fake = fakeContext({ failAt });
    await assert.rejects(registerProviders(fake.ctx, { env: { CARTHAGENT_CODING_AGENT_DIR: '/missing' } }), /injected/);
    assert.deepEqual(fake.disposeCalls, expected, `rollback ordering for ${failAt}`);
    assert.equal(fake.activeRegistrations.size, 0, `all handles released after ${failAt}`);
    assert.deepEqual(fake.hooks, [], `no hook remains after ${failAt}`);
  }

  const failingCleanup = fakeContext({ failAt: 'hook:model.request', disposeFailure: 'provider.transform' });
  await assert.rejects(registerProviders(failingCleanup.ctx, { env: { CARTHAGENT_CODING_AGENT_DIR: '/missing' } }), error => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.message, /rollback was incomplete/);
    assert.match(error.errors[0].message, /injected hook failure/);
    assert.match(error.errors[1].message, /dispose failed/);
    return true;
  });
  assert.deepEqual(failingCleanup.disposeCalls, ['hook:http.request', 'provider.transform', 'integration.transform'],
    'cleanup proceeds after an individual dispose failure');
  assert.equal(failingCleanup.activeRegistrations.size, 0);
  assert.deepEqual(failingCleanup.hooks, []);
});

test('CTG device-auth generations cancel polling, expire, and clean up on unload', async () => {
  const requests = [];
  const controller = createDeviceAuthController({
    env: { CARTHAGENT_CLOUD_URL: 'https://cloud.test' }, agentDir: '/tmp/device-auth-test',
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).endsWith('/v1/device/authorizations')) return new Response(JSON.stringify({
        deviceCode: 'device', userCode: 'ABCD', verificationUri: 'https://verify.test', expiresIn: 30, interval: 1,
      }), { status: 201 });
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
    },
    sleep: async (_ms, signal) => {
      if (signal?.aborted) throw signal.reason;
    },
  });
  const flow = await controller.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(JSON.parse(requests[0].options.body).installId, UUID);
  assert.equal(requests[1].url, 'https://cloud.test/v1/device/token');
  assert.equal(controller.cancel(flow.flowId), true);
  await assert.rejects(flow.callback, /cancelled/);
  assert.equal(controller.cancel(flow.flowId), false);

  const next = await controller.start();
  await new Promise(resolve => setImmediate(resolve));
  await controller.cleanup();
  await assert.rejects(next.callback, /plugin_unloaded/);
  assert.equal(controller.cancel(next.flowId), false);
});

test('legacy credential migration reads Ship OAuth and BYOK without writing Pi store', async () => {
  const source = JSON.stringify({
    'experiential-labs': { type: 'oauth', access: 'a', refresh: 'r', expires: 123 },
  });
  assert.deepEqual(await readLegacyCarthagentCredential({ agentDir: '/unused', readFileImpl: async () => source }),
    { type: 'oauth', access: 'a', refresh: 'r', expires: 123 });
  assert.equal(credentialStorageKey('experiential-labs'), 'ctg.credentials/experiential-labs');
  assert.equal(nativeCredentialFile({ XDG_DATA_HOME: '/profile/data' }), join('/profile/data', 'opencode', 'auth.json'));
  assert.equal(nativeCredentialFile({}, 'darwin', '/home/test'), join('/home/test', 'Library', 'Application Support', 'opencode', 'auth.json'));
  assert.throws(() => credentialStorageKey('../auth'), /Invalid/);
});

test('native sign-in starts fresh device authorization after opt-in legacy migration and on reconnect', async t => {
  const directory = await mkdtemp(join(os.tmpdir(), 'ctg-signin-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const legacyFile = join(directory, 'auth.json');
  const source = JSON.stringify({ 'experiential-labs': { type: 'oauth', access: 'legacy-access', refresh: 'legacy-refresh', expires: 123 } });
  await writeFile(legacyFile, source, { mode: 0o600 });
  const connections = {};
  const fake = fakeContext({ connections });
  const requests = [];
  const browserUrls = [];
  let generation = 0;
  const cleanup = await registerProviders(fake.ctx, {
    env: { CARTHAGENT_CLOUD_URL: 'https://cloud.test' }, agentDir: directory, now: () => 1000,
    openBrowser: url => { browserUrls.push(url); return false; },
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(init.body) });
      if (String(url).endsWith('/v1/device/authorizations')) {
        generation++;
        return Response.json({ deviceCode: `device-${generation}`, userCode: `CODE-${generation}`,
          verificationUri: 'https://verify.test', verificationUriComplete: `https://verify.test/${generation}`, expiresIn: 60, interval: 1 });
      }
      assert.equal(String(url), 'https://cloud.test/v1/device/token');
      const device = JSON.parse(init.body).deviceCode;
      return Response.json({ accessToken: `access-${device}`, refreshToken: `refresh-${device}`, expiresIn: 3600 });
    },
  });
  t.after(cleanup);
  const method = fake.integrationTransforms[0][0];
  assert.equal(method.method.form[0].default, false);
  const imported = await method.authorize({ importLegacy: true });
  assert.deepEqual(await imported.callback, { type: 'oauth', methodID: 'carthagent-device', access: 'legacy-access', refresh: 'legacy-refresh', expires: 123 });
  assert.equal(requests.length, 0, 'one-way compatibility import remains available without browser authorization');

  // Model the native host committing callback results to its active connection.
  // The plugin must not create a second credential store or modify legacy auth.
  connections['experiential-labs'] = { connection: { id: 'native-ship', credential: await imported.callback } };
  for (const expected of [1, 2]) {
    const authorization = await method.authorize({});
    assert.equal(authorization.mode, 'auto');
    assert.equal(authorization.url, `https://verify.test/${expected}`);
    assert.equal(authorization.expiresAt, 61_000);
    assert.match(authorization.instructions, new RegExp(`CODE-${expected}`));
    const credential = await authorization.callback;
    assert.deepEqual(credential, { type: 'oauth', methodID: 'carthagent-device',
      access: `access-device-${expected}`, refresh: `refresh-device-${expected}`, expires: 3_601_000 });
    connections['experiential-labs'].connection.credential = credential;
    assert.deepEqual(await fake.ctx.integration.connection.resolve(await fake.ctx.integration.connection.active('experiential-labs')), credential);
  }
  assert.deepEqual(browserUrls, ['https://verify.test/1', 'https://verify.test/2']);
  assert.equal(requests.filter(request => request.url.endsWith('/v1/device/authorizations')).length, 2);
  assert.equal(requests.filter(request => request.url.endsWith('/v1/device/token')).length, 2);
  assert.equal(fake.storage.size, 0, 'credentials are returned to native storage, not plugin storage');
  assert.equal(await readFile(legacyFile, 'utf8'), source, 'migration and reconnect leave legacy credentials untouched');
});

test('provider registration uses native provider transforms and cleanup; refresh discovers subscriptions through injected APIs', async () => {
  const token = `x.${Buffer.from(JSON.stringify({ sub: 'acct', sid: 'sid', scope: 'gateway:invoke' })).toString('base64url')}.x`;
  const connections = {
    'experiential-labs': { connection: { id: 'ship', credential: { type: 'oauth', access: token, refresh: 'refresh', expires: Date.now() + 100000 } } },
    anthropic: { connection: { id: 'claude', credential: { type: 'oauth', access: 'claude-token' } } },
    'openai-codex': { connection: { id: 'codex', credential: { type: 'oauth', access: 'codex-token' } } },
  };
  const fake = fakeContext({ integrations: ['experiential-labs', 'anthropic', 'openai-codex'], connections });
  const fetchCalls = [];
  const fetchImpl = async (url, init) => {
    fetchCalls.push([String(url), init]);
    if (String(url).endsWith('/models') && String(url).includes('experientiallabs')) {
      return new Response(JSON.stringify({ data: [{ id: 'gpt-6-luna' }, { id: 'unknown-model', name: 'Unknown' }] }), { status: 200 });
    }
    if (String(url).includes('api.anthropic.com')) return new Response(JSON.stringify({ data: [{ id: 'claude-test', type: 'model' }] }), { status: 200 });
    if (String(url).includes('chatgpt.com')) return new Response(JSON.stringify({ models: [{ slug: 'codex-test', supported_reasoning_levels: ['low', 'high'] }] }), { status: 200 });
    throw new Error(`unexpected URL ${url}`);
  };
  const cleanup = await registerProviders(fake.ctx, {
    env: { CARTHAGENT_CODING_AGENT_DIR: '/missing' }, fetchImpl,
    openBrowser: () => false, requestSecret: 'test-secret',
  });
  assert.equal(typeof cleanup, 'function');
  assert.deepEqual(fake.integrationTransforms[0].map(item => item.integrationID), ['experiential-labs', 'experiential-labs', 'experiential-labs']);
  assert.equal(fake.integrationTransforms[0][0].method.id, 'carthagent-device');
  assert.equal(fake.integrationTransforms[0][1].method.type, 'key');
  assert.equal(fake.providerTransforms.find(item => item.info?.id === providerConstants.SHIP_PROVIDER_ID).info.package,
    '@opencode/ai/providers/openai-compatible');
  assert.ok(fake.hooks.some(item => item.name === 'http.request' && item.options.providerID === 'experiential-labs'));
  assert.ok(fake.hooks.some(item => item.name === 'http.response'));
  const hooksByName = Object.fromEntries(fake.hooks.map(item => [item.name, item]));
  const nativeSession = { sessionID: 'ses_non_uuid_123', kind: 'primary', model: { providerID: 'experiential-labs' } };
  const modelRequest = { ...nativeSession, headers: {} };
  await hooksByName['model.request'].callback(modelRequest);
  const nextModelRequest = { ...nativeSession, headers: {} };
  await hooksByName['model.request'].callback(nextModelRequest);
  assert.ok(modelRequest.headers['x-carthagent-request-id']);
  assert.notEqual(modelRequest.headers['x-carthagent-request-id'], nextModelRequest.headers['x-carthagent-request-id'],
    'separate native requests in one session must have distinct idempotency identities');
  const auxiliaryRequest = { ...nativeSession, kind: 'title', headers: {} };
  await hooksByName['model.request'].callback(auxiliaryRequest);
  assert.notEqual(modelRequest.headers['x-carthagent-request-id'], auxiliaryRequest.headers['x-carthagent-request-id'],
    'auxiliary request kinds must have independent identities');
  const request = new Request('https://gateway.example/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'gpt-6-luna', messages: [] }) });
  const hookedRequestEvent = { ...nativeSession, request: new Request(request, { headers: { 'x-carthagent-request-id': modelRequest.headers['x-carthagent-request-id'] } }) };
  await hooksByName['http.request'].callback(hookedRequestEvent);
  assert.equal(hookedRequestEvent.request.headers.get('x-carthagent-thread-id')?.length, 36);
  assert.equal(hookedRequestEvent.request.headers.get('Idempotency-Key'), modelRequest.headers['x-carthagent-request-id']);
  const retry = new Request('https://gateway.example/v1/chat/completions', { method: 'POST', headers: { 'x-carthagent-request-id': modelRequest.headers['x-carthagent-request-id'] }, body: JSON.stringify({ model: 'gpt-6-luna', messages: [] }) });
  const retryRequestEvent = { ...nativeSession, request: retry };
  await hooksByName['http.request'].callback(retryRequestEvent);
  assert.equal(retryRequestEvent.request.headers.get('Idempotency-Key'), hookedRequestEvent.request.headers.get('Idempotency-Key'),
    'transport retry identity must remain stable');
  const retryEvent = { ...nativeSession, attempt: 1, decision: { retry: true, delay: 0 }, error: {} };
  await hooksByName.retry.callback(retryEvent);
  assert.deepEqual(retryEvent.decision, { retry: false });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.ok(fetchCalls.some(([url]) => url.includes('/models')));
  await cleanup();
  assert.ok(fake.events.includes('subscribed'));
});
