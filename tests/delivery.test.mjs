import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDigest, fingerprint, validatePlan, planD2, pendingChecks, restoreState, runCommand, shouldContinue, localPath, createSerialQueue, validateRevision, turnBudgetExceeded, maxEvidenceFiles, maxEvidenceBytes, bindRequiredChecks, verificationMode, looksInformational, computePhase } from '../lib/delivery.mjs';
import { createReport, latestReport, saveReport } from '../lib/reports.mjs';

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'pi delivery spaces '));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFileSync(join(cwd, 'app.py'), 'print(1)');
  return cwd;
}
function plan() { return { goal: 'Working app', assumptions: [], artifacts: ['app.py'], steps: ['Launch', 'Implement and test'], acceptance: [{ requirement: 'Runs', checks: ['smoke'] }], checks: [{ id: 'smoke', kind: 'runtime', argv: [process.execPath, '-e', 'console.log("ok")'], timeoutSeconds: 2 }] }; }

test('contract validates mapping, IDs, deadlines and meaningful checks', t => {
  const cwd = fixture(t);
  assert.deepEqual(validatePlan(plan(), cwd), plan());
  for (const mutate of [p => p.acceptance[0].checks.push('missing'), p => p.checks.push(p.checks[0]), p => p.checks[0].timeoutSeconds = 0, p => p.checks[0].kind = 'static', p => p.artifacts = ['../outside']]) {
    const p = plan(); mutate(p); assert.throws(() => validatePlan(p, cwd));
  }
});
test('D2 escapes arbitrary labels and records repair loop', () => {
  const p = plan(); p.steps[0] = 'Quoted "value"\nand newline';
  const d2 = planD2(p);
  assert.ok(d2.includes('\\"value\\"\\nand newline')); assert.ok(d2.includes('repair -> verify'));
});
test('fingerprints detect edits, additions and deletion; ignore generated evidence', t => {
  const cwd = fixture(t), initial = fingerprint(cwd, ['.']);
  mkdirSync(join(cwd, 'artifacts')); writeFileSync(join(cwd, 'artifacts', 'frame.png'), 'frame');
  assert.equal(fingerprint(cwd, ['.']), initial);
  writeFileSync(join(cwd, 'test.py'), 'assert True');
  assert.notEqual(fingerprint(cwd, ['.']), initial);
  rmSync(join(cwd, 'test.py')); assert.equal(fingerprint(cwd, ['.']), initial);
  writeFileSync(join(cwd, 'app.py'), 'print(2)'); assert.notEqual(fingerprint(cwd, ['.']), initial);
});
test('evidence cannot pass on missing, failed or stale checks', () => {
  const state = { runId: 'run-a', revision: 1, plan: plan(), evidence: {} };
  assert.deepEqual(pendingChecks(state, 'new'), ['smoke']);
  state.evidence.smoke = { passed: true, fingerprint: 'old' };
  assert.deepEqual(pendingChecks(state, 'new'), ['smoke']);
  state.evidence.smoke.fingerprint = 'new';
  assert.deepEqual(pendingChecks(state, 'new'), ['smoke'], 'legacy evidence must rerun');
  state.evidence.smoke.checkDigest = checkDigest(state.plan.checks[0]);
  assert.deepEqual(pendingChecks(state, 'new'), ['smoke']);
  Object.assign(state.evidence.smoke, { runId: state.runId, revision: state.revision });
  assert.deepEqual(pendingChecks(state, 'new'), []);
  assert.deepEqual(pendingChecks({ ...state, runId: 'run-b' }, 'new'), ['smoke']);
  assert.deepEqual(pendingChecks({ ...state, revision: 2 }, 'new'), ['smoke']);
  const restored = restoreState([{ type: 'custom', customType: 'delivery-state-v1', data: state }]);
  assert.deepEqual(pendingChecks(restored, 'new'), []);
  restored.revision++;
  assert.deepEqual(pendingChecks(restored, 'new'), ['smoke']);
  assert.deepEqual(pendingChecks(state, 'new'), [], 'restoration must not mutate original identity');
  const original = structuredClone(state.plan.checks[0]);
  for (const change of [{ argv: ['node', '-e', 'throw 1'] }, { timeoutSeconds: 99 }, { kind: 'static' }]) {
    state.plan.checks[0] = { ...original, ...change };
    assert.deepEqual(pendingChecks(state, 'new'), ['smoke']);
  }
  state.plan.checks[0] = original;
  state.evidence.smoke.passed = false; assert.deepEqual(pendingChecks(state, 'new'), ['smoke']);
});
test('branch restoration only uses provided active-branch entries and clones state', () => {
  const entry = { type: 'custom', customType: 'delivery-state-v1', data: { status: 'implementing' } };
  assert.equal(restoreState([]), null);
  const restored = restoreState([entry, { type: 'message' }]);
  restored.status = 'verified'; assert.equal(entry.data.status, 'implementing');
});
test('follow-ups are bounded and respect abort, errors, blocking and user queues', () => {
  const args = { state: null, touched: true, nudges: 0, stopReason: 'stop', pendingMessages: false, fresh: false };
  assert.equal(shouldContinue(args), true);
  for (const change of [{ nudges: 2 }, { stopReason: 'aborted' }, { stopReason: 'error' }, { pendingMessages: true }, { touched: false }, { state: { status: 'blocked' } }, { state: { status: 'verified' }, fresh: true }]) assert.equal(shouldContinue({ ...args, ...change }), false);
  assert.equal(shouldContinue({ ...args, state: { status: 'verified' }, fresh: false }), true);
});
test('argv execution captures output without shell expansion, including spaces', async t => {
  const cwd = fixture(t), logPath = join(cwd, '.harness', 'ok.log');
  const result = await runCommand([process.execPath, '-e', 'console.log(process.argv[1])', 'literal $HOME ; echo bad'], { cwd, logPath });
  assert.equal(result.code, 0); assert.match(result.output, /literal \$HOME ; echo bad/);
  assert.match(readFileSync(logPath, 'utf8'), /literal/);
});
test('nonzero exit and missing executable cannot be successful', async t => {
  const cwd = fixture(t);
  const fail = await runCommand([process.execPath, '-e', 'process.exit(7)'], { cwd, logPath: join(cwd, 'fail.log') });
  assert.equal(fail.code, 7);
  const missing = await runCommand(['definitely-no-such-delivery-command'], { cwd, logPath: join(cwd, 'missing.log') });
  assert.notEqual(missing.code, 0); assert.match(missing.output, /ENOENT/);
});
test('timeout terminates long-lived check; cancellation before launch is cheap', async t => {
  const cwd = fixture(t);
  const result = await runCommand([process.execPath, '-e', 'setInterval(()=>{},1000)'], { cwd, timeoutSeconds: .15, logPath: join(cwd, 'timeout.log') });
  assert.equal(result.timedOut, true); assert.notEqual(result.code, 0);
  const signal = AbortSignal.abort();
  const cancelled = await runCommand(['never-launched'], { cwd, signal, logPath: join(cwd, 'cancel.log') });
  assert.equal(cancelled.cancelled, true);
});
test('generated-only scopes cannot create empty fingerprints as evidence', t => {
  const cwd = fixture(t);
  for (const root of ['artifacts/', './artifacts', '.harness', '.venv', 'nested/node_modules']) {
    const p = plan(); p.artifacts = [root];
    assert.throws(() => validatePlan(p, cwd), /Artifact roots/);
  }
});
test('replanning cannot silently drop requirements', () => {
  const previous = { plan: plan(), status: 'verifying' };
  const next = plan(); next.acceptance = [{ requirement: 'A weaker requirement', checks: ['smoke'] }];
  assert.throws(() => validateRevision(previous, next), /remove acceptance/);
  assert.doesNotThrow(() => validateRevision(previous, plan()));
});
test('parallel delivery operations serialize and recover after failure', async () => {
  const enqueue = createSerialQueue(), order = [];
  const a = enqueue(async () => { order.push('a-start'); await new Promise(r => setTimeout(r, 15)); order.push('a-end'); });
  const b = enqueue(async () => { order.push('b'); throw Error('expected'); });
  const c = enqueue(async () => { order.push('c'); return 7; });
  await a; await assert.rejects(b, /expected/); assert.equal(await c, 7);
  assert.deepEqual(order, ['a-start', 'a-end', 'b', 'c']);
});
test('local path boundary is not fooled by sibling prefixes', t => {
  const cwd = fixture(t); assert.throws(() => localPath(cwd, cwd + '-sibling/file'));
  assert.equal(localPath(cwd, '@app.py'), join(cwd, 'app.py'));
});
test('provider errors do not consume the productive turn budget', () => {
  // Observed live: 91 turn starts included 13 zero-token connection-error turns that
  // consumed the old budget. Only productive turns may trip the limit; wall-clock still bounds.
  assert.equal(turnBudgetExceeded({ turns: 91, providerErrors: 13, maxTurns: 90 }), false);
  assert.equal(turnBudgetExceeded({ turns: 91, providerErrors: 0, maxTurns: 90 }), true);
  // The 91st start with one wasted error turn is exactly 90 productive turns: allowed.
  assert.equal(turnBudgetExceeded({ turns: 91, providerErrors: 1, maxTurns: 90 }), false);
  assert.equal(turnBudgetExceeded({ turns: 92, providerErrors: 1, maxTurns: 90 }), true);
  assert.equal(turnBudgetExceeded({ turns: 10, providerErrors: 13, maxTurns: 90 }), false);
  assert.equal(turnBudgetExceeded({ turns: 0, providerErrors: 0, maxTurns: 0 }), false);
  assert.equal(turnBudgetExceeded({ turns: 1, providerErrors: 0, maxTurns: 0 }), true);
  for (const bad of [{ turns: 1.5, providerErrors: 0, maxTurns: 1 }, { turns: 1, providerErrors: -1, maxTurns: 1 }, { turns: 1, providerErrors: 0, maxTurns: -1 }])
    assert.throws(() => turnBudgetExceeded(bad));
});
test('runCommand works without a log path', async t => {
  const cwd = fixture(t);
  const result = await runCommand([process.execPath, '-e', 'console.log("ok")'], { cwd });
  assert.equal(result.code, 0);
  assert.match(result.output, /ok/);
  assert.equal(result.logPath, undefined);
});
test('delivery reports are persisted and the newest report is discovered', t => {
  const cwd = fixture(t);
  const first = createReport(cwd, { status: 'implementing', plan: plan(), evidence: {} }, 'session-a');
  const second = createReport(cwd, { status: 'verified', plan: plan(), evidence: {} }, 'session-b');
  const state = { ...second.state, review: 'reviewed' };
  saveReport(second.path, state);
  const newer = new Date(Date.now() + 1000);
  utimesSync(second.path, newer, newer);
  const latest = latestReport(cwd);
  assert.equal(latest.path, second.path);
  assert.equal(latest.state.review, 'reviewed');
  assert.match(readFileSync(join(first.dir, 'plan.d2'), 'utf8'), /Working app/);
});

