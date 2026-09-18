import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, mkdirSync, writeFileSync, renameSync, openSync, writeSync, closeSync } from 'node:fs';
import { resolve, relative, isAbsolute, join, dirname, basename } from 'node:path';
import { spawn } from 'node:child_process';

// Generic dependency/cache/output directories excluded from the source fingerprint.
// Scenarios or projects can add more via the manifest; these are the common defaults.
const OMIT = new Set(['.git', '.venv', 'venv', 'node_modules', '__pycache__', '.harness', 'artifacts', 'saves', '.tools', '.pytest_cache', '.ruff_cache', 'dist', 'build', '.next', '.nuxt', '.cache', 'coverage', '.turbo', 'target', '.pi', '.pi2', '.yarn', '.pnpm-store', '.output', '.svelte-kit', '.docusaurus']);
const DEFAULT_MAX_FILES = 25000;
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

export function maxEvidenceFiles() {
  const envVal = process.env.PI2_MAX_FILES || process.env.PI_MAX_FILES;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_MAX_FILES;
}

export function maxEvidenceBytes() {
  const envVal = process.env.PI2_MAX_BYTES || process.env.PI_MAX_BYTES;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_MAX_BYTES;
}

export const VERIFICATION_MODES = ['required', 'advisory', 'none'];
export const DEFAULT_VERIFICATION = 'required';

/** Normalize a plan's verification classification. Unknown/missing -> 'required'. */
export function verificationMode(plan) {
  const mode = plan?.verification ?? DEFAULT_VERIFICATION;
  return VERIFICATION_MODES.includes(mode) ? mode : DEFAULT_VERIFICATION;
}

/**
 * Cheap, pure read of the user's request text: does it read as a question or a
 * read-only/explain ask rather than a build/fix task? Mirrors the framing gate
 * in lib/tui/framing.mjs so the extension can hint at the right classification.
 */
export function looksInformational(text) {
  const v = String(text ?? '').trim();
  if (!v) return false;
  if (v.startsWith('/') || v.startsWith('!')) return false;
  if (v.endsWith('?') && v.length < 300) return true;
  return /^(what|why|how|explain|show|list|describe|review|where|is|are|does|do|can)\b/i.test(v) &&
    v.length < 300 && !/\b(build|create|implement|write|add|fix|make|generate)\b/i.test(v);
}

export function localPath(cwd, path) {
  if (typeof path !== 'string' || !path.trim()) throw Error('A nonempty relative path is required');
  const full = resolve(cwd, path.replace(/^@/, ''));
  const rel = relative(resolve(cwd), full);
  if (rel.startsWith('..' + '/') || rel.startsWith('..' + '\\') || rel === '..' || isAbsolute(rel)) throw Error('Path escapes working directory');
  let cursor = resolve(cwd);
  for (const part of rel.split(/[\\/]/).filter(Boolean)) {
    cursor = join(cursor, part);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw Error(`Symlink not supported: ${cursor}`);
  }
  return full;
}

export function fingerprint(cwd, roots) {
  const files = new Set();
  let bytes = 0;
  const hash = createHash('sha256');
  const maxFiles = maxEvidenceFiles();
  const maxBytes = maxEvidenceBytes();
  function visit(path) {
    if (OMIT.has(basename(path)) || /\.(pyc|pyo|class|o|obj|exe|dll|so|dylib|jar|wasm)$/.test(path)) return;
    if (!existsSync(path)) { hash.update(`missing:${relative(cwd, path)}\0`); return; }
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw Error(`Symlink not supported in evidence scope: ${path}`);
    if (stat.isDirectory()) {
      hash.update(`directory:${relative(cwd, path)}\0`);
      for (const name of readdirSync(path).sort()) visit(join(path, name));
    } else if (stat.isFile()) {
      files.add(path);
      if (files.size > maxFiles) throw Error(`Evidence scope exceeds ${maxFiles} files; use a narrower project cwd or move generated/dependency files to excluded directories`);
    }
  }
  for (const root of [...roots].sort()) visit(localPath(cwd, root));
  for (const file of [...files].sort()) {
    bytes += lstatSync(file).size;
    if (bytes > maxBytes) throw Error(`Evidence scope exceeds ${Math.round(maxBytes / (1024 * 1024))} MiB; use a narrower project cwd or move generated/dependency files to excluded directories`);
    hash.update(relative(cwd, file)).update('\0').update(readFileSync(file)).update('\0');
  }
  return hash.digest('hex');
}

