/**
 * Carthagent Ship telemetry context — the metadata-only headers the control
 * plane uses for product analytics (threads, installs, run modes). No prompt
 * or response content is ever collected, and everything here is best-effort:
 * a missing or unreadable install id never blocks a request.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
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

/** Persistent anonymous install id: minted on first run, reused after. */
export function shipInstallId({ agentDir = shipAgentDir(), id = randomUUID } = {}) {
  const path = installIdPath(agentDir);
  try {
    const stored = String(readFileSync(path, 'utf8')).trim();
    if (UUID.test(stored)) return stored.toLowerCase();
  } catch { /* missing or corrupt — mint a fresh one below */ }
  const minted = String(id()).toLowerCase();
  try {
    mkdirSync(agentDir, { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, `${minted}\n`, { mode: 0o600 });
    renameSync(temp, path);
  } catch { /* the id still identifies this install for the process lifetime */ }
  return minted;
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
        if (providerId === CARTHAGENT_SHIP_PROVIDER_ID) ship = true;
        else byok = true;
      }
    }
  } catch { /* no stored oauth/api-key credentials */ }
  try {
    const providers = JSON.parse(readFileSync(join(agentDir, 'models.json'), 'utf8'))?.providers;
    if (providers && typeof providers === 'object' && !Array.isArray(providers)) {
      for (const providerId of Object.keys(providers)) {
        if (!hasCredential(providers[providerId])) continue;
        if (providerId === CARTHAGENT_SHIP_PROVIDER_ID) ship = true;
        else byok = true;
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
  sessionContext.threadId = UUID.test(String(sessionId || '')) ? String(sessionId).toLowerCase() : String(id()).toLowerCase();
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