test('fingerprint respects maxEvidenceFiles and PI2_MAX_FILES override', t => {
  const cwd = fixture(t);
  const oldEnv = process.env.PI2_MAX_FILES;
  t.after(() => {
    if (oldEnv === undefined) delete process.env.PI2_MAX_FILES;
    else process.env.PI2_MAX_FILES = oldEnv;
  });

  assert.equal(maxEvidenceFiles(), 25000);
  assert.equal(maxEvidenceBytes(), 256 * 1024 * 1024);

  process.env.PI2_MAX_FILES = '3';
  assert.equal(maxEvidenceFiles(), 3);

  // 1 file (app.py) passes
  assert.doesNotThrow(() => fingerprint(cwd, ['.']));

  // Add 3 more files (total 4 > 3)
  writeFileSync(join(cwd, 'a.txt'), 'a');
  writeFileSync(join(cwd, 'b.txt'), 'b');
  writeFileSync(join(cwd, 'c.txt'), 'c');
  assert.throws(() => fingerprint(cwd, ['.']), /Evidence scope exceeds 3 files/);
});

test('fingerprint omits .pi and .pi2 directory trees', t => {
  const cwd = fixture(t);
  const hashBefore = fingerprint(cwd, ['.']);
  mkdirSync(join(cwd, '.pi'), { recursive: true });
  writeFileSync(join(cwd, '.pi', 'data.json'), '{"ignore": true}');
  mkdirSync(join(cwd, '.pi2'), { recursive: true });
  writeFileSync(join(cwd, '.pi2', 'data.json'), '{"ignore": true}');
  const hashAfter = fingerprint(cwd, ['.']);
  assert.equal(hashBefore, hashAfter);
});

