import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  fingerprint,
  checkDigest,
  validatePlan,
  planD2,
  bindRequiredChecks,
  pendingChecks,
  runCommand,
  createSerialQueue
} from './lib/delivery.mjs';
import { createReport, latestReport, saveReport } from './lib/reports.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const cwd = resolve(process.env.PI2_WORKSPACE || process.cwd());
const port = Number(process.env.PI2_PORT) || 3000;
const token = process.env.PI2_SERVER_TOKEN || randomBytes(24).toString('hex');
const app = express();
const enqueue = createSerialQueue();
// Include queued requests: their check definitions belong to the active plan.
let pendingRuns = 0;
let active = latestReport(cwd);
let currentState = active?.state || { version: 1, status: 'idle', plan: null, evidence: {}, review: '', launch: '', limitations: [] };

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-content-type-options', 'nosniff');
  if (req.path.startsWith('/api/')) res.setHeader('cache-control', 'no-store');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use('/api', (req, res, next) => {
  const supplied = req.get('x-pi2-token') || '';
  const expected = Buffer.from(token);
  const received = Buffer.from(supplied);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return res.status(401).json({ error: 'Unauthorized' });
  const origin = req.get('origin');
  if (origin && !new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]).has(origin)) return res.status(403).json({ error: 'Origin not allowed' });
  next();
});

function refresh() {
  if (pendingRuns) return;
  const found = latestReport(cwd);
  if (found && (!active || found.path !== active.path || found.mtimeMs > active.mtimeMs)) {
    active = found;
    currentState = found.state;
  }
}

function persist() {
  if (!active) active = createReport(cwd, currentState);
  else saveReport(active.path, currentState);
  active = { ...active, state: currentState, mtimeMs: Date.now() };
}

