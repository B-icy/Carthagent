import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mostRecentSession } from '../../lib/engine.mjs';
import { latestReport } from '../../lib/reports.mjs';
const root = dirname(fileURLToPath(import.meta.url));
const phase = process.argv[2] || 'initial';
if (!['initial', 'followup'].includes(phase)) throw Error('Unknown phase');
const trial = process.env.CTG_TRIAL || '';
if (trial && !/^[a-z0-9-]+$/.test(trial)) throw Error('CTG_TRIAL must be a safe trial name');
const suffix = trial ? `-${trial}` : '';
const cwd = join(root, `workspace${suffix}`);
const out = join(root, 'runs', trial || '.', phase);
if (existsSync(out)) throw Error('Trial already exists; do not overwrite evidence');
mkdirSync(out, { recursive: true });
const prompt = readFileSync(join(root, phase === 'initial' ? 'task.md' : 'followup.md'), 'utf8');
const args = [resolve(root, '../../bin/ctg.mjs'), '-p', '--json', '--provider', 'lattice', '--model', 'gemini-3.8-flash-high', '--isolate', '--max-tools', '90', '--max-seconds', '900', '--max-repairs', '2', '--bash-cap', '30', '--validators', join(root, `validators${suffix}.json`)];
if (phase === 'followup') args.push('--continue');
args.push(prompt);
const started = Date.now();
writeFileSync(join(out, 'invocation.json'), JSON.stringify({ started: new Date(started).toISOString(), cwd, executable: process.execPath, args, hardDeadlineSeconds: 480 }, null, 2));
const child = spawn(process.execPath, args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
writeFileSync(join(out, 'pid'), String(child.pid));
for (const [stream, name] of [[child.stdout, 'stdout.log'], [child.stderr, 'stderr.log']]) stream.on('data', data => appendFileSync(join(out, name), data));
let last = '', killed = false;
function sample() {
  try {
    const report = latestReport(cwd);
    if (!report) return;
    const { state } = report;
    const item = { runId: state.runId, revision: state.revision, status: state.status, stepStatus: state.stepStatus, checks: Object.fromEntries(Object.entries(state.evidence || {}).map(([id, e]) => [id, { passed: e.passed, revision: e.revision, code: e.code }])), revisions: state.revisions?.map(r => ({ revision: r.revision, reason: r.reason })) };
    const now = JSON.stringify(item);
    if (now !== last) { appendFileSync(join(out, 'observations.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...item }) + '\n'); last = now; }
    writeFileSync(join(out, 'report-latest.json'), JSON.stringify(state, null, 2));
  } catch (error) { appendFileSync(join(out, 'monitor-errors.log'), error.message + '\n'); }
}
const timer = setInterval(sample, 2000);
const deadline = setTimeout(() => { killed = true; process.kill(-child.pid, 'SIGTERM'); setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 3000).unref(); }, 480000);
child.on('error', error => writeFileSync(join(out, 'launch-error.log'), error.stack));
child.on('exit', (code, signal) => {
  clearInterval(timer); clearTimeout(deadline); sample();
  const session = mostRecentSession(cwd);
  if (session) copyFileSync(session, join(out, 'session.jsonl'));
  writeFileSync(join(out, 'result.json'), JSON.stringify({ code, signal, killed, elapsedSeconds: (Date.now() - started) / 1000, session }, null, 2));
  console.log(`${phase}: exit=${code}, signal=${signal}, elapsed=${(Date.now() - started) / 1000}s`);
});