export function validatePlan(plan, cwd) {
  if (!plan.goal?.trim()) throw Error('Goal is required');
  if (!plan.artifacts?.length) throw Error('Declare source, test, configuration and documentation artifact roots');
  plan.artifacts.forEach(p => {
    const full = localPath(cwd, p);
    const parts = relative(resolve(cwd), full).split(/[\\/]/);
    if (parts.some(part => OMIT.has(part))) throw Error('Artifact roots must be product source/tests/config/docs, not ignored output or dependency directories. Use ["."] for the project.');
  });
  if (plan.outputs != null) {
    if (!Array.isArray(plan.outputs)) throw Error('outputs must be an array of relative file paths');
    // Outputs are produced evidence (screenshots, reports, fixtures) and may
    // live under ignored dirs such as artifacts/ — localPath still blocks escapes.
    plan.outputs.forEach(p => localPath(cwd, p));
  }
  if (!plan.steps?.length || plan.steps.length > 12) throw Error('Use 1–12 implementation steps');
  const verification = plan.verification ?? DEFAULT_VERIFICATION;
  if (!VERIFICATION_MODES.includes(verification)) throw Error(`verification must be one of ${VERIFICATION_MODES.join(', ')} (default required)`);
  const checks = plan.checks ?? [];
  const acceptance = plan.acceptance ?? [];
  if (!Array.isArray(checks) || !Array.isArray(acceptance)) throw Error('checks and acceptance must be arrays');
  if (verification === 'required' && (!checks.length || !acceptance.length)) throw Error('Acceptance criteria and executable checks are required');
  if (verification === 'none' && (checks.length || acceptance.length)) throw Error('verification:"none" is a pure informational ask and cannot declare checks or acceptance criteria; use "advisory" for optional evidence');
  if (verification !== 'none' && (checks.length > 0) !== (acceptance.length > 0)) throw Error('Acceptance criteria and checks must be declared together');
  const ids = new Set();
  for (const check of checks) {
    if (check.id === 'all' || !/^[a-z][a-z0-9_-]{0,39}$/.test(check.id) || ids.has(check.id)) throw Error('Check IDs must be unique safe identifiers');
    ids.add(check.id);
    if (!check.argv?.length || check.argv.some(s => typeof s !== 'string' || !s.length)) throw Error('Check argv must contain an executable and separate arguments');
    if (!['test', 'runtime', 'static'].includes(check.kind)) throw Error('Check kind must be test, runtime or static');
    if (!Number.isInteger(check.timeoutSeconds) || check.timeoutSeconds < 1 || check.timeoutSeconds > 300) throw Error('Check timeout must be 1–300 seconds');
  }
  if (verification === 'required' && !checks.some(c => c.kind !== 'static')) throw Error('Syntax checks alone are insufficient: add a test or runtime check');
  for (const item of acceptance) {
    if (!item.requirement?.trim() || !item.checks?.length || item.checks.some(id => !ids.has(id))) throw Error(`Every acceptance criterion must reference existing check IDs. Available: ${[...ids].join(', ')}. Multiple criteria can share a test suite.`);
  }
  return structuredClone(plan);
}

/**
 * Update the status of a plan step. Returns the updated state.
 * status: 'active' | 'done' | 'failed' | 'pending'
 * Validates that the step index exists in the plan.
 */
export function updateStepStatus(state, stepIndex, status) {
  if (!state?.plan?.steps) throw Error('No delivery plan');
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= state.plan.steps.length) {
    throw Error(`Invalid step index ${stepIndex}; plan has ${state.plan.steps.length} steps (0–${state.plan.steps.length - 1})`);
  }
  if (!['active', 'done', 'failed', 'pending'].includes(status)) throw Error('status must be active, done, failed, or pending');
  if (!state.stepStatus) state.stepStatus = {};
  state.stepStatus[`step${stepIndex}`] = status;
  return state;
}

