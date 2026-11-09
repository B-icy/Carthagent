/** CTG-owned credential helpers. OpenCode's integration store remains the
 * authoritative store; this module only coordinates refresh and supports a
 * one-way migration read from Carthagent's legacy auth.json. */
import { open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import os from 'node:os';
import { shipAgentDir } from '../ship-auth.mjs';
import { CARTHAGENT_SHIP_PROVIDER_ID, CARTHAGENT_SHIP_LEGACY_PROVIDER_IDS } from '../providers/names.mjs';
import { withFileLock } from './file-lock.mjs';
import { Credential } from '@opencode/schema/credential';
import { Schema } from 'effect';

export const CTG_CREDENTIAL_NAMESPACE = 'ctg.credentials/';
const refreshFlights = new Map();

// Carthagent Cloud accepts a retry of the just-rotated refresh token for 60
// seconds (lost-response grace). Stay well inside it: a retry must be sent by
// this point after the first attempt, leaving room for the request timeout.
export const REFRESH_RETRY_WINDOW_MS = 40_000;
const REFRESH_RETRY_DELAYS_MS = [500, 2_000, 5_000];
// Refresh tokens expire 30 days after issue, so older receipts are inert.
const RECEIPT_MAX_AGE_MS = 31 * 24 * 60 * 60 * 1000;

/** An HTTP 4xx answer proves the server did not rotate the token. Network
 * errors, timeouts, 5xx and malformed success bodies leave rotation unknown. */
export function refreshRejected(error) {
  return Number.isInteger(error?.status) && error.status >= 400 && error.status < 500;
}

const reauthenticate = 'Run /login (or ctg login) and choose Carthagent Cloud to reconnect.';

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
    let rows = credentialID ? statement.all(credentialID, integrationID) : statement.all(integrationID, methodID, refreshToken);
    // Credentials stored under the pre-rename provider id still resolve.
    if (!rows.length && integrationID === CARTHAGENT_SHIP_PROVIDER_ID) {
      for (const legacyID of CARTHAGENT_SHIP_LEGACY_PROVIDER_IDS) {
        rows = credentialID ? statement.all(credentialID, legacyID) : statement.all(legacyID, methodID, refreshToken);
        if (rows.length) break;
      }
    }
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
 * An HTTP 4xx answer proves no rotation and clears the receipt. An unknown
 * outcome (connection reset, timeout, 5xx) is retried with the same token
 * inside the server's lost-response grace window, here or by a later call
 * that finds the failed receipt; only after the window does it fail closed.
 * @param {{credential: any, credentialFile: string, credentialID?: string, reread: () => Promise<any>, refresh: (credential: any) => Promise<any>, timeout?: number, retryDelays?: number[], now?: () => number, sleep?: (ms: number) => Promise<void>}} options
 */
export async function refreshNativeCredential({
  credential,
  credentialFile,
  credentialID,
  reread,
  refresh,
  timeout = 15_000,
  processAliveImpl = processAlive,
  retryDelays = REFRESH_RETRY_DELAYS_MS,
  now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
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
      receipt.raw = JSON.stringify({ pid: receipt.pid, owner: receipt.owner, from: receipt.from, to: receipt.to, stage: receipt.stage, createdAt: receipt.createdAt, attemptedAt: receipt.attemptedAt, credentialID: receipt.credentialID });
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
    // An unknown outcome whose first attempt is still inside the server's
    // grace window may be retried with the same token; older ones fail closed.
    const retryable = receipt?.from === digest && Number.isFinite(receipt.attemptedAt)
      && now() - receipt.attemptedAt < REFRESH_RETRY_WINDOW_MS
      && (receipt.stage === 'failed' || (receipt.stage === 'refreshing' && !processAliveImpl(receipt.pid)));
    if (receipt && !retryable) {
      if (receipt.from !== digest) throw new Error('A different native credential refresh is pending; retry after the active host saves its credential.');
      if (receipt.stage === 'failed' || (receipt.stage !== 'complete' && !processAliveImpl(receipt.pid))) {
        throw new Error(`Carthagent Cloud did not confirm an earlier sign-in refresh, and the safe retry window has passed. ${reauthenticate}`);
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
    const attemptedAt = retryable ? receipt.attemptedAt : now();
    const initialReceipt = JSON.stringify({ pid: process.pid, owner, from: digest, stage: 'refreshing', createdAt: Date.now(), attemptedAt, credentialID });
    const writeReceipt = async (file, contents, flag) => {
      const handle = await open(file, flag, 0o600);
      try { await handle.writeFile(contents); await handle.sync(); }
      finally { await handle.close(); }
    };
    if (retryable) {
      // Take over the uncertain receipt under the lock; keep its first attempt
      // time so retries never extend the server's grace window.
      const temporary = `${pending}.${owner}.refreshing.tmp`;
      await writeReceipt(temporary, initialReceipt, 'wx');
      if (await readFile(pending, 'utf8').catch(() => '') !== receipt.raw) {
        await rm(temporary, { force: true });
        throw new Error('Native credential refresh ownership changed unexpectedly; inspect the CTG refresh receipt.');
      }
      await rename(temporary, pending);
    } else {
      await writeReceipt(pending, initialReceipt, 'wx');
    }
    const saveReceipt = async value => {
      const temporary = `${pending}.${owner}.${value.stage}.tmp`;
      await writeReceipt(temporary, JSON.stringify({ ...value, credentialID }), 'wx');
      if (await readFile(pending, 'utf8').catch(() => '') !== initialReceipt) {
        await rm(temporary, { force: true });
        throw new Error('Native credential refresh ownership changed unexpectedly; inspect the CTG refresh receipt.');
      }
      await rename(temporary, pending);
    };
    const attempt = async () => {
      const rotated = await refresh(current?.type === 'oauth' ? current : credential);
      if (rotated?.type !== 'oauth' || !rotated.refresh || !rotated.access) throw new Error('Ship token refresh returned an invalid OAuth credential.');
      return rotated;
    };
    let rotated;
    for (let index = 0; ; index++) {
      try { rotated = await attempt(); break; }
      catch (error) {
        if (refreshRejected(error)) {
          // The server answered without rotating: nothing is uncertain, so a
          // later call (after /login, or once a rate limit clears) starts clean.
          if (await readFile(pending, 'utf8').catch(() => '') === initialReceipt) await rm(pending, { force: true });
          if (error.status === 401) throw new Error(`Carthagent Cloud sign-in expired or was revoked. ${reauthenticate}`, { cause: error });
          throw error;
        }
        const delay = retryDelays[index];
        if (delay === undefined || now() + delay - attemptedAt >= REFRESH_RETRY_WINDOW_MS) {
          await saveReceipt({ pid: process.pid, owner, from: digest, stage: 'failed', createdAt: Date.now(), attemptedAt });
          throw error;
        }
        await sleep(delay);
      }
    }
    await saveReceipt({
      pid: process.pid,
      owner,
      from: digest,
      to: credentialDigest(rotated),
      stage: 'complete',
      createdAt: Date.now(),
      attemptedAt,
    });
    return rotated;
  }, { timeout });
}

/** Remove refresh receipts that can never be consulted again: their source
 * token is no longer in the native vault (rotated away or signed out), or they
 * are past the refresh-token lifetime. Leftover temporary receipts are also
 * removed. Best effort; a recent receipt is always kept so an in-flight
 * handoff between hosts is never disturbed.
 * @param {{coordinationFile: string, vaultFile: string, now?: number, minAgeMs?: number}} options
 */
export async function pruneRefreshReceipts({ coordinationFile, vaultFile, now = Date.now(), minAgeMs = 10 * 60 * 1000 }) {
  if (!coordinationFile || !vaultFile || vaultFile === ':memory:') return 0;
  const prefix = `${basename(coordinationFile)}.ctg-refresh-`;
  const directory = dirname(resolve(coordinationFile));
  const entries = (await readdir(directory).catch(() => [])).filter(entry => entry.startsWith(prefix) && (entry.endsWith('.lock.pending') || entry.endsWith('.tmp')));
  if (!entries.length) return 0;
  let live;
  let db;
  try {
    db = typeof globalThis.Bun !== 'undefined'
      ? new (await import('bun:sqlite')).Database(vaultFile, { readonly: true })
      : new (await import('node:sqlite')).DatabaseSync(vaultFile, { readOnly: true });
    const query = "SELECT json_extract(value, '$.methodID') AS method, json_extract(value, '$.refresh') AS refresh FROM credential WHERE json_extract(value, '$.type') = 'oauth'";
    const rows = typeof db.prepare === 'function' ? db.prepare(query).all() : db.query(query).all();
    live = new Set(rows.filter(row => row.refresh).map(row => createHash('sha256').update(`${row.method || ''}\0${row.refresh}`).digest('hex').slice(0, 32)));
  } catch { live = undefined; } finally { try { db?.close(); } catch { /* already closed */ } }
  let removed = 0;
  for (const entry of entries) {
    const file = join(directory, entry);
    const details = await stat(file).catch(() => undefined);
    if (!details || now - details.mtimeMs < minAgeMs) continue;
    const digest = entry.slice(prefix.length, prefix.length + 32);
    const expired = now - details.mtimeMs > RECEIPT_MAX_AGE_MS;
    // Without a readable vault only the lifetime rule applies.
    const orphaned = entry.endsWith('.tmp') || (live !== undefined && !live.has(digest));
    if (!expired && !orphaned) continue;
    await rm(file, { force: true }).then(() => { removed++; }, () => {});
  }
  return removed;
}

/** Namespaced plugin-store keys avoid colliding with host/plugin settings. */
export function credentialStorageKey(integrationID) {
  const id = identity(integrationID);
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(id)) throw new TypeError('Invalid CTG integration id.');
  return `${CTG_CREDENTIAL_NAMESPACE}${id}`;
}

/**
 * Re-key credential vault rows stored under the pre-rename provider id onto the
 * current Carthagent Cloud integration id so existing sign-ins survive the
 * rename. Runs once at startup; a vault that already has a `carthagent-cloud`
 * row is left untouched. Failures are non-fatal — the read path falls back to
 * the legacy id, and a user can always reconnect.
 */
export async function migrateLegacyShipCredentialIds({ credentialFile } = {}) {
  if (!credentialFile || credentialFile === ':memory:') return 0;
  let db;
  try {
    db = typeof globalThis.Bun !== 'undefined'
      ? new (await import('bun:sqlite')).Database(credentialFile)
      : new (await import('node:sqlite')).DatabaseSync(credentialFile);
  } catch { return 0; }
  try {
    const existing = db.prepare('SELECT 1 FROM credential WHERE integration_id = ? LIMIT 1')
      .all(CARTHAGENT_SHIP_PROVIDER_ID);
    if (existing.length) return 0;
    let moved = 0;
    for (const legacyID of CARTHAGENT_SHIP_LEGACY_PROVIDER_IDS) {
      const result = db.prepare('UPDATE credential SET integration_id = ? WHERE integration_id = ?')
        .run(CARTHAGENT_SHIP_PROVIDER_ID, legacyID);
      moved += Number(result?.changes ?? 0);
    }
    return moved;
  } catch { return 0; }
  finally { db.close(); }
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
    const credential = parsed
      ? [providerID, ...CARTHAGENT_SHIP_LEGACY_PROVIDER_IDS].map(id => parsed[id]).find(Boolean)
      : undefined;
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
  return 'Existing Carthagent Cloud (formerly Ship) OAuth can be migrated from the legacy auth.json credential into Carthagent runtime integration storage; other provider credentials remain BYOK and may be reconnected through Carthagent runtime if their format is unsupported.';
}