test('verification classification: none/advisory rules keep required strict', t => {
  const cwd = fixture(t);
  // Default is required: non-empty acceptance + checks, at least one non-static.
  assert.deepEqual(validatePlan(plan(), cwd), plan());
  assert.equal(verificationMode(plan()), 'required');
  assert.equal(verificationMode({ verification: 'bogus' }), 'required');
  assert.throws(() => validatePlan({ ...plan(), verification: 'informational' }, cwd), /verification must be one of/);

  // none = pure informational answer: checks/acceptance must be absent.
  const none = { ...plan(), verification: 'none', checks: [], acceptance: [] };
  assert.deepEqual(validatePlan(none, cwd), none);
  assert.throws(() => validatePlan({ ...plan(), verification: 'none' }, cwd), /none/);

  // required stays strict even if the model empties the arrays.
  assert.throws(() => validatePlan({ ...plan(), checks: [], acceptance: [] }, cwd), /required/);

  // advisory may be empty, or carry checks whose failures are non-blocking.
  const advisoryEmpty = { ...plan(), verification: 'advisory', checks: [], acceptance: [] };
  assert.deepEqual(validatePlan(advisoryEmpty, cwd), advisoryEmpty);
  const advisoryChecks = { ...plan(), verification: 'advisory' };
  assert.deepEqual(validatePlan(advisoryChecks, cwd), advisoryChecks);
  assert.throws(() => validatePlan({ ...advisoryChecks, acceptance: [] }, cwd), /together/);
  const staticOnly = { ...plan(), verification: 'advisory', checks: [{ ...plan().checks[0], kind: 'static' }] };
  assert.deepEqual(validatePlan(staticOnly, cwd), staticOnly);
});

