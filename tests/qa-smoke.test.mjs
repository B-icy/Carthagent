import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createWorkspace, dashboardChecks, main, runChecks, startDashboard } from '../tools/qa-smoke.mjs';

test('QA smoke dashboard checks pass against a real dashboard and clean up', async t => {
  const fixture = createWorkspace();
  t.after(fixture.cleanup);
  const context = { ...fixture, token: randomBytes(8).toString('hex') };
  const dashboard = await startDashboard(context);
  t.after(dashboard.stop);
  const lines = [];
  const results = await runChecks(dashboardChecks({ ...context, url: dashboard.url }), context, line => lines.push(line));
  assert.deepEqual(
    results.filter(result => !result.passed),
    [],
    lines.join('\n'),
  );
  assert.equal(results.length, 8);
  await dashboard.stop();
  fixture.cleanup();
  assert.equal(existsSync(fixture.base), false);
});

test('QA smoke reports failures with their reason and a failing exit status', async () => {
  const lines = [];
  const results = await runChecks(
    [
      ['passes', async () => 'evidence'],
      [
        'fails',
        async () => {
          throw new Error('boom');
        },
      ],
    ],
    {},
    line => lines.push(line),
  );
  assert.deepEqual(
    results.map(({ name, passed, error, evidence }) => ({ name, passed, error, evidence })),
    [
      { name: 'passes', passed: true, error: undefined, evidence: 'evidence' },
      { name: 'fails', passed: false, error: 'boom', evidence: undefined },
    ],
  );
  assert.match(lines[1], /^FAIL fails \(\d+ ms\): boom$/);
  assert.equal(await main(['--skip-dashboard', '--skip-cli'], () => {}), 1, 'running no checks is a failure');
  assert.equal(await main(['--bogus'], () => {}), 2);
});
