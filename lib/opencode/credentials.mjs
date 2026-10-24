/** CTG-owned credential helpers. OpenCode's integration store remains the
 * authoritative store; this module only coordinates refresh and supports a
 * one-way migration read from Carthagent's legacy auth.json. */
import { open, readFile, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import os from 'node:os';
import { shipAgentDir } from '../ship-auth.mjs';
import { CARTHAGENT_SHIP_PROVIDER_ID } from '../providers/names.mjs';
import { withFileLock } from './file-lock.mjs';
import { Credential } from '@opencode/schema/credential';
import { Schema } from 'effect';

export const CTG_CREDENTIAL_NAMESPACE = 'ctg.credentials/';
const refreshFlights = new Map();

const identity = value => String(value || '').trim();
const processAlive = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
};

/** Single-flight by credential ID and refresh-token fingerprint. The callback
 * persists the returned rotated token through the authoritative OpenCode
 * integration refresh path; callers sharing the old credential await it. */
export function refreshSingleFlight(key, refresh) {
  const flightKey = identity(key);
  if (!flightKey) return Promise.reject(new TypeError('A credential refresh key is required.'));
  if (typeof refresh !== 'function') return Promise.reject(new TypeError('A refresh callback is required.'));
  const active = refreshFlights.get(flightKey);
  if (active) return active;
  const flight = Promise.resolve().then(refresh);
  refreshFlights.set(flightKey, flight);
  return flight.finally(() => {
    if (refreshFlights.get(flightKey) === flight) refreshFlights.delete(flightKey);
  });
}

/** Select OpenCode's native profile credential file; never store a credential here. */
export function nativeCredentialFile(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.CTG_OPENCODE_CREDENTIAL_FILE) return resolve(env.CTG_OPENCODE_CREDENTIAL_FILE);
  const dataHome = env.XDG_DATA_HOME || (platform === 'darwin'
    ? join(home, 'Library', 'Application Support')
    : platform === 'win32'
      ? env.APPDATA || join(home, 'AppData', 'Roaming')
      : join(home, '.local', 'share'));
  return join(dataHome, 'opencode', 'auth.json');
}

/** OpenCode 2.0.32 packages/cli/src/database-path.ts and util/global-roots.ts.
 * Unlike legacy auth.json, the native credential vault is in the channel DB.
 * The running host supplies its channel; never infer it from a release label. */
export function nativeCredentialDatabaseFile(env = process.env, channel, home = os.homedir()) {
  if (!channel) throw new Error('The native runtime channel is required to locate its credential vault.');
  const data = join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'opencode');
  const filename = env.OPENCODE_DB ?? (['latest', 'dev', 'beta', 'next', 'prod'].includes(channel)
    || ['1', 'true'].includes(env.OPENCODE_DISABLE_CHANNEL_DB)
    ? 'opencode.db' : `opencode-${channel.replace(/[^a-zA-Z0-9._-]/g, '-')}.db`);
  if (filename === ':memory:') throw new Error('Native OAuth refresh requires a file-backed credential vault.');
  return resolve(data, filename);
}

/** Raw read only: connection.resolve() refreshes expired OAuth and must never
 * be called from its own refresh callback. Schema provenance: pinned 2.0.32
 * packages/core/src/credential/sql.ts; value is Credential.Value JSON. Opening
 * read-only must fail for missing/changed vaults, never create a parallel store.
 * Bun is the native host; node:sqlite supports the same regression under Node.
 * @param {{credentialFile: string, credentialID?: string, integrationID: string, methodID: string, refreshToken?: string}} options
 */
export async function readNativeOAuthCredential({ credentialFile, credentialID = undefined, integrationID, methodID, refreshToken = undefined }) {
  const db = typeof globalThis.Bun !== 'undefined'
    ? new (await import('bun:sqlite')).Database(credentialFile, { readonly: true, strict: true })
    : new (await import('node:sqlite')).DatabaseSync(credentialFile, { readOnly: true });
  try {
    // Capture the callback's original row, never the current active selection.
    // LIMIT 2 detects duplicate grants without selecting an arbitrary account.
    const query = credentialID
      ? 'SELECT id, value FROM credential WHERE id = ? AND integration_id = ?'
      : `SELECT id, value FROM credential WHERE integration_id = ? AND json_extract(value, '$.type') = 'oauth'
        AND json_extract(value, '$.methodID') = ? AND json_extract(value, '$.refresh') = ? LIMIT 2`;
    const statement = typeof db.prepare === 'function' ? db.prepare(query) : db.query(query);
    const rows = credentialID ? statement.all(credentialID, integrationID) : statement.all(integrationID, methodID, refreshToken);
    if (rows.length > 1) throw new Error('Ambiguous native OAuth credential identity; no refresh was attempted.');
    const row = rows[0];
    if (!row) throw new Error('The native OAuth credential is no longer stored; reconnect before refreshing.');
    // Do not include SQLite/JSON/schema errors or their input values in logs.
    let value;
    try { value = Schema.decodeUnknownSync(Credential.Value)(JSON.parse(row.value)); }
    catch { throw new Error('Unsupported native credential vault value; no refresh was attempted.'); }
    if (value.type !== 'oauth' || value.methodID !== methodID) {
      throw new Error('The native OAuth credential method changed; no refresh was attempted.');
    }
    return credentialID ? value : row.id;
  } finally { db.close(); }
}

