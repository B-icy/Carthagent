#!/usr/bin/env node
/** Real native RPC registration (daily goals, source projection), with no cloud request. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkDigest, fingerprint } from '../lib/delivery.mjs';
import { createReport } from '../lib/reports.mjs';
import { selectReport } from '../lib/workspace.mjs';
import { nativeFixture } from './native-fixture.mjs';

const host = await nativeFixture({ plugin: process.argv[2] });
try {
  await host.active();
  const rpc = (rpcID, method, input) => host.client.rpc.call({ rpcID, method, input, location: host.location }, host.request());
  const source = sessionID => rpc('carthagent.daily-source', 'report', { sessionID });
  // This fixture has no managed device credential. The daily-goals read must fail
  // with its declared auth error and never reach Voyages.
  await assert.rejects(rpc('carthagent.dailyGoals', 'snapshot', {}), error => {
    assert.equal(error.type, 'dailyGoalsError');
    assert.equal(error.data.code, 'authentication_required');
    return true;
  });

  const session = await host.client.session.create({ location: host.location, model: host.model, title: 'Daily source schema probe' }, host.request());
  assert.deepEqual((await source(session.id)).output, { source: null });
  for (const agent of ['lite', 'plan', 'build']) {
    const work = await host.client.session.create({ location: host.location, model: host.model, agent, title: 'Any-mode schema probe' }, host.request());
    const draft = (await rpc('carthagent.daily-source', 'report', { sessionID: work.id, allowSession: true })).output.source;
    assert.equal(draft.origin, 'session');
    assert.equal(draft.revision, fingerprint(host.cwd, ['.']));
    assert.equal(draft.goal, ''); assert.equal(draft.change, '');
    assert.deepEqual(draft.checks, []); assert.deepEqual(draft.findings, []);
    assert.deepEqual((await source(work.id)).output, { source: null });
  }
  await writeFile(join(host.cwd, 'source.txt'), 'local schema probe, not execution evidence\n');
  const runId = randomUUID(), revision = fingerprint(host.cwd, ['.']);
  const check = { id: 'unit', kind: 'test', argv: ['never-execute'], timeoutSeconds: 20 };
  const report = createReport(host.cwd, {
    runId, revision: 1, status: 'implementing',
    plan: { goal: 'Exercise the real local RPC output validator', artifacts: ['.'], steps: ['Inspect'], acceptance: [{ requirement: 'Return the selected local projection', checks: ['unit'] }], checks: [check] },
    // Deliberately constructed schema receipt, not proof that a command ran.
    evidence: { unit: { runId, revision: 1, executedRevision: 1, passed: true, code: 0, checkDigest: checkDigest(check), fingerprint: revision, timedOut: false, cancelled: false, changedDuringCheck: false, outputTail: 'Selected local-only schema text' } },
  }, session.id);
  selectReport(host.cwd, report.path);
  const selected = (await source(session.id)).output.source;
  assert.equal(selected.runId, runId);
  assert.equal(selected.revision, revision);
  assert.equal(selected.planRevision, 1);
  assert.equal(selected.change, '');
  assert.deepEqual(Object.keys(selected.checks[0]).sort(), ['after', 'before', 'id', 'result', 'revision']);
  assert.equal(selected.checks[0].id, 'unit');
  assert.equal(selected.checks[0].before, 'not_run');
  assert.equal(selected.checks[0].after, 'passed');
  assert.equal(selected.checks[0].result, 'Selected local-only schema text');
  await writeFile(join(host.cwd, 'source.txt'), 'changed\n');
  const stale = (await source(session.id)).output.source;
  assert.equal(stale.freshness, 'stale');
  assert.equal(stale.checks[0].after, 'not_run');
  assert.equal(host.requests.length, 0, 'No model requests are authorized by this probe');
  console.log(JSON.stringify({ runtime: host.runtimeIdentity.runtimeVersion, binarySha256: host.runtimeIdentity.binarySha256, dailyGoalsRegistration: 'passed', anyModeSourceSchema: 'passed', authFailures: 1, sourceOutputSchema: 'passed', staleProjection: 'passed', cloudSubmissions: 0, providerRequests: 0, productionAcceptance: false }));
} finally {
  await host.close();
}
