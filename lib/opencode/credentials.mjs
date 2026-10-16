/** CTG-owned credential helpers. OpenCode's integration store remains the
 * authoritative store; this module only coordinates refresh and supports a
 * one-way migration read from Carthagent's legacy auth.json. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { shipAgentDir } from '../ship-auth.mjs';
import { CARTHAGENT_SHIP_PROVIDER_ID } from '../providers/names.mjs';

export const CTG_CREDENTIAL_NAMESPACE = 'ctg.credentials/';
const refreshFlights = new Map();

const identity = value => String(value || '').trim();

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
  return 'Existing Carthagent Ship OAuth can be migrated from the legacy auth.json credential into OpenCode integration storage; other provider credentials remain BYOK and may be reconnected through OpenCode if their format is unsupported.';
}