/** Serialize refresh across host processes, rereading OpenCode's vault under the lock.
 * @param {{credential: any, credentialFile: string, credentialID?: string, reread: () => Promise<any>, refresh: (credential: any) => Promise<any>, timeout?: number}} options
 */
export async function refreshNativeCredential({
  credential,
  credentialFile,
  credentialID,
  reread,
  refresh,
  timeout = 15_000,
  processAliveImpl = processAlive,
} = {}) {
  if (!credential?.refresh || typeof reread !== 'function' || typeof refresh !== 'function') {
    throw new TypeError('A refresh credential, vault reread, and refresh callback are required.');
  }
  const profile = resolve(credentialFile);
  // Token material is never written to the lease path or logs.
  const digest = createHash('sha256').update(`${credential.methodID || ''}\0${credential.refresh}`).digest('hex').slice(0, 32);
  const lock = `${profile}.ctg-refresh-${digest}.lock`;
  // Keep the existing token-scoped lock path so old hosts cannot rotate in
  // parallel. Old unbound receipts are uncertain and must not be adopted.
  const pending = `${lock}.pending`;
  const credentialDigest = value => createHash('sha256')
    .update(`${value?.methodID || credential.methodID || ''}\0${value?.refresh || ''}`).digest('hex').slice(0, 32);
  return withFileLock(lock, async () => {
    const acceptPersistedRotation = async () => {
      const latest = await reread();
      if (latest?.type !== 'oauth' || !latest.refresh || credentialDigest(latest) === digest) return undefined;
      const persistedReceipt = await readFile(pending, 'utf8').catch(() => '');
      if (persistedReceipt === receipt?.raw) await rm(pending, { force: true });
      return latest;
    };
    // OpenCode persists refresh callback results only after this callback
    // resolves. Leave a token-free handoff receipt so another host that wins
    // the disk lock during that gap waits for the native vault write instead
    // of presenting the single-use refresh token a second time.
    let receipt;
    try {
      receipt = JSON.parse(await readFile(pending, 'utf8'));
      receipt.raw = JSON.stringify({ pid: receipt.pid, owner: receipt.owner, from: receipt.from, to: receipt.to, stage: receipt.stage, createdAt: receipt.createdAt, credentialID: receipt.credentialID });
    }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Invalid pending native credential refresh receipt; inspect the CTG refresh receipt before retrying.'); }
    if (credentialID && receipt && receipt.credentialID !== credentialID) {
      throw new Error('Unbound or different native credential refresh receipt; no rotation was attempted. Reauthenticate or inspect the receipt before retrying.');
    }
    const current = await reread();
    if (current?.type === 'oauth' && current.refresh && current.refresh !== credential.refresh) {
      if (receipt?.from === digest && receipt.to === credentialDigest(current)) {
        const persistedReceipt = await readFile(pending, 'utf8').catch(() => '');
        if (persistedReceipt === receipt.raw) await rm(pending, { force: true });
      }
      return current;
    }
    if (receipt) {
      if (receipt.from !== digest) throw new Error('A different native credential refresh is pending; retry after the active host saves its credential.');
      if (receipt.stage === 'failed') throw new Error('A previous Ship refresh ended with an uncertain result. No second rotation was attempted; reauthenticate to recover safely.');
      if (receipt.stage !== 'complete' && !processAliveImpl(receipt.pid)) {
        throw new Error('A previous native credential refresh ended before its vault write could be confirmed. Inspect the CTG refresh receipt and reauthenticate if necessary; no second rotation was attempted.');
      }
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        const latest = await acceptPersistedRotation();
        if (latest) return latest;
        if (!processAliveImpl(receipt.pid)) {
          // The callback owner can persist the native vault and exit after the
          // preceding read but before this liveness check. Make one final
          // authoritative read before treating the outcome as uncertain.
          const persisted = await acceptPersistedRotation();
          if (persisted) return persisted;
          throw new Error('The native refresh owner exited before Carthagent runtime saved its credential. No second rotation was attempted; inspect the CTG refresh receipt.');
        }
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      throw new Error('Timed out waiting for Carthagent runtime to persist its refreshed credential; no second refresh was attempted.');
    }

    const owner = randomUUID();
    const initialReceipt = JSON.stringify({ pid: process.pid, owner, from: digest, stage: 'refreshing', createdAt: Date.now(), credentialID });
    const pendingHandle = await open(pending, 'wx', 0o600);
    try { await pendingHandle.writeFile(initialReceipt); await pendingHandle.sync(); }
    finally { await pendingHandle.close(); }
    const saveReceipt = async value => {
      const temporary = `${pending}.${owner}.${value.stage}.tmp`;
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify({ ...value, credentialID })); await handle.sync(); }
      finally { await handle.close(); }
      if (await readFile(pending, 'utf8').catch(() => '') !== initialReceipt) {
        await rm(temporary, { force: true });
        throw new Error('Native credential refresh ownership changed unexpectedly; inspect the CTG refresh receipt.');
      }
      await rename(temporary, pending);
    };
    let rotated;
    try {
      rotated = await refresh(current?.type === 'oauth' ? current : credential);
      if (rotated?.type !== 'oauth' || !rotated.refresh || !rotated.access) throw new Error('Ship token refresh returned an invalid OAuth credential.');
    } catch (error) {
      await saveReceipt({ pid: process.pid, owner, from: digest, stage: 'failed', createdAt: Date.now() });
      throw error;
    }
    await saveReceipt({
      pid: process.pid,
      owner,
      from: digest,
      to: credentialDigest(rotated),
      stage: 'complete',
      createdAt: Date.now(),
    });
    return rotated;
  }, { timeout });
}

