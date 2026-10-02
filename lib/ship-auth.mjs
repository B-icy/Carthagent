import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { CloudClient, cloudControlUrl, oauthCredentials } from './cloud/client.mjs';
import { CARTHAGENT_SHIP_PROVIDER_ID } from './providers/names.mjs';

// Refresh a little early so a token minted minutes ago does not expire
// mid-request; the engine applies its own refresh to managed dispatch anyway.
const REFRESH_SKEW_MS = 60_000;

export function shipAgentDir(env = process.env) {
  return env.CARTHAGENT_CODING_AGENT_DIR || env.PI_CODING_AGENT_DIR || join(os.homedir(), '.carthagent', 'agent');
}

export function readShipAuth({ agentDir = shipAgentDir(), providerId = CARTHAGENT_SHIP_PROVIDER_ID } = {}) {
  try {
    const auth = JSON.parse(readFileSync(join(agentDir, 'auth.json'), 'utf8'));
    return auth?.[providerId] ?? null;
  } catch { return null; }
}

/**
 * Resolve a usable Carthagent Ship access token from the engine credential
 * store (auth.json), refreshing through the control plane when the stored
 * access token is near expiry. Returns null when no Ship OAuth credential
 * exists. The refreshed credential is written back so the engine's own
 * dispatch sees it too.
 */
export async function resolveShipAccessToken({ agentDir = shipAgentDir(), providerId = CARTHAGENT_SHIP_PROVIDER_ID, env = process.env, fetchImpl = globalThis.fetch, now = Date.now, signal } = {}) {
  const authPath = join(agentDir, 'auth.json');
  let auth;
  try { auth = JSON.parse(readFileSync(authPath, 'utf8')); } catch { return null; }
  const credential = auth?.[providerId];
  if (credential?.type !== 'oauth' || typeof credential.access !== 'string' || typeof credential.refresh !== 'string') return null;
  if (Number(credential.expires) > now() + REFRESH_SKEW_MS) return credential.access;
  const client = new CloudClient({ baseUrl: cloudControlUrl(env), fetchImpl });
  const tokens = await client.refresh({ refreshToken: credential.refresh, signal });
  const next = oauthCredentials(tokens, now());
  auth[providerId] = { type: 'oauth', ...next };
  const temp = `${authPath}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(auth, null, 2));
  renameSync(temp, authPath);
  return next.access;
}