app.get('/api/status', (req, res) => {
  try {
    refresh();
    const currentFingerprint = fingerprint(cwd, ['.']);
    const pending = currentState.plan ? pendingChecks(currentState, currentFingerprint) : [];
    res.json({
      status: currentState.status,
      plan: currentState.plan,
      evidence: currentState.evidence || {},
      stepStatus: currentState.stepStatus || {},
      review: currentState.review || currentState.handoff?.review || '',
      launch: currentState.launch || currentState.handoff?.launch || '',
      limitations: currentState.limitations || currentState.handoff?.limitations || [],
      currentFingerprint,
      pendingChecks: pending,
      workspace: cwd,
      report: active?.path || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/plan/validate', (req, res) => {
  try {
    const plan = validatePlan(req.body.plan, cwd);
    res.json({ valid: true, plan, d2: planD2(plan) });
  } catch (error) {
    res.status(400).json({ valid: false, error: error.message });
  }
});

app.post('/api/plan/d2', (req, res) => {
  try { res.json({ d2: planD2(req.body.plan) }); }
  catch (error) { res.status(400).json({ error: error.message }); }
});

app.post('/api/plan/set', (req, res) => {
  if (pendingRuns) return res.status(409).json({ error: 'Checks are running or queued; wait before replacing the plan' });
  try {
    const plan = validatePlan(req.body.plan, cwd);
    currentState = {
      version: 1,
      runId: randomUUID(),
      revision: (currentState.revision || 0) + 1,
      status: 'implementing',
      plan,
      evidence: {},
      stepStatus: {},
      createdAt: new Date().toISOString()
    };
    active = createReport(cwd, currentState);
    currentState = active.state;
    res.json({ success: true, plan, d2: planD2(plan), report: active.path });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/plan/bind-required', (req, res) => {
  try {
    const plan = validatePlan(bindRequiredChecks(req.body.plan, req.body.required), cwd);
    res.json({ success: true, plan, d2: planD2(plan) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/checks/run', async (req, res) => {
  refresh();
  if (!currentState.plan?.checks?.length) return res.status(400).json({ error: 'No active plan' });
  const checks = req.body.id === 'all' ? currentState.plan.checks : currentState.plan.checks.filter(check => check.id === req.body.id);
  if (!checks.length) return res.status(404).json({ error: `Unknown check ID: ${req.body.id}` });
  pendingRuns++;
  try {
    const results = await enqueue(async () => {
      const runResults = [];
      const priorStatus = currentState.status;
      currentState.status = 'verifying';
      persist();
      for (const check of checks) {
        const before = fingerprint(cwd, ['.']);
        const result = await runCommand(check.argv, {
          cwd,
          timeoutSeconds: check.timeoutSeconds,
          logPath: join(active.dir, `${check.id}-${randomUUID()}.log`)
        });
        const after = fingerprint(cwd, ['.']);
        const evidence = {
          passed: result.code === 0 && !result.timedOut && !result.cancelled && !result.outputLimit && before === after,
          fingerprint: after,
          checkDigest: checkDigest(check),
          durationMs: result.durationMs,
          code: result.code,
          timedOut: result.timedOut,
          cancelled: result.cancelled,
          outputLimit: result.outputLimit,
          changedDuringCheck: before !== after,
          outputTail: result.output.slice(-1200),
          logPath: result.logPath,
          timestamp: new Date().toISOString()
        };
        currentState.evidence[check.id] = evidence;
        persist();
        runResults.push({ id: check.id, ...evidence, output: result.output });
      }
      const pending = pendingChecks(currentState, fingerprint(cwd, ['.']));
      currentState.status = priorStatus === 'verified' && !pending.length ? 'verified' : 'implementing';
      persist();
      return runResults;
    });
    const currentFingerprint = fingerprint(cwd, ['.']);
    res.json({ results, pendingChecks: pendingChecks(currentState, currentFingerprint), currentFingerprint });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    pendingRuns--;
  }
});

app.post('/api/finish', (req, res) => {
  if (pendingRuns) return res.status(409).json({ error: 'Checks are running or queued; wait before finishing' });
  try {
    refresh();
    const { status, review, launch, limitations } = req.body;
    if (!['verified', 'blocked'].includes(status)) return res.status(400).json({ error: 'Status must be verified or blocked' });
    if (!currentState.plan) return res.status(400).json({ error: 'No active plan' });
    if (status === 'verified') {
      const pending = pendingChecks(currentState, fingerprint(cwd, ['.']));
      if (pending.length) return res.status(400).json({ error: `Checks are pending, failed, or stale: ${pending.join(', ')}` });
    } else if (!Array.isArray(limitations) || !limitations.length) {
      return res.status(400).json({ error: 'Blocked status requires a reason' });
    }
    currentState.status = status;
    currentState.review = review || '';
    currentState.launch = launch || '';
    currentState.limitations = Array.isArray(limitations) ? limitations : [];
    currentState.handoff = { status, review: currentState.review, launch: currentState.launch, limitations: currentState.limitations, fingerprint: fingerprint(cwd, ['.']), at: new Date().toISOString() };
    persist();
    res.json({ success: true, state: currentState });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/docs/:name', (req, res) => {
  const paths = {
    readme: join(root, 'README.md'),
    evaluation: join(root, 'docs', 'evaluation.md'),
    delivery: join(root, 'prompts', 'delivery.md'),
    'game-development': join(root, 'skills', 'game-development', 'SKILL.md'),
    'software-delivery': join(root, 'skills', 'software-delivery', 'SKILL.md'),
    'typescript-delivery': join(root, 'skills', 'typescript-delivery', 'SKILL.md')
  };
  const path = paths[req.params.name];
  if (!path || !existsSync(path)) return res.status(404).json({ error: 'Document not found' });
  res.json({ content: readFileSync(path, 'utf8'), path });
});

app.use(express.static(join(root, 'public')));
app.use((req, res, next) => {
  if (req.method === 'GET') return res.sendFile(join(root, 'public', 'index.html'));
  next();
});

app.listen(port, '127.0.0.1', () => {
  console.log(`pi2 dashboard: http://127.0.0.1:${port}/?token=${token}`);
  console.log(`workspace: ${cwd}`);
});
