/**
 * Carthagent Ship telemetry context — the metadata-only headers the control
 * plane uses for product analytics (threads, installs, run modes). No prompt
 * or response content is ever collected, and everything here is best-effort:
 * a missing or unreadable install id never blocks a request.
 */
import { closeSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { shipAgentDir } from './ship-auth.mjs';
import { CARTHAGENT_SHIP_PROVIDER_ID } from './providers/names.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUN_MODES = new Set(['interactive', 'print', 'rpc']);
// Same env keys the console treats as a usable BYOK credential.
const BYOK_ENV_KEYS = [
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY',
  'OPENROUTER_API_KEY', 'XAI_API_KEY', 'EXPLABS_API_KEY',
  'GROQ_API_KEY', 'MISTRAL_API_KEY', 'DEEPSEEK_API_KEY',
];

export function installIdPath(agentDir = shipAgentDir()) {
  return join(agentDir, 'install-id');
}

function publishInstallId(path, value) {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${value}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(temp, path);
  } finally {
    try { unlinkSync(temp); } catch { /* rename already consumed it */ }
  }
}

function deterministicRepairId(agentDir) {
  const hex = createHash('sha256').update(`${resolve(agentDir)}\0ship-install-id-repair`).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = 'a';
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

/** Persistent anonymous install id: minted on first run, reused after. */
export function shipInstallId({ agentDir = shipAgentDir(), id = randomUUID } = {}) {
  const path = installIdPath(agentDir);
  const seed = `${path}.seed`;
  let existing = '';
  try {
    const stored = String(readFileSync(path, 'utf8')).trim();
    if (UUID.test(stored)) existing = stored.toLowerCase();
  } catch { /* missing or corrupt — repair under a lock below */ }
  try {
    mkdirSync(agentDir, { recursive: true });
    // The immutable seed is authoritative. Backfill it from a valid legacy
    // primary before returning, so future primary-file repairs preserve ID.
    let identity = '';
    const seedPresent = existsSync(seed);
    try { identity = String(readFileSync(seed, 'utf8')).trim().toLowerCase(); } catch { /* seed absent */ }
    if (seedPresent && !UUID.test(identity)) {
      // A malformed seed cannot be safely replaced with a plain rename: a
      // concurrent publisher may already have installed a valid seed. A
      // short exclusive repair claim makes the check-and-replace one protocol
      // across processes. Contenders never wait; they use the valid primary
      // when available, otherwise the same deterministic fallback.
      const lock = `${seed}.repair-lock`;
      let lockFd;
      try { lockFd = openSync(lock, 'wx', 0o600); } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
      }
      if (lockFd === undefined) {
        try { identity = String(readFileSync(seed, 'utf8')).trim().toLowerCase(); } catch { /* owner may be repairing */ }
        return existing || (UUID.test(identity) ? identity : deterministicRepairId(agentDir));
      }
      try {
        try { identity = String(readFileSync(seed, 'utf8')).trim().toLowerCase(); } catch { identity = ''; }
        if (!UUID.test(identity)) {
          const candidate = existing || deterministicRepairId(agentDir);
          const tempSeed = `${seed}.${process.pid}.${randomUUID()}.tmp`;
          try {
            writeFileSync(tempSeed, `${candidate}\n`, { mode: 0o600, flag: 'wx' });
            // Only the lock owner may replace malformed content. Recheck so a
            // valid seed created by another implementation is never clobbered.
            let current = '';
            try { current = String(readFileSync(seed, 'utf8')).trim().toLowerCase(); } catch { /* seed disappeared */ }
            if (UUID.test(current)) identity = current;
            else {
              renameSync(tempSeed, seed);
              identity = candidate;
            }
          } finally {
            try { unlinkSync(tempSeed); } catch { /* rename already consumed it */ }
          }
        }
      } finally {
        closeSync(lockFd);
        try { unlinkSync(lock); } catch { /* best-effort lock cleanup */ }
      }
    } else if (!seedPresent && !UUID.test(identity)) {
      const candidate = existing || (identity ? deterministicRepairId(agentDir) : String(id()).toLowerCase());
      const value = UUID.test(candidate) ? candidate : deterministicRepairId(agentDir);
      const tempSeed = `${seed}.${process.pid}.${randomUUID()}.tmp`;
      try {
        writeFileSync(tempSeed, `${value}\n`, { mode: 0o600, flag: 'wx' });
        try { linkSync(tempSeed, seed); } catch (error) {
          if (error?.code !== 'EEXIST') throw error;
        }
      } finally {
        try { unlinkSync(tempSeed); } catch { /* link already removed or temp absent */ }
      }
      try { identity = String(readFileSync(seed, 'utf8')).trim().toLowerCase(); } catch { /* failed publication */ }
    }
    // If storage was malformed or unavailable, derive one stable fallback.
    const canonical = UUID.test(identity) ? identity : deterministicRepairId(agentDir);
    publishInstallId(path, canonical);
    return canonical;
  } catch {
    return existing || deterministicRepairId(agentDir); // storage remains best-effort
  }
}

