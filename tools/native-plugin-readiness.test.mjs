import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForPluginActive } from './native-plugin-readiness.mjs';

test('waits through plugin visibility and loading until active', async () => {
  const inventories = [
    { data: [] },
    { data: [{ id: 'carthagent', state: { status: 'loading' } }] },
    { data: [{ id: 'carthagent', state: { status: 'active' } }] },
  ];
  let calls = 0;
  const plugin = await waitForPluginActive('carthagent', {
    listPlugins: async () => inventories[calls++],
    pollIntervalMs: 1,
  });
  assert.equal(plugin.state.status, 'active');
  assert.equal(calls, 3);
});

test('fails immediately with plugin and host diagnostics on initialization error', async () => {
  let calls = 0;
  await assert.rejects(waitForPluginActive('carthagent', {
    listPlugins: async () => {
      calls++;
      return { data: [{ id: 'carthagent', state: { status: 'error', error: 'fixture failure' } }] };
    },
    hostOutput: () => 'host tail fixture',
  }), /carthagent.*error.*fixture failure.*host tail fixture/s);
  assert.equal(calls, 1);
});

test('times out with the last observed plugin states and host diagnostics', async () => {
  await assert.rejects(waitForPluginActive('carthagent', {
    listPlugins: async () => ({ data: [{ id: 'carthagent', state: { status: 'loading' } }] }),
    timeoutMs: 5,
    pollIntervalMs: 1,
    hostOutput: () => 'host tail fixture',
  }), /Timed out.*carthagent.*loading.*host tail fixture/s);
});

test('bounds an in-flight inventory request by readiness deadline', async () => {
  let observedTimeout;
  await assert.rejects(waitForPluginActive('carthagent', {
    listPlugins: async timeoutMs => {
      observedTimeout = timeoutMs;
      await new Promise(done => setTimeout(done, 11));
      throw new DOMException('request timeout', 'TimeoutError');
    },
    timeoutMs: 10,
    hostOutput: () => 'host tail fixture',
  }), /Timed out.*inventory request failed.*host tail fixture/s);
  assert.ok(observedTimeout > 0 && observedTimeout <= 10);
});
