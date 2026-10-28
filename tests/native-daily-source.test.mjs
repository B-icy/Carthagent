import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonSchema, Schema, SchemaRepresentation } from 'effect';
import { checkDigest, fingerprint } from '../lib/delivery.mjs';
import { createReport } from '../lib/reports.mjs';
import { selectReport } from '../lib/workspace.mjs';

const { createJiti } = createRequire(import.meta.url)('jiti');
const jiti = createJiti(import.meta.url);
const { DailySource } = await jiti.import('../plugins/carthagent/src/daily-source-rpc.ts');
const { createDailySourceRpcHandlers, registerDailySourceRpc } = await jiti.import('../plugins/carthagent/src/server/daily-source-rpc.ts');
const call = { signal: new AbortController().signal, error(type, message, data) { throw Object.assign(new Error(message), { type, data }); } };
const rejected = (promise, code) => assert.rejects(promise, error => {
  assert.equal(error.type, 'dailySourceError');
  assert.equal(error.message, code);
  assert.deepEqual(error.data, { code });
  return true;
});
const check = id => ({ id, kind: 'test', argv: ['never-execute-this', 'sensitive-argv'], timeoutSeconds: 20 });

function fixture(t, checks = [check('unit')]) {
  // Match the native canonical location, including macOS /var -> /private/var.
  // The source boundary must still reject a linked authoritative path.
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'daily-source-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'project'); mkdirSync(root);
  writeFileSync(join(root, 'source.txt'), 'actual source');
  const sessionID = 'native-session';
  const current = fingerprint(root, ['.']);
  const plan = {
    goal: 'Actual plan goal', artifacts: ['.'], steps: ['Implement'],
    acceptance: [{ requirement: 'Actual requirement', checks: checks.map(item => item.id) }], checks,
  };
  const state = { runId: 'native-run', revision: 3, status: 'implementing', plan, evidence: {} };
  const session = { id: sessionID, projectID: 'native-project', location: { directory: root } };
  const nativeWorktrees = [];
  const sessions = new Map([[sessionID, session]]);
  let registrations = 0, disposed = 0;
  const ctx = {
    location: { directory: root, project: { id: 'native-project', canonical: root } },
    session: { async get({ sessionID: id }, { signal }) { signal.throwIfAborted(); const found = sessions.get(id); if (!found) throw new Error(`private path ${root}`); return found; } },
    worktree: { async list({ projectID }, { signal }) { assert.equal(projectID, 'native-project'); signal.throwIfAborted(); return nativeWorktrees.map(directory => ({ directory })); } },
    rpc: { async register(definition, handlers) { registrations++; assert.equal(definition.id, DailySource.id); assert.deepEqual(Object.keys(handlers), ['report']); return { async dispose() { disposed++; } }; } },
    // Any attempt to look up credentials, transcripts or write storage must fail.
    get integration() { throw new Error('must not access credentials'); },
    get storage() { throw new Error('must not access storage'); },
  };
  const report = createReport(root, state, sessionID);
  selectReport(root, report.path);
  const save = () => writeFileSync(report.path, JSON.stringify(state));
  const receipt = (id = checks[0].id, overrides = {}) => ({
    passed: true, runId: state.runId, revision: state.revision, executedRevision: state.revision,
    checkDigest: checkDigest(checks.find(item => item.id === id)), fingerprint: current,
    code: 0, timedOut: false, cancelled: false, changedDuringCheck: false, durationMs: 9,
    outputTail: 'actual bounded output tail', logPath: join(base, 'must-not-read.log'), ...overrides,
  });
  const handlers = createDailySourceRpcHandlers(ctx);
  return { base, root, current, sessionID, session, sessions, ctx, state, report, save, receipt, nativeWorktrees, handlers,
    read: () => handlers.report({ sessionID }, call), counts: () => ({ registrations, disposed }) };
}

