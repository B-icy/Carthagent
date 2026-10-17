import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createJiti } = require('jiti');
const jiti = createJiti(import.meta.url);
const { createLatestRequestGate, onWorkspaceUpdated, deliveryReadiness, renderDeliveryReadiness } = await jiti.import('../plugins/carthagent/src/ui/workspace-live.ts');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('overlapping async workspace refreshes cannot publish stale results', async () => {
  const gate = createLatestRequestGate();
  const older = deferred();
  const newer = deferred();
  let visible = 'initial';

  const olderRequest = gate.begin();
  const oldRefresh = older.promise.then((value) => {
    if (olderRequest.isCurrent()) visible = value;
  });
  const newerRequest = gate.begin();
  const newRefresh = newer.promise.then((value) => {
    if (newerRequest.isCurrent()) visible = value;
  });

  newer.resolve('new result');
  await newRefresh;
  older.resolve('stale result');
  await oldRefresh;
  assert.equal(visible, 'new result');
});

test('a real workspace RPC event invalidates the active view and stale deferred refresh cannot overwrite it', async () => {
  const gate = createLatestRequestGate();
  const older = deferred();
  const updated = deferred();
  let visible = 'before event';
  const publish = (promise) => {
    const request = gate.begin();
    return promise.then((value) => {
      if (request.isCurrent()) visible = value;
    });
  };
  const oldRefresh = publish(older.promise);
  let listener;
  const events = { on(name, handler) { assert.equal(name, 'updated'); listener = handler; return () => { listener = undefined; }; } };
  let refreshes = 0;
  const stop = onWorkspaceUpdated(events, () => '/workspace/project', () => {
    gate.invalidate();
    refreshes++;
    void publish(updated.promise);
  });

  // This is the promise RPC event payload shape: location is on the envelope,
  // while declared data is only { revision }.
  listener({ type: 'rpc.carthagent.workspace.updated', location: { directory: '/workspace/project' }, data: { revision: '42' } });
  listener({ type: 'rpc.carthagent.workspace.updated', location: { directory: '/other/project' }, data: { revision: '43' } });
  assert.equal(refreshes, 1);
  updated.resolve('event-refreshed view');
  await Promise.resolve();
  older.resolve('late stale response');
  await oldRefresh;
  assert.equal(visible, 'event-refreshed view');
  stop();
});

test('bounded delivery DTO preserves stale incomplete status and authoritative locked gate with capped evidence', () => {
  const checks = { returned: 100, total: 101 };
  const delivery = {
    status: 'stale', freshness: 'stale', completion: 'incomplete', gate: 'locked',
    evidence: Array.from({ length: 100 }, (_, index) => ({ id: `check_${index}`, status: index === 99 ? 'stale' : 'fresh' })),
    truncation: { checks, acceptance: { returned: 1, total: 1 }, steps: { returned: 1, total: 1 } },
  };
  const readiness = deliveryReadiness(delivery);
  const rendered = renderDeliveryReadiness(delivery);
  assert.equal(readiness.complete, false);
  assert.match(readiness.status, /completion incomplete · gate locked · freshness stale/);
  assert.match(readiness.status, /partial coverage: checks 100\/101/);
  assert.equal(rendered.gate, 'locked');
  assert.match(rendered.label, /Readiness: incomplete/);
  assert.equal(rendered.coverage, 'partial');
  assert.ok(rendered.sections.includes('checks: 100 of 101 returned'));
  assert.match(rendered.receipts.at(-1), /check_99: stale/);
});

test('capped presentation coverage does not downgrade authoritative ready status or gate', () => {
  const delivery = {
    status: 'verified', freshness: 'current', completion: 'ready', gate: 'open',
    truncation: { architecture: { returned: 100, total: 101 }, checks: { returned: 4, total: 4 } },
  };
  const readiness = deliveryReadiness(delivery);
  const rendered = renderDeliveryReadiness(delivery);
  assert.equal(readiness.complete, true);
  assert.equal(readiness.coverage, 'partial');
  assert.equal(rendered.gate, 'open');
  assert.match(rendered.label, /Readiness: ready/);
  assert.ok(rendered.sections.includes('architecture: 100 of 101 returned'));
});

test('stale check outside the returned cap remains blocked by the authoritative DTO gate', () => {
  const delivery = {
    status: 'stale', freshness: 'stale', completion: 'incomplete', gate: 'locked',
    evidence: Array.from({ length: 100 }, (_, index) => ({ id: `check_${index}`, status: 'fresh' })),
    truncation: { checks: { returned: 100, total: 101 } },
  };
  const rendered = renderDeliveryReadiness(delivery);
  assert.equal(rendered.gate, 'locked');
  assert.equal(rendered.coverage, 'partial');
  assert.match(rendered.label, /Readiness: incomplete/);
  assert.match(rendered.label, /freshness stale/);
});

test('missing coverage metadata and gate are unknown rather than fabricated incomplete or locked', () => {
  const delivery = { completion: 'ready', freshness: 'current' };
  const readiness = deliveryReadiness(delivery);
  const rendered = renderDeliveryReadiness(delivery);
  assert.equal(readiness.complete, true);
  assert.equal(readiness.coverage, 'unknown');
  assert.equal(rendered.gate, 'unknown');
  assert.match(rendered.label, /gate unknown/);
  assert.ok(rendered.sections.includes('Coverage metadata unavailable: completeness cannot be confirmed'));
});
