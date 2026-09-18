import { mkdirSync, openSync, closeSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { atomicJson } from './delivery.mjs';

// Local cooperative orchestration, not protection against edits to .harness.
export function beginReview(cwd, identity, snapshot, head) {
  const dir = join(cwd, '.harness', 'reviews');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${createHash('sha256').update(identity).digest('hex')}.json`);
  const lock = `${path}.lock`;
  let fd;
  try { fd = openSync(lock, 'wx'); }
  catch (e) { if (e.code === 'EEXIST') throw Error('Review already running or interrupted; inspect the review lock before manual recovery'); throw e; }
  const release = () => { closeSync(fd); unlinkSync(lock); };
  try {
    let state;
    try { state = JSON.parse(readFileSync(path, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (state && (state.version !== 1 || state.identity !== identity || !Number.isInteger(state.rounds) || state.rounds < 1 || state.rounds > 3 || !Array.isArray(state.history) || !['running', 'approved', 'changes-requested', 'inconclusive', 'escalated'].includes(state.status))) throw Error('Invalid persisted review state');
    if (state?.status === 'running') throw Error('Interrupted review requires manual recovery; no automatic retry');
    if (state?.status === 'approved' && state.snapshot === snapshot && state.head === head) throw Error('Snapshot already approved; no reviewer launched');
    if ((state?.rounds || 0) >= 3) throw Error('Review round limit reached; escalate remaining findings to the user');
    state = { version: 1, identity, rounds: (state?.rounds || 0) + 1, status: 'running', snapshot, head, history: state?.history || [] };
    atomicJson(path, state);
    return {
      finish(status, details) {
        state.status = state.rounds === 3 && status !== 'approved' ? 'escalated' : status;
        state.history.push({ round: state.rounds, snapshot, head, status: state.status, details });
        atomicJson(path, state);
      },
      release,
    };
  } catch (e) { release(); throw e; }
}

export function parseFindings(output, snapshot, head, verdict) {
  const lines = String(output).trim().split(/\r?\n/);
  const line = lines.at(-2);
  if (!line?.startsWith('REVIEW_JSON: ')) throw Error('Missing structured REVIEW_JSON findings');
  let data;
  try { data = JSON.parse(line.slice(13)); } catch { throw Error('Invalid REVIEW_JSON'); }
  if (!data || data.version !== 1 || data.snapshot !== snapshot || data.head !== head || !Array.isArray(data.findings) || data.findings.length > 100) throw Error('Invalid or stale structured review identity');
  for (const f of data.findings) {
    if (!f || typeof f.file !== 'string' || !f.file.trim() || !Number.isInteger(f.line) || f.line < 1 || !['blocking', 'nonblocking'].includes(f.severity) || typeof f.issue !== 'string' || !f.issue.trim() || typeof f.fix !== 'string' || !f.fix.trim()) throw Error('Malformed structured finding');
  }
  if ((verdict === 'CHANGES-REQUESTED') !== data.findings.some(f => f.severity === 'blocking')) throw Error('Verdict contradicts structured findings');
  return data;
}
