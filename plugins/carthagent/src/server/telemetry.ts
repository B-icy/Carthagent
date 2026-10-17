import { createHash, randomUUID } from 'node:crypto';
import type { Credential } from '@opencode/schema/credential';
import { packageVersion } from '../../../../lib/update.mjs';
import { shipInstallId } from '../../../../lib/ship-telemetry.mjs';

const RUN_MODES = new Set(['interactive', 'print', 'rpc']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** OpenCode session IDs are opaque strings, not necessarily UUIDs. Use a
 * process-secret keyed digest to derive stable UUID-shaped CTG thread IDs
 * without leaking session identifiers to the gateway. */
export function createSessionIdentity({ id = randomUUID, secret = randomUUID() } = {}) {
  const threads = new Map<string, string>();
  const requests = new Map<string, number>();
  return {
    thread(sessionID: string) {
      const key = String(sessionID || '');
      if (!key) return id();
      let value = threads.get(key);
      if (!value) {
        const digest = createHash('sha256').update(`${secret}\0${key}`).digest('hex').slice(0, 32);
        value = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
        threads.set(key, value);
      }
      return value;
    },
    request(sessionID: string, kind: string) {
      const key = String(sessionID || '');
      const next = (requests.get(key) || 0) + 1;
      requests.set(key, next);
      return createHash('sha256').update(`${secret}\0${key}\0${kind}\0${next}`).digest('hex');
    },
    turn(sessionID: string) { return requests.get(String(sessionID || '')) || 0; },
    forget(sessionID: string) {
      const key = String(sessionID || '');
      threads.delete(key);
      requests.delete(key);
    },
  };
}

/** Stable fallback request key derived from session, kind, and serialized
 * request. Native managed calls use the lifecycle-scoped identity below. */
export function managedRequestIdentity({ sessionID, kind, body, secret = '' }: {
  sessionID: string; kind: string; body: string; secret?: string;
}) {
  return createHash('sha256').update(`${secret}\0${sessionID}\0${kind}\0${body}`).digest('hex');
}

export function shipTelemetryHeaders({
  sessionID,
  kind,
  body,
  env = process.env,
  agentDir,
  identity = createSessionIdentity(),
  requestSecret = 'carthagent-opencode-request-v1',
  requestID,
  turn,
  version = packageVersion(),
}: {
  sessionID: string; kind: string; body: string; env?: NodeJS.ProcessEnv;
  agentDir?: string; identity?: ReturnType<typeof createSessionIdentity>;
  requestSecret?: string; version?: string;
  requestID?: string;
  turn?: number;
}) {
  const headers: Record<string, string> = {
    'x-carthagent-install-id': shipInstallId({ agentDir }),
    'x-carthagent-version': version || '',
    'x-carthagent-os': process.platform,
  };
  const generatedRequestID = requestID || identity.request(sessionID, kind);
  headers['x-carthagent-thread-id'] = UUID.test(String(sessionID))
    ? String(sessionID).toLowerCase() : identity.thread(sessionID);
  headers['x-carthagent-turn'] = String(Math.max(0, Math.trunc(turn ?? identity.turn(sessionID))));
  const runMode = String(env.CARTHAGENT_RUN_MODE || '').trim();
  if (RUN_MODES.has(runMode)) headers['x-carthagent-run-mode'] = runMode;
  headers['x-carthagent-request-id'] = requestID || generatedRequestID || managedRequestIdentity({ sessionID, kind, body, secret: requestSecret });
  return headers;
}

export function isManagedShipCredential(credential: Credential.Value | undefined) {
  if (credential?.type !== 'oauth' || typeof credential.access !== 'string') return false;
  const parts = credential.access.split('.');
  if (parts.length !== 3) return false;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof claims.sub === 'string' && typeof claims.sid === 'string'
      && String(claims.scope || '').split(' ').includes('gateway:invoke');
  } catch { return false; }
}
