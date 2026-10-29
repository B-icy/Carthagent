#!/usr/bin/env node
/** Real native RPC registration and source projection, with no cloud submission. */
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
  const daily = (method, input = {}) => rpc('carthagent.dailyQuests', method, input);
  const source = sessionID => rpc('carthagent.daily-source', 'report', { sessionID });
  const authFailure = promise => assert.rejects(promise, error => {
    assert.equal(error.type, 'dailyQuestError');
    assert.equal(error.data.code, 'authentication_required');
    return true;
  });
  // This fixture has no managed device credential. All six real handlers must
  // fail with their declared auth error, never reach an external API/provider.
  await authFailure(daily('snapshot'));
  await authFailure(daily('detail', { id: randomUUID() }));
  await authFailure(daily('poll', { id: randomUUID() }));
  await authFailure(daily('retry', { id: randomUUID(), accountKey: '0'.repeat(64) }));
  await authFailure(daily('forgetPayload', { id: randomUUID(), accountKey: '0'.repeat(64) }));
  await authFailure(daily('submit', { id: randomUUID(), questId: randomUUID(), accountKey: '0'.repeat(64), consent: true, evidence: {
    projectId: randomUUID(), outcomeId: randomUUID(), runId: randomUUID(), revision: 'a'.repeat(40),
    goal: '', change: '', checks: [], findings: [],
  } }));

  const session = await host.client.session.create({ location: host.location, model: host.model, title: 'Daily source schema probe' }, host.request());
  assert.deepEqual((await source(session.id)).output, { source: null });
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
  console.log(JSON.stringify({ runtime: host.runtimeIdentity.runtimeVersion, binarySha256: host.runtimeIdentity.binarySha256, dailyRegistration: 'passed', authFailures: 6, sourceOutputSchema: 'passed', staleProjection: 'passed', cloudSubmissions: 0, providerRequests: 0, productionAcceptance: false }));
} finally {
  await host.close();
}