/**
 * Regenerate plan.d2 source with current step statuses reflected in labels.
 * Annotates each step label with [active]/[done]/[failed]/[pending] markers.
 */
export function planD2WithProgress(plan, stepStatus = {}) {
  const lines = ['direction: down', `goal: ${JSON.stringify(plan.goal)}`];
  plan.steps.forEach((s, i) => {
    const st = stepStatus[`step${i}`] || 'pending';
    const marker = st === 'done' ? ' ✓' : st === 'failed' ? ' ✗' : st === 'active' ? ' ▶' : '';
    lines.push(`step${i}: ${JSON.stringify(s + marker)}`);
    lines.push(`${i ? 'step' + (i - 1) : 'goal'} -> step${i}`);
  });
  lines.push('verify: "Verify checks"', `step${plan.steps.length - 1} -> verify`, 'review: "Review + limits"', 'verify -> review', 'repair: "Repair failures"', 'verify -> repair: failure', 'repair -> verify', 'deliver: "Deliver handoff"', 'review -> deliver');
  return lines.join('\n') + '\n';
}

export function bindRequiredChecks(plan, required) {
  const bound = structuredClone(plan);
  const ids = new Set(required.map(check => check.id));
  // User-owned validators are non-negotiable: force strict verification so a
  // plan cannot declare 'advisory'/'none' to route around them.
  if (required.length) bound.verification = 'required';
  bound.checks = [...(bound.checks || []).filter(check => !ids.has(check.id)), ...structuredClone(required)];
  bound.acceptance = (bound.acceptance || []).filter(item => !item.requirement.startsWith('[Harness required] '));
  for (const check of required) bound.acceptance.push({ requirement: `[Harness required] ${check.id}`, checks: [check.id] });
  return bound;
}

export function loadRequiredChecks(path, cwd) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (data.version !== 1 || !Array.isArray(data.checks) || !data.checks.length || data.checks.length > 12) throw Error('Validator manifest requires version:1 and 1–12 checks');
  if (data.checks.some(check => typeof check.id !== 'string' || check.id.length > 31)) throw Error('Required validator IDs must be at most 31 characters (room for required_ prefix)');
  // Validate using the same command schema as model-declared checks.
  validatePlan({ goal: 'Required verification', artifacts: ['.'], steps: ['Verify'], acceptance: [{ requirement: 'External checks', checks: data.checks.map(c => c.id) }], checks: data.checks }, cwd);
  return data.checks.map(check => ({ ...check, id: `required_${check.id}` }));
}

export function validateRevision(previous, next) {
  if (!previous || ['verified', 'blocked'].includes(previous.status)) return;
  const before = verificationMode(previous.plan);
  const after = verificationMode(next);
  const hasEvidence = Object.keys(previous.evidence || {}).length > 0;
  // Pre-verify re-check: an ask can be reclassified from delivery to
  // informational/advisory only before any check has run. Once real evidence
  // exists, downgrading would let a failing contract escape its checks.
  if (before === 'required' && after !== 'required') {
    if (hasEvidence) throw Error('Cannot downgrade verification after checks have run. Keep the requirement, or report status=blocked with the failing evidence.');
    return;
  }
  const requirements = new Set((next.acceptance || []).map(item => item.requirement));
  const dropped = (previous.plan.acceptance || []).filter(item => !requirements.has(item.requirement));
  if (dropped.length) throw Error('Replanning cannot silently remove acceptance criteria. Retain the original requirement text and adjust check commands, or report the task blocked.');
}

export function planD2(plan) {
  const lines = ['direction: down', `goal: ${JSON.stringify(plan.goal)}`];
  plan.steps.forEach((s, i) => {
    lines.push(`step${i}: ${JSON.stringify(s)}`);
    lines.push(`${i ? 'step' + (i - 1) : 'goal'} -> step${i}`);
  });
  lines.push('verify: "Verify checks"', `step${plan.steps.length - 1} -> verify`, 'review: "Review + limits"', 'verify -> review', 'repair: "Repair failures"', 'verify -> repair: failure', 'repair -> verify', 'deliver: "Deliver handoff"', 'review -> deliver');
  return lines.join('\n') + '\n';
}