/** Namespaced plugin-store keys avoid colliding with host/plugin settings. */
export function credentialStorageKey(integrationID) {
  const id = identity(integrationID);
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(id)) throw new TypeError('Invalid CTG integration id.');
  return `${CTG_CREDENTIAL_NAMESPACE}${id}`;
}

/**
 * Read a legacy Pi-compatible auth entry for explicit migration only. Never
 * writes the old file; successful login/refresh must be saved by OpenCode.
 */
export async function readLegacyCarthagentCredential({
  agentDir = shipAgentDir(),
  providerID = CARTHAGENT_SHIP_PROVIDER_ID,
  readFileImpl = readFile,
} = {}) {
  try {
    const parsed = JSON.parse(await readFileImpl(join(agentDir, 'auth.json'), 'utf8'));
    const credential = parsed?.[providerID];
    if (credential?.type === 'oauth'
      && typeof credential.access === 'string' && credential.access
      && typeof credential.refresh === 'string' && credential.refresh
      && Number.isFinite(Number(credential.expires))) {
      return { type: 'oauth', access: credential.access, refresh: credential.refresh, expires: Number(credential.expires) };
    }
    // BYOK used the same provider namespace in Pi and remains a valid direct
    // OpenCode API key; do not reinterpret it as managed Ship OAuth.
    if (credential?.type === 'api_key' && typeof credential.key === 'string' && credential.key.trim()) {
      return { type: 'api_key', key: credential.key.trim() };
    }
  } catch { /* no legacy store or unreadable/malformed data */ }
  return undefined;
}

/** Mark only an explicit migration value as eligible for OpenCode OAuth
 * persistence. The actual write is returned from IntegrationOAuthAuthorization
 * and is therefore performed by OpenCode's credential store. */
export async function legacyOAuthForOpenCode(options = {}) {
  const credential = await readLegacyCarthagentCredential(options);
  if (credential?.type !== 'oauth') return undefined;
  return {
    type: 'oauth',
    methodID: 'carthagent-device',
    access: credential.access,
    refresh: credential.refresh,
    expires: Math.trunc(credential.expires),
  };
}

export function legacyCredentialMigrationGuidance() {
  return 'Existing Carthagent Ship OAuth can be migrated from the legacy auth.json credential into Carthagent runtime integration storage; other provider credentials remain BYOK and may be reconnected through Carthagent runtime if their format is unsupported.';
}
