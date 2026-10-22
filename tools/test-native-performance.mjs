#!/usr/bin/env node
/** Cached workspace RPC latency on the installed native host; not UI latency. */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { nativeFixture } from './native-fixture.mjs';

const host = await nativeFixture({ plugin: process.argv[2] });
try {
  await host.active();
  const snapshot = () => host.client.rpc.call({ rpcID: 'carthagent.workspace', method: 'snapshot',
    input: {}, location: host.location }, host.request());
  await snapshot();
  const latencies = [];
  for (let sample = 0; sample < 30; sample++) {
    const started = performance.now();
    const response = await snapshot();
    latencies.push(performance.now() - started);
    assert.equal(response.output.projects[0].directory, host.cwd);
  }
  const sorted = latencies.toSorted((a, b) => a - b);
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  assert.ok(p95 <= 300, `Cached workspace RPC p95 ${p95.toFixed(1)} ms exceeds 300 ms`);
  console.log(JSON.stringify({ host: '2.0.32', samples: sorted.length,
    cachedWorkspaceRpcP95Ms: Math.round(p95 * 10) / 10, maximumMs: Math.round(sorted.at(-1) * 10) / 10,
    inputLatency: 'not measured by this probe', warmSwitchLatency: 'not measured by this probe' }));
} finally { await host.close(); }