test('local source uses actual receipt identity, actual goal, no synthetic before/change or log imports', async t => {
  const f = fixture(t, [check('unit'), check('missing'), check('failure')]);
  f.state.evidence.unit = f.receipt('unit');
  f.state.evidence.failure = f.receipt('failure', { passed: false, code: 1, outputTail: 'actual failing assertion' });
  f.state.handoff = { review: 'not a change summary', launch: 'not a summary either', fingerprint: f.current };
  f.state.transcript = 'must-not-return-transcript';
  f.state.reviewCapture = { path: join(f.root, 'must-not-read-capture'), diff: 'must-not-return-full-capture' };
  f.save();
  const { source } = await f.read();
  assert.deepEqual(source, {
    runId: 'native-run', revision: f.current, planRevision: 3, freshness: 'current', goal: 'Actual plan goal', change: '',
    checks: [
      { id: 'unit', before: 'not_run', after: 'passed', revision: f.current, result: 'actual bounded output tail' },
      { id: 'missing', before: 'not_run', after: 'not_run', revision: f.current, result: '' },
      { id: 'failure', before: 'not_run', after: 'failed', revision: f.current, result: 'actual failing assertion' },
    ], findings: [], truncated: false,
  });
  for (const forbidden of ['sensitive-argv', 'logPath', f.root, 'must-not-return', 'not a change summary']) assert.equal(JSON.stringify(source).includes(forbidden), false);
  // The current receipt overwrites prior outcomes. Never invent a historical failure.
  f.state.evidence.failure = f.receipt('failure'); f.save();
  assert.equal((await f.read()).source.checks[2].before, 'not_run');
  assert.equal((await f.read()).source.checks[2].after, 'passed');
});

test('stale, mismatched or contradictory passing receipts never become current passing evidence', async t => {
  const f = fixture(t);
  const invalidations = [
    { fingerprint: '0'.repeat(64) }, { runId: 'other-run' }, { revision: 2 }, { checkDigest: '0'.repeat(64) },
    { code: 1 }, { timedOut: true }, { cancelled: true }, { changedDuringCheck: true }, { outputLimit: true }, { code: undefined },
  ];
  for (const overrides of invalidations) {
    f.state.evidence.unit = f.receipt('unit', overrides); f.save();
    const { source } = await f.read();
    assert.equal(source.freshness, 'stale', JSON.stringify(overrides));
    assert.equal(source.checks[0].after, 'not_run');
    assert.equal(source.checks[0].revision, f.current);
  }
  f.state.evidence.unit = f.receipt(); f.save();
  writeFileSync(join(f.root, 'source.txt'), 'changed actual source');
  const { source } = await f.read();
  assert.equal(source.revision, fingerprint(f.root, ['.']));
  assert.notEqual(source.revision, f.current);
  assert.equal(source.checks[0].after, 'not_run');
  assert.equal(source.freshness, 'stale');
  // The native failure path explicitly records a null fingerprint on scope failure.
  f.state.evidence.unit = f.receipt('unit', { passed: false, fingerprint: null, code: 1 }); f.save();
  assert.equal((await f.read()).source.checks[0].after, 'not_run');
});

test('failed receipts are current-only: old source, mismatched identity and scope errors cannot fabricate a current failure', async t => {
  const f = fixture(t);
  for (const overrides of [
    { runId: 'other-run' }, { revision: 2 }, { checkDigest: '0'.repeat(64) },
    { fingerprint: '0'.repeat(64) }, { fingerprint: null }, { fingerprint: undefined },
    { code: undefined }, { code: 0 }, { changedDuringCheck: true },
    { fingerprint: null, timedOut: true }, { fingerprint: undefined, cancelled: true },
  ]) {
    f.state.evidence.unit = f.receipt('unit', { passed: false, code: 1, outputTail: 'old or unexecuted failure', ...overrides });
    f.save();
    const { source } = await f.read();
    assert.equal(source.checks[0].after, 'not_run', JSON.stringify(overrides));
    assert.equal(source.checks[0].before, 'not_run');
    assert.equal(source.checks[0].revision, f.current);
    assert.equal(source.checks[0].result, '');
  }
  for (const overrides of [{ code: 1 }, { code: -1 }, { code: 0, timedOut: true }, { code: undefined, cancelled: true }, { code: 0, outputLimit: true }]) {
    f.state.evidence.unit = f.receipt('unit', { passed: false, outputTail: 'actual current failure', ...overrides });
    f.save();
    const { source } = await f.read();
    assert.equal(source.checks[0].after, 'failed', JSON.stringify(overrides));
    assert.equal(source.checks[0].revision, f.current);
    assert.equal(source.checks[0].result, 'actual current failure');
  }
  f.state.evidence.unit = f.receipt('unit', { passed: false, code: 1, outputTail: 'failure at A, not B' }); f.save();
  assert.equal((await f.read()).source.checks[0].after, 'failed');
  writeFileSync(join(f.root, 'source.txt'), 'workspace B');
  const { source } = await f.read();
  assert.notEqual(source.revision, f.current);
  assert.equal(source.revision, fingerprint(f.root, ['.']));
  assert.equal(source.checks[0].revision, source.revision);
  assert.equal(source.checks[0].after, 'not_run');
  assert.equal(source.checks[0].result, '');
  assert.equal(source.freshness, 'stale');
});