export function atomicJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(data, null, 2) + '\n');
  renameSync(temp, path);
}

export function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => child.kill());
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }
}

// No implicit shell. Use ["bash", "-lc", "..."] explicitly when a shell is necessary.
export async function runCommand(argv, { cwd, timeoutSeconds = 60, signal, logPath, onOutput } = {}) {
  if (signal?.aborted) return { code: null, cancelled: true, timedOut: false, output: 'Cancelled before launch', durationMs: 0 };
  let fd = null;
  if (logPath) {
    mkdirSync(dirname(logPath), { recursive: true });
    fd = openSync(logPath, 'w');
  }
  const started = Date.now();
  return new Promise(resolveResult => {
    let tail = '', written = 0, timedOut = false, cancelled = false, outputLimit = false;
    const child = spawn(argv[0], argv.slice(1), { cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const stop = () => killTree(child);
    const abort = () => { cancelled = true; stop(); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutSeconds * 1000);
    signal?.addEventListener('abort', abort, { once: true });
    function consume(chunk) {
      const text = chunk.toString();
      tail = (tail + text).slice(-12000);
      onOutput?.(text);
      if (written + chunk.length <= 8 * 1024 * 1024) { if (fd !== null) writeSync(fd, chunk); written += chunk.length; }
      else if (!outputLimit) { outputLimit = true; if (fd !== null) writeSync(fd, '\n[8 MiB output limit exceeded; terminated]\n'); stop(); }
    }
    child.stdout.on('data', consume);
    child.stderr.on('data', consume);
    child.on('error', e => consume(Buffer.from(String(e))));
    child.on('close', code => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (fd !== null) closeSync(fd);
      resolveResult({ code, timedOut, cancelled, outputLimit, output: tail, logPath, durationMs: Date.now() - started });
    });
    if (signal?.aborted) abort();
  });
}

// Tools in the same assistant message execute concurrently in Pi. Queue delivery
// operations rather than burning model turns rejecting sibling checks.
export function createSerialQueue() {
  let tail = Promise.resolve();
  return function enqueue(job) {
    const result = tail.then(job);
    tail = result.catch(() => {});
    return result;
  };
}

// Explicit field order makes identity independent of object property order.
export function checkDigest(check) {
  return createHash('sha256').update(JSON.stringify([
    check.id, check.kind, check.argv, check.timeoutSeconds
  ])).digest('hex');
}

export function evidenceIdentity(state, check) {
  return { runId: state.runId, revision: state.revision, checkDigest: checkDigest(check) };
}

export function evidenceFresh(check, evidence, hash, state) {
  return Boolean(state?.runId && Number.isInteger(state.revision) && state.revision > 0 &&
    evidence?.runId === state.runId && evidence.revision === state.revision &&
    evidence.passed && evidence.fingerprint === hash &&
    evidence.checkDigest === checkDigest(check));
}

export function pendingChecks(state, hash) {
  return state.plan.checks.filter(c => !evidenceFresh(c, state.evidence?.[c.id], hash, state)).map(c => c.id);
}

/**
 * Per-acceptance-criterion evidence coverage.
 * `fresh` counts checks that pass on the current workspace hash; `staticOnly`
 * flags a criterion whose only fresh evidence is kind:"static" (syntax/import
 * probes). The plan's self-declared `kind` is not proof of strength, so this is
 * a signal for the rail and the handoff — not a hard gate.
 */
export function coverageReport(plan, evidence = {}, hash = '', state = null) {
  const byId = new Map((plan?.checks || []).map(c => [c.id, c]));
  return (plan?.acceptance || []).map(item => {
    let fresh = 0, failing = 0, missing = 0, stale = 0;
    const freshKinds = new Set();
    for (const id of item.checks || []) {
      const c = byId.get(id);
      const e = evidence[id];
      if (!e) { missing++; continue; }
      if (!e.passed) { failing++; continue; }
      if (!c || !evidenceFresh(c, e, hash, state)) { stale++; continue; }
      fresh++;
      if (c) freshKinds.add(c.kind);
    }
    const kinds = [...freshKinds];
    return {
      requirement: item.requirement,
      checks: item.checks || [],
      fresh, failing, missing, stale,
      covered: fresh > 0,
      staticOnly: fresh > 0 && kinds.every(k => k === 'static'),
    };
  });
}

/** Fresh (current-hash, passing) check count for the rail header. */
export function freshChecks(state, hash) {
  if (!state?.plan?.checks?.length) return { fresh: 0, total: 0 };
  let fresh = 0;
  for (const c of state.plan.checks) {
    const e = state.evidence?.[c.id];
    if (evidenceFresh(c, e, hash, state)) fresh++;
  }
  return { fresh, total: state.plan.checks.length };
}

export const PHASES = ['inspect', 'plan', 'build', 'verify', 'review', 'deliver'];

/**
 * Derive the current delivery phase for the rail tracker.
 * Pure: { delivery, hash, checkRunning } -> { phase, index, revision }.
 * - no plan yet        -> inspect (index 0)
 * - verified / blocked -> deliver (index 5)
 * - check running or status=verifying -> verify (index 3)
 * - all checks fresh   -> review (index 4)
 * - pending/failed/stale checks or active/failed step -> build (index 2)
 * - plan exists, no progress yet     -> plan (index 1)
 */
export function computePhase(delivery, hash, checkRunning = false) {
  const revision = delivery?.revision || 1;
  if (!delivery?.plan) return { phase: 'inspect', index: 0, revision };
  const status = delivery.status;
  if (status === 'verified' || status === 'blocked') return { phase: 'deliver', index: 5, revision };
  if (checkRunning || status === 'verifying') return { phase: 'verify', index: 3, revision };
  const pending = pendingChecks(delivery, hash);
  const { fresh, total } = freshChecks(delivery, hash);
  if (total > 0 && pending.length === 0 && fresh === total) return { phase: 'review', index: 4, revision };
  // Informational/advisory plans have nothing to verify: never park in build
  // waiting for checks that are intentionally absent.
  if (verificationMode(delivery.plan) !== 'required' && pending.length === 0) return { phase: 'review', index: 4, revision };
  const stepStatus = delivery.stepStatus || {};
  const stepped = Object.values(stepStatus).some(s => ['active', 'done', 'failed'].includes(s));
  const hasEvidence = Object.keys(delivery.evidence || {}).length > 0;
  // Fresh plan, nothing attempted yet -> still planning, not building.
  if (pending.length && (hasEvidence || stepped)) return { phase: 'build', index: 2, revision };
  if (pending.length) return { phase: 'plan', index: 1, revision };
  if (stepped) return { phase: 'build', index: 2, revision };
  return { phase: 'plan', index: 1, revision };
}

export function restoreState(entries) {
  let state = null;
  for (const entry of entries) {
    if (entry.type === 'custom' && entry.customType === 'delivery-state-v1') state = structuredClone(entry.data);
  }
  return state;
}

export function shouldContinue({ state, touched, nudges, stopReason, pendingMessages, fresh }) {
  // Informational/advisory plans are terminal once the agent stops: there is no
  // verification contract to repair, so never nudge them into the repair loop.
  if (state && verificationMode(state.plan) !== 'required') return false;
  return nudges < 2 && !pendingMessages && stopReason === 'stop' &&
    (state ? state.status !== 'blocked' && (state.status !== 'verified' || !fresh) : touched);
}

// Live-trial budget policy: provider/connection failures produce no product work
// and must not consume the productive model-turn budget; wall-clock still bounds the run.
export function turnBudgetExceeded({ turns, providerErrors, maxTurns }) {
  if (![turns, providerErrors, maxTurns].every(Number.isInteger) || providerErrors < 0 || maxTurns < 0) throw Error('turns, providerErrors and maxTurns must be nonnegative integers');
  return turns - providerErrors > maxTurns;
}