test('required validators force strict verification and cannot be downgraded away', () => {
  const informative = { goal: 'Q', artifacts: ['.'], steps: ['Answer'], verification: 'none', acceptance: [], checks: [] };
  const bound = bindRequiredChecks(informative, [{ id: 'required_oracle', kind: 'test', argv: [process.execPath, '-e', 'process.exit(0)'], timeoutSeconds: 5 }]);
  assert.equal(bound.verification, 'required');
  assert.equal(bound.checks.length, 1);
  assert.equal(bound.acceptance.length, 1);
  assert.equal(bound.acceptance[0].checks[0], 'required_oracle');
});

test('pre-verify reclassification is allowed only before evidence exists', () => {
  const previous = { plan: plan(), status: 'implementing', evidence: {} };
  const informational = { goal: 'Answered a question', artifacts: ['.'], steps: ['Answer'], verification: 'none', acceptance: [], checks: [] };
  // Re-check before the verify loop: no evidence, so reclassification is explicit.
  assert.doesNotThrow(() => validateRevision(previous, informational));
  // Once a check has run, a downgrade would escape its failing evidence.
  assert.throws(
    () => validateRevision({ ...previous, evidence: { smoke: { passed: false } } }, informational),
    /Cannot downgrade verification after checks have run/,
  );
  // Upgrading informative -> required still runs acceptance protection.
  assert.doesNotThrow(() => validateRevision({ plan: informational, status: 'implementing', evidence: {} }, plan()));
  const weakened = plan();
  weakened.acceptance = [{ requirement: 'A weaker requirement', checks: ['smoke'] }];
  assert.throws(() => validateRevision({ plan: plan(), status: 'implementing', evidence: {} }, weakened), /remove acceptance/);
});

test('looksInformational recognizes read-only asks but not build tasks', () => {
  for (const text of ['what does index.ts do?', 'explain the retry logic', 'how does auth work', 'review this diff', 'list the pending checks']) {
    assert.equal(looksInformational(text), true, text);
  }
  for (const text of ['build a task cli', 'fix the failing test', 'what cache layer should I add — implement it', '/compact', '!ls', '']) {
    assert.equal(looksInformational(text), false, text);
  }
});

test('informational plans are terminal and skip repair nudges', () => {
  const args = { touched: true, nudges: 0, stopReason: 'stop', pendingMessages: false, fresh: false };
  assert.equal(shouldContinue({ ...args, state: { status: 'implementing', plan: { verification: 'none' } } }), false);
  assert.equal(shouldContinue({ ...args, state: { status: 'implementing', plan: { verification: 'advisory' } } }), false);
  assert.equal(shouldContinue({ ...args, state: { status: 'implementing', plan: plan() } }), true);
});

test('computePhase reaches review for check-free informational plans', () => {
  const informative = { goal: 'Q', artifacts: ['.'], steps: ['Answer'], acceptance: [], checks: [], verification: 'none' };
  const state = { plan: informative, evidence: {}, status: 'implementing', revision: 1 };
  assert.equal(computePhase(state, 'h').phase, 'review');
  assert.equal(computePhase({ ...state, stepStatus: { step0: 'done' } }, 'h').phase, 'review');
  // Required plans still wait for evidence before review.
  assert.equal(computePhase({ plan: plan(), evidence: {}, status: 'implementing' }, 'h').phase, 'plan');
});

test('guidance, prompt template and README document the classification', () => {
  const prompt = readFileSync(new URL('../prompts/delivery.md', import.meta.url), 'utf8');
  const extension = readFileSync(new URL('../extensions/delivery.ts', import.meta.url), 'utf8');
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(prompt, /Classify the ask/);
  assert.match(prompt, /verification:"none"/);
  assert.match(prompt, /verification:"advisory"/);
  assert.match(prompt, /re-check the classification/);
  assert.match(extension, /Classify the ask before planning/);
  assert.match(extension, /verification:"none"/);
  assert.match(extension, /looksInformational\(event\.prompt\)/);
  assert.match(readme, /Informational vs delivery asks/);
  assert.match(readme, /advisory/);
});