test('review findings expose only actual model-authored resolution claims without verification labels', async t => {
  const f = fixture(t);
  f.state.reviewFindings = [
    { id: 'finding-one', description: 'Actual review issue', captureId: 'capture-private', fingerprint: f.current, at: 'then', resolution: { id: 'finding-one', change: 'Actual described repair', evidence: 'Actual model-authored evidence claim', captureId: 'capture-private', fingerprint: f.current, at: 'now' } },
    { id: 'finding-two', description: 'Unresolved issue' },
    { id: 'finding-three', description: 'Legacy resolution without evidence', resolution: { id: 'finding-three', change: 'Recorded change only' } },
  ];
  f.save();
  assert.deepEqual((await f.read()).source.findings, [
    { id: 'finding-one', issue: 'Actual review issue', evidence: 'Actual model-authored evidence claim', resolution: 'Actual described repair' },
    { id: 'finding-two', issue: 'Unresolved issue', evidence: '', resolution: '' },
    { id: 'finding-three', issue: 'Legacy resolution without evidence', evidence: '', resolution: 'Recorded change only' },
  ]);
  const serialized = JSON.stringify((await f.read()).source.findings);
  assert.equal(serialized.includes('capture-private'), false);
  assert.equal(serialized.includes('verified'), false);
});

test('selection is bounded, UTF-8 safe and explicitly reports omitted claims/items', async t => {
  const f = fixture(t, Array.from({ length: 13 }, (_, i) => check(`check_${i}`)));
  f.state.plan.goal = '界'.repeat(342); // 1026 UTF-8 bytes, not 342-byte ASCII.
  f.state.evidence.check_0 = f.receipt('check_0', { outputTail: '界'.repeat(341) });
  f.state.evidence.check_1 = f.receipt('check_1', { outputTail: '😀'.repeat(257) });
  f.state.reviewFindings = Array.from({ length: 6 }, (_, i) => ({ id: `finding-${i}`, description: i ? 'Actual issue' : 'x'.repeat(2001), resolution: { id: `finding-${i}`, change: 'Recorded repair', evidence: i ? 'Claimed evidence' : 'x'.repeat(2001) } }));
  f.save();
  const { source } = await f.read();
  assert.equal(source.checks.length, 12);
  assert.equal(source.findings.length, 5);
  assert.equal(source.truncated, true);
  assert.equal(source.goal, '');
  assert.equal(source.checks[0].result, '界'.repeat(341));
  assert.equal(source.checks[1].result, '', 'omit entire claims rather than changing their meaning');
  assert.equal(source.findings[0].issue, '');
  assert.equal(source.findings[0].evidence, '');
  assert.equal(JSON.stringify(source).includes('\ufffd'), false);
  assert.ok(Buffer.byteLength(JSON.stringify(source), 'utf8') < 64 * 1024);
});

test('unrepresentable/control text is omitted rather than silently sanitized into a different claim', async t => {
  const f = fixture(t);
  for (const outputTail of ['prefix\u001b[31mprivate', 'bad\ud800surrogate', 'nul\u0000byte']) {
    f.state.evidence.unit = f.receipt('unit', { outputTail }); f.save();
    const { source } = await f.read();
    assert.equal(source.checks[0].result, '');
    assert.equal(source.truncated, true);
  }
});

test('freshness inspects receipts outside the selection cap and required final-review identity', async t => {
  const checks = Array.from({ length: 13 }, (_, i) => check(`check_${i}`));
  const f = fixture(t, checks);
  for (const item of checks) f.state.evidence[item.id] = f.receipt(item.id);
  f.state.evidence.check_12.fingerprint = '0'.repeat(64); f.save();
  assert.equal((await f.read()).source.freshness, 'stale');
  assert.equal((await f.read()).source.checks.every(item => item.after === 'passed'), true, 'fresh displayed receipts do not hide stale omitted receipts');
  f.state.evidence.check_12 = f.receipt('check_12');
  f.state.plan.steps = [{ id: 'implement', title: 'Implement', dependsOn: [], checks: checks.map(item => item.id) }];
  f.save();
  assert.equal((await f.read()).source.freshness, 'stale', 'missing required review cannot claim current report');
  f.state.reviewEvidence = { runId: f.state.runId, revision: f.state.revision, fingerprint: f.current }; f.save();
  assert.equal((await f.read()).source.freshness, 'current');
  f.state.reviewEvidence.fingerprint = '0'.repeat(64); f.save();
  assert.equal((await f.read()).source.freshness, 'stale');
});

