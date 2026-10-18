import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeReviewConsumer, subscribeNativeReviewEvents } from '../plugins/carthagent/src/ui/native-review.mjs';

const execution = (id, sessionID) => ({ id, data: { sessionID } });

test('ask offers once after a successful changed run, scoped to its session', async () => {
  const offers = [];
  const starts = [];
  const diffCalls = new Map();
  const consumer = createNativeReviewConsumer({
    mode: () => 'ask',
    diff: async (sessionID) => {
      const count = (diffCalls.get(sessionID) ?? 0) + 1;
      diffCalls.set(sessionID, count);
      return sessionID === 'changed' && count > 1 ? [{ file: 'a.ts', additions: 2, deletions: 0, status: 'modified', patch: '@@ changed' }] : [];
    },
    offer: async (offer) => offers.push(offer),
    startReview: async (sessionID) => { starts.push(sessionID); return 'review-session'; },
  });
  consumer.onStarted(execution('run-1', 'failed'));
  consumer.onStarted(execution('run-2', 'empty'));
  await consumer.onSucceeded(execution('run-2', 'empty'));
  await consumer.onFailed(execution('run-1', 'failed'));
  assert.equal(offers.length, 0, 'failed runs cannot prompt');
  consumer.onStarted(execution('run-3', 'changed'));
  await consumer.onSucceeded(execution('run-3', 'changed'));
  await consumer.onSucceeded(execution('duplicate', 'changed'));
  assert.equal(offers.length, 1);
  assert.equal(offers[0].writes, 1);
  assert.equal(offers[0].sessionID, 'changed');
  await offers[0].start();
  assert.deepEqual(starts, ['changed']);
});

test('yes auto-starts once only for successful evidence-bearing runs; no suppresses', async () => {
  let mode = 'yes';
  const starts = [];
  const diffCalls = new Map();
  const consumer = createNativeReviewConsumer({
    mode: () => mode,
    diff: async (sessionID) => {
      const count = (diffCalls.get(sessionID) ?? 0) + 1;
      diffCalls.set(sessionID, count);
      return sessionID === 'changed' && count > 1 ? [{ file: 'a.ts', additions: 1, deletions: 0, status: 'modified', patch: '@@ changed' }] : [];
    },
    offer: async () => assert.fail('yes/no modes do not prompt'),
    startReview: async (sessionID) => { starts.push(sessionID); return 'review-session'; },
  });
  consumer.onStarted(execution('run-1', 'changed'));
  await consumer.onSucceeded(execution('run-1', 'changed'));
  consumer.onStarted(execution('run-2', 'empty'));
  await consumer.onSucceeded(execution('run-2', 'empty'));
  consumer.onStarted(execution('run-3', 'cancelled'));
  await consumer.onInterrupted(execution('run-3', 'cancelled'));
  mode = 'no';
  consumer.onStarted(execution('run-4', 'changed-again'));
  await consumer.onSucceeded(execution('run-4', 'changed-again'));
  assert.deepEqual(starts, ['changed']);
});

test('manual review session events are ignored to prevent reviewer loops', async () => {
  let calls = 0;
  const consumer = createNativeReviewConsumer({
    mode: () => 'yes',
    diff: async () => [{ file: 'a', additions: 1, deletions: 0, status: 'modified', patch: '@@ change' }],
    offer: async () => {},
    startReview: async () => { calls++; },
  });
  consumer.ignoreSession('manual');
  consumer.onStarted(execution('run', 'manual'));
  await consumer.onSucceeded(execution('run', 'manual'));
  assert.equal(calls, 0);
});

test('host event subscriptions correlate execution lifecycle with the real session diff API', async () => {
  const handlers = new Map();
  const unsubscribed = [];
  const data = { on(type, handler) { handlers.set(type, handler); return () => unsubscribed.push(type); } };
  const offers = [];
  const diffs = [];
  const diff = async (sessionID) => {
    diffs.push(sessionID);
    return diffs.filter((id) => id === sessionID).length === 1 ? [] : [{ file: 'src/change.ts', additions: 1, deletions: 0, status: 'modified', patch: '@@ -0,0 +1 @@' }];
  };
  const consumer = createNativeReviewConsumer({
    mode: () => 'ask',
    diff,
    offer: async (value) => offers.push(value),
    startReview: async () => 'review-session',
  });
  const cleanups = subscribeNativeReviewEvents(data, consumer, (error) => { throw error; });
  handlers.get('session.execution.started')(execution('event-run', 'session-a'));
  handlers.get('session.execution.succeeded')(execution('event-run', 'session-a'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(diffs, ['session-a', 'session-a']);
  assert.equal(offers.length, 1);
  cleanups.forEach((cleanup) => cleanup());
  assert.equal(unsubscribed.length, 4);
});
