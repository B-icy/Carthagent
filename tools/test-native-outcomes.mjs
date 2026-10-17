#!/usr/bin/env node
/** Native failure/cancellation/concurrent-session acceptance without provider spend. */
import assert from 'node:assert/strict';
import { nativeFixture, streamText } from './native-fixture.mjs';

let admitted;
const pending = new Promise(resolve => { admitted = resolve; });
let disconnected;
const cancelled = new Promise(resolve => { disconnected = resolve; });
const host = await nativeFixture({
  plugin: process.argv[2],
  respond(body, res) {
    // Match the exact user message so title generation stays independent.
    const last = body.messages.at(-1);
    if (last?.role === 'user' && last.content === 'CTG_FIXTURE_FAILURE') {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Deterministic provider rejection', type: 'invalid_request_error' } }));
    } else if (last?.role === 'user' && last.content === 'CTG_FIXTURE_CANCEL') {
      res.once('close', disconnected);
      admitted();
    } else streamText(res);
  },
});

async function bounded(promise, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(message)), 10_000);
    })]);
  } finally { clearTimeout(timer); }
}

try {
  const { client, location, model, request } = host;
  await host.active('carthagent', location);
  const create = title => client.session.create({ location, title, model,
    metadata: { 'carthagent.options': { guide: false } } }, request());
  const [failed, interrupted, healthy] = await Promise.all(['Failure', 'Cancellation', 'Healthy'].map(create));
  await client.session.prompt({ sessionID: failed.id, text: 'CTG_FIXTURE_FAILURE' }, request());
  assert.equal(await host.outcome(failed.id), 'failed');
  const failures = await client.session.context({ sessionID: failed.id }, request());
  assert.equal(failures.filter(message => message.type === 'assistant').at(-1).finish, 'error');
  assert.equal(failures.at(-1).outcome, 'failed');

  await client.session.prompt({ sessionID: interrupted.id, text: 'CTG_FIXTURE_CANCEL' }, request());
  await bounded(pending, 'Cancellable provider request was never issued');
  const queued = await client.session.prompt({ sessionID: interrupted.id, text: 'CTG_FIXTURE_QUEUED', delivery: 'queue', resume: false }, request());
  await client.session.prompt({ sessionID: healthy.id, text: 'Independent healthy request' }, request());
  const started = performance.now();
  await client.session.interrupt({ sessionID: interrupted.id, resume: false }, request(10_000));
  await bounded(cancelled, 'Interrupt did not cancel the underlying provider HTTP request');
  assert.deepEqual(await Promise.all([host.outcome(interrupted.id), host.outcome(healthy.id)]), ['interrupted', 'succeeded']);
  assert.ok((await client.session.inbox.list({ sessionID: interrupted.id }, request())).some(item => item.id === queued.id), 'Queued prompt remains pending after interruption');
  assert.ok(!host.requests.some(body => JSON.stringify(body.messages).includes('CTG_FIXTURE_QUEUED')), 'Queued prompt did not resume execution');
  await client.session.inbox.cancel({ sessionID: interrupted.id, inboxID: queued.id }, request());
  const cancellationMs = Math.round(performance.now() - started);

  // An interrupted session remains usable without restarting its neighbor.
  await client.session.prompt({ sessionID: interrupted.id, text: 'Recover after interruption' }, request());
  assert.equal(await host.outcome(interrupted.id), 'succeeded');
  const history = await client.session.context({ sessionID: interrupted.id }, request());
  assert.ok(history.some(message => message.type === 'idle' && message.outcome === 'interrupted'));
  assert.equal(history.at(-1).outcome, 'succeeded');
  assert.deepEqual(host.providerErrors, []);
  console.log(JSON.stringify({ host: '2.0.32', failure: 'passed', cancellation: 'passed',
    concurrentIsolation: 'passed', recovery: 'passed', queuedInterruption: 'passed', cancellationMs }));
} catch (error) {
  console.error(host.output);
  throw error;
} finally {
  await host.close();
}