test('only the exact active report for the native session is selected, never latest or storage snapshots', async t => {
  const f = fixture(t);
  const pointer = join(f.root, '.harness', 'active.json');
  rmSync(pointer);
  assert.deepEqual(await f.read(), { source: null }, 'existing reports do not authorize latest-report fallback');
  const foreign = createReport(f.root, { ...f.state, runId: 'foreign-run' }, 'foreign-session');
  selectReport(f.root, foreign.path);
  assert.deepEqual(await f.read(), { source: null });
  selectReport(f.root, f.report.path);
  rmSync(f.report.path);
  assert.deepEqual(await f.read(), { source: null });
});

test('foreign sessions, mismatched IDs, forged task worktrees and arbitrary paths are rejected safely', async t => {
  const f = fixture(t);
  f.sessions.set('foreign-session', { ...f.session, id: 'foreign-session', projectID: 'foreign-project' });
  await rejected(f.handlers.report({ sessionID: 'foreign-session' }, call), 'not_owned');
  f.sessions.set('wrong-id', f.session);
  await rejected(f.handlers.report({ sessionID: 'wrong-id' }, call), 'not_owned');
  await rejected(f.handlers.report({ sessionID: 'unknown-session' }, call), 'invalid_source');
  for (const input of [{ sessionID: '../escape' }, { sessionID: f.sessionID, path: f.report.path }, { sessionID: f.sessionID, includeGoal: true }, null]) await rejected(f.handlers.report(input, call), 'invalid_request');
  const worktree = join(f.base, 'forged-worktree'); mkdirSync(worktree);
  f.session.location.directory = worktree;
  await rejected(f.read(), 'not_owned');
  writeFileSync(join(f.root, '.harness', 'opencode-tasks.json'), JSON.stringify({ version: 1, tasks: [{ sessionID: f.sessionID, worktree }], operations: [] }));
  await rejected(f.read(), 'not_owned', 'forged journal alone must not authorize a worktree');
  f.nativeWorktrees.push(worktree);
  const actual = createReport(worktree, f.state, f.sessionID); selectReport(worktree, actual.path);
  assert.equal((await f.read()).source.runId, f.state.runId);
  // The journal must agree with the native session location even for a known worktree.
  f.session.location.directory = f.root;
  await rejected(f.read(), 'not_owned');
});

test('canonical native locations remain readable through a linked temporary namespace without accepting linked authority', async t => {
  const f = fixture(t);
  const alias = join(f.base, 'temporary-alias');
  symlinkSync(f.base, alias, 'junction');
  const aliasedRoot = join(alias, 'project');
  const canonical = realpathSync(aliasedRoot);
  assert.equal(canonical, f.root);
  f.ctx.location.directory = canonical;
  f.ctx.location.project.canonical = canonical;
  f.session.location.directory = canonical;
  assert.equal((await f.read()).source.runId, f.state.runId);
  f.ctx.location.directory = aliasedRoot;
  f.ctx.location.project.canonical = aliasedRoot;
  f.session.location.directory = aliasedRoot;
  await rejected(f.read(), 'invalid_source');
});

test('symlink components, final files and directory reports are rejected without following local secrets', async t => {
  for (const target of ['report', 'run', 'session', 'harness', 'pointer', 'journal', 'root', 'ancestor']) {
    await t.test(target, async t => {
      const f = fixture(t);
      const replacements = {
        report: f.report.path, run: f.report.dir, session: join(f.root, '.harness', f.sessionID),
        harness: join(f.root, '.harness'), pointer: join(f.root, '.harness', 'active.json'), journal: join(f.root, '.harness', 'opencode-tasks.json'), root: f.root,
      };
      if (target === 'ancestor') {
        const alias = join(f.base, 'alias'); symlinkSync(f.base, alias);
        f.ctx.location.directory = join(alias, 'project');
        f.ctx.location.project.canonical = f.ctx.location.directory;
        f.session.location.directory = f.ctx.location.directory;
      } else {
        const path = replacements[target];
        rmSync(path, { recursive: true, force: true });
        const elsewhere = join(f.base, 'secret');
        if (['report', 'pointer', 'journal'].includes(target)) writeFileSync(elsewhere, '{"private":"must not follow"}'); else mkdirSync(elsewhere);
        symlinkSync(elsewhere, path);
      }
      await rejected(f.read(), 'invalid_source');
    });
  }
  const f = fixture(t);
  rmSync(f.report.path); mkdirSync(f.report.path);
  await rejected(f.read(), 'invalid_source');
});