const hasCredential = credential => {
  if (typeof credential === 'string') return Boolean(credential.trim());
  if (!credential || typeof credential !== 'object') return false;
  return ['key', 'apiKey', 'api_key', 'access', 'refresh'].some(field => typeof credential[field] === 'string' && credential[field].trim());
};

/** 'ship' | 'byok' | 'ship+byok' | 'none' from the local credential store. */
export function providerMode({ agentDir = shipAgentDir(), env = process.env } = {}) {
  let ship = false;
  let byok = BYOK_ENV_KEYS.some(key => env?.[key]?.trim());
  try {
    const stored = JSON.parse(readFileSync(join(agentDir, 'auth.json'), 'utf8'));
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      for (const [providerId, credential] of Object.entries(stored)) {
        if (!hasCredential(credential)) continue;
        // Only the OAuth credential is a Ship account; a direct api_key under
        // this provider id goes through the BYOK gateway.
        if (providerId === CARTHAGENT_SHIP_PROVIDER_ID && credential?.type === 'oauth') ship = true;
        else byok = true;
      }
    }
  } catch { /* no stored oauth/api-key credentials */ }
  try {
    const providers = JSON.parse(readFileSync(join(agentDir, 'models.json'), 'utf8'))?.providers;
    if (providers && typeof providers === 'object' && !Array.isArray(providers)) {
      // Any credentialed models.json provider is a direct (BYOK) credential —
      // Ship OAuth lives in auth.json only.
      for (const providerId of Object.keys(providers)) {
        if (hasCredential(providers[providerId])) byok = true;
      }
    }
  } catch { /* no persisted model-store credentials */ }
  return ship && byok ? 'ship+byok' : ship ? 'ship' : byok ? 'byok' : 'none';
}

/** Headers for the daily release check — doubles as the install ping. */
export function installPingHeaders({ env = process.env, agentDir = shipAgentDir(env), version = null } = {}) {
  return {
    'x-carthagent-install-id': shipInstallId({ agentDir }),
    'x-carthagent-version': version || '',
    'x-carthagent-os': process.platform,
    'x-carthagent-arch': process.arch,
    'x-carthagent-node': process.versions.node,
    'x-carthagent-provider-mode': providerMode({ agentDir, env }),
  };
}

// Per-process Ship request context. The console sets CARTHAGENT_RUN_MODE when
// it spawns the engine; the extension fills the session fields on lifecycle
// events, and every managed request is stamped with the current values.
const sessionContext = { threadId: null, turn: 0, installId: null };

/** Adopt the engine's session id as the Ship thread id (minted if absent). */
export function noteEngineSession(sessionId, { id = randomUUID } = {}) {
  const next = UUID.test(String(sessionId || '')) ? String(sessionId).toLowerCase() : String(id()).toLowerCase();
  // A session_start for the same id (extension reload) keeps the turn count.
  if (sessionContext.threadId === next) return;
  sessionContext.threadId = next;
  sessionContext.turn = 0;
}

/** Each user turn starts a new engine run — advance the turn counter. */
export function noteAgentTurn() {
  sessionContext.turn += 1;
}

/** Headers stamped on every managed Ship gateway request. */
export function shipRequestHeaders({ env = process.env, agentDir = shipAgentDir(env), version = null } = {}) {
  if (!sessionContext.threadId) noteEngineSession(null);
  sessionContext.installId ??= shipInstallId({ agentDir });
  const headers = {
    'x-carthagent-thread-id': sessionContext.threadId,
    'x-carthagent-turn': String(sessionContext.turn),
    'x-carthagent-install-id': sessionContext.installId,
    'x-carthagent-version': version || '',
    'x-carthagent-os': process.platform,
  };
  const runMode = String(env.CARTHAGENT_RUN_MODE || '').trim();
  if (RUN_MODES.has(runMode)) headers['x-carthagent-run-mode'] = runMode;
  return headers;
}

/** Test hook: clear the per-process context. */
export function resetShipContext() {
  sessionContext.threadId = null;
  sessionContext.turn = 0;
  sessionContext.installId = null;
}
