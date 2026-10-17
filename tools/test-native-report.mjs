#!/usr/bin/env node
/** Exercise the delivery report output through OpenCode's real RPC validator. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkDigest, fingerprint } from '../lib/delivery.mjs';
import { createReport } from '../lib/reports.mjs';
import { selectReport } from '../lib/workspace.mjs';
import { nativeFixture } from './native-fixture.mjs';

const host = await nativeFixture({ plugin: process.argv[2] });
try {
  execFileSync('git', ['init', '-q'], { cwd: host.cwd });
  await writeFile(join(host.cwd, 'source.txt'), 'original\n');
  await host.active();
  const session = await host.client.session.create({ location: host.location, model: host.model, title: 'Report projection' }, host.request());
  const read = async () => (await host.client.rpc.call({
    rpcID: 'carthagent.workspace', method: 'delivery', input: { sessionID: session.id }, location: host.location,
  }, host.request())).output;
  const check = { id: 'unit', kind: 'test', argv: ['node', '--test'], timeoutSeconds: 20 };
  const plan = {
    goal: 'Show authoritative report data', verification: 'required', artifacts: ['.'], outputs: [],
    steps: [{ id: 'implement', title: 'Implement the report view', dependsOn: [], checks: ['unit'] }],
    acceptance: [{ requirement: 'Report is visible', checks: ['unit'] }], checks: [check],
    design: { components: [{ id: 'core', responsibility: 'Project report state', layer: 'core', excludes: ['UI'], dependencies: [], requirements: ['Report is visible'] }], ports: [] },
  };
  // Fixture report receipts exercise projection/schema handling; they are not
  // evidence of real check execution or a substitute for delivery enforcement.
  const runId = 'projection-fixture';
  const state = {
    runId, revision: 1, status: 'implementing', workflowMode: 'standard', plan,
    stepStatus: { step0: 'done' },
    reviewEvidence: { runId, revision: 1, fingerprint: fingerprint(host.cwd, ['.']) },
    evidence: { unit: {
      runId, revision: 1, executedRevision: 1, checkDigest: checkDigest(check),
      fingerprint: fingerprint(host.cwd, ['.']), passed: true, durationMs: 2, code: 0,
      outputTail: 'PRIVATE_REPORT_LOG_SENTINEL',
      logPath: join(host.cwd, '.harness', session.id, runId, 'logs', 'unit.log'),
    } },
  };
  const report = createReport(host.cwd, state, session.id);
  selectReport(host.cwd, report.path);
  const current = await read();
  assert.equal(current.plan.goal, plan.goal);
  assert.equal(current.freshness, 'current', JSON.stringify(current));
  assert.equal(current.evidence[0].status, 'fresh');
  assert.equal(current.fingerprint.length, 64);
  assert.ok(current.workflow.nodes.length > 0);
  assert.equal(current.architecture.nodes[0].title, 'Project report state');
  assert.ok(!JSON.stringify(current).includes('PRIVATE_REPORT_LOG_SENTINEL'));
  assert.ok(!JSON.stringify(current).includes(host.cwd));

  await writeFile(join(host.cwd, 'source.txt'), 'modified\n');
  const stale = await read();
  assert.equal(stale.freshness, 'stale');
  assert.equal(stale.evidence[0].status, 'stale');
  for (const evidence of [{}, { unit: { ...state.evidence.unit, passed: false } }]) {
    await writeFile(report.path, JSON.stringify({ ...state, status: 'verified', evidence }));
    assert.notEqual((await read()).status, 'verified', 'missing or failed evidence cannot inherit a persisted verified label');
  }
  const neighbor = await host.client.session.create({ location: host.location, model: host.model, title: 'Other report owner' }, host.request());
  selectReport(host.cwd, createReport(host.cwd, state, neighbor.id).path);
  assert.deepEqual(await read(), { status: 'unavailable' });
  selectReport(host.cwd, report.path);
  await writeFile(report.path, '{corrupt');
  assert.deepEqual(await read(), { status: 'invalid' });
  console.log(JSON.stringify({ host: '2.0.32', deliveryOutputSchema: 'passed', freshness: 'passed', verifiedFailClosed: 'passed', ownership: 'passed' }));
} finally {
  await host.close();
}