test('oversized/corrupt reports, forged run IDs, malformed schemas and unsafe pointers fail closed', async t => {
  const f = fixture(t);
  const original = JSON.stringify(f.state);
  for (const body of ['{corrupt', ' '.repeat(1024 * 1024 + 1), '[]', 'null', '\ud800']) {
    writeFileSync(f.report.path, body);
    await rejected(f.read(), 'invalid_source');
  }
  const mutations = [
    state => { state.runId = 'other-run'; }, state => { state.revision = 0; }, state => { state.revision = 1.5; },
    state => { state.plan.checks = []; }, state => { state.evidence = []; },
    state => { state.evidence.unknown = {}; }, state => { state.status = 'bogus'; },
    state => { state.evidence.unit = f.receipt('unit', { passed: 'true' }); },
    state => { state.evidence.unit = f.receipt('unit', { fingerprint: 'invalid-hash' }); },
    state => { state.evidence.unit = f.receipt('unit', { outputTail: {} }); },
    state => { state.reviewFindings = [{ id: '../private', description: 'bad ID' }]; },
    state => { state.reviewFindings = [{ id: 'finding', description: 'bad resolution', resolution: { id: 'different', change: 'claim' } }]; },
    state => { state.reviewFindings = [{ id: 'same', description: 'one' }, { id: 'same', description: 'two' }]; },
  ];
  for (const mutate of mutations) {
    const state = JSON.parse(original); mutate(state);
    writeFileSync(f.report.path, JSON.stringify(state));
    await rejected(f.read(), 'invalid_source');
  }
  writeFileSync(f.report.path, original);
  const pointer = join(f.root, '.harness', 'active.json');
  for (const body of ['{corrupt', ' '.repeat(4097), JSON.stringify({ version: 1, path: '/private/report.json' }), JSON.stringify({ version: 1, path: '.harness/../private/report.json' }), JSON.stringify({ version: 1, path: '.harness/session/run/../report.json' })]) {
    writeFileSync(pointer, body);
    await rejected(f.read(), 'invalid_source');
  }
});

test('local read and registration have no automatic outbound requests or filesystem mutations', async t => {
  const f = fixture(t);
  f.state.evidence.unit = f.receipt(); f.save();
  const snapshot = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? snapshot(path) : [[path, readFileSync(path).toString('hex')]];
  });
  const before = snapshot(f.root);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('unexpected network'); };
  try {
    const registration = await registerDailySourceRpc(f.ctx);
    assert.equal((await f.read()).source.checks[0].after, 'passed');
    await registration.dispose();
  } finally { globalThis.fetch = originalFetch; }
  assert.deepEqual(f.counts(), { registrations: 1, disposed: 1 });
  assert.deepEqual(snapshot(f.root), before);
  const controller = new AbortController(); controller.abort(new Error('cancelled'));
  await assert.rejects(f.handlers.report({ sessionID: f.sessionID }, { ...call, signal: controller.signal }), /cancelled/);
});

test('pinned Effect RPC conversion accepts local source, null, input and safe typed error data', async t => {
  const f = fixture(t);
  f.state.evidence.unit = f.receipt(); f.save();
  const decode = (schema, value) => Schema.decodeUnknownSync(SchemaRepresentation.fromJsonSchemaDocument(JsonSchema.fromSchemaDraft2020_12(schema)))(value);
  assert.throws(() => decode({ type: 'string', pattern: '^[a-z]+$' }, 'value'), 'exercise the actual pinned conversion unsupported-pattern failure');
  assert.equal(DailySource.id, 'carthagent.daily-source');
  assert.deepEqual(Object.keys(DailySource.methods), ['report']);
  const method = DailySource.methods.report;
  assert.deepEqual(decode(method.input, { sessionID: f.sessionID }), { sessionID: f.sessionID });
  for (const value of [await f.read(), { source: null }]) assert.deepEqual(decode(method.output, value), value);
  assert.deepEqual(decode(method.errors.dailySourceError, { code: 'not_owned' }), { code: 'not_owned' });
  assert.throws(() => decode(method.input, {}));
  const forged = await f.read(); forged.source.checks[0].before = 'failed';
  assert.throws(() => decode(method.output, forged));
  const wrongRevision = await f.read(); wrongRevision.source.revision = 3;
  assert.throws(() => decode(method.output, wrongRevision));
});
