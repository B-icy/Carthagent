import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewKickoff } from '../lib/review.mjs';
import { createNativeReviewConsumer, nativeReviewMode, sendNativeReviewKickoff, subscribeNativeReviewEvents } from '../plugins/carthagent/src/ui/native-review.mjs';

const execution = (id, sessionID) => ({ id, data: { sessionID } });
const changed = [{ file: 'src/change.ts', additions: 1, deletions: 0, status: 'modified', patch: '@@ change' }];

function makeDiff() {
  const calls = new Map();
  return async (sessionID, signal) => {
    signal?.throwIfAborted();
    const count = (calls.get(sessionID) ?? 0) + 1;
    calls.set(sessionID, count);
    return count % 2 === 1 ? [] : changed;
  };
}

test('native prompt payload is the legacy PR-review kickoff and only bypasses framing', async () => {
  let request;
  const signal = new AbortController().signal;
  await sendNativeReviewKickoff({
    client: { session: { async prompt(input, options) { request = { input, options }; } } },
    sessionID: 'working-session', signal,
  });
  assert.equal(request.input.sessionID, 'working-session');
  assert.equal(request.input.text, reviewKickoff());
  assert.match(request.input.text, /gh pr create/);
  assert.match(request.input.text, /ctg\.mjs" review <pr-number-or-url>/);
  assert.deepEqual(request.input.metadata, { 'ctg.raw': true, 'ctg.reviewKickoff': true });
  assert.equal(request.options.signal, signal);
});

test('session explicit review mode overrides profile; launch mode overrides both', () => {
  const session = { metadata: { 'carthagent.options': { review: 'yes' } } };
  assert.equal(nativeReviewMode(session, { review: 'no' }), 'yes');
  assert.equal(nativeReviewMode(session, { review: 'yes' }, 'no'), 'no');
  assert.equal(nativeReviewMode({}, { review: 'no' }), 'no');
  assert.equal(nativeReviewMode({}, {}), 'ask');
});

test('ask confirmation is current-run-bound and one-shot; a later run invalidates the old offer', async () => {
  const offers = [];
  const kickoffs = [];
  const consumer = createNativeReviewConsumer({
    mode: () => 'ask', diff: makeDiff(), offer: async (offer) => offers.push(offer),
    kickoff: async (sessionID) => kickoffs.push(sessionID),
  });
  consumer.onStarted(execution('run-1', 'session-a'));
  await consumer.onSucceeded(execution('run-1', 'session-a'));
  assert.equal(offers.length, 1);
  consumer.onStarted(execution('run-2', 'session-a'));
  assert.equal(await offers[0].start(), false, 'older confirmation cannot start after a new run');
  await consumer.onSucceeded(execution('run-2', 'session-a'));
  assert.equal(offers.length, 2);
  assert.equal(await offers[1].start(), true);
  assert.equal(await offers[1].start(), false, 'confirmation closure admits exactly once');
  assert.deepEqual(kickoffs, ['session-a']);
});

test('yes kicks off only successful new-change runs and suppresses only that session loop', async () => {
  const loops = new Set();
  const started = [];
  const consumer = createNativeReviewConsumer({
    mode: () => 'yes', diff: makeDiff(), offer: async () => assert.fail('yes does not prompt'),
    kickoff: async (sessionID) => started.push(sessionID),
    isLoopActive: (sessionID) => loops.has(sessionID),
    setLoopActive: (sessionID, active) => active ? loops.add(sessionID) : loops.delete(sessionID),
  });
  consumer.onStarted(execution('run-a1', 'session-a'));
  consumer.onStarted(execution('run-b1', 'session-b'));
  await Promise.all([
    consumer.onSucceeded(execution('run-a1', 'session-a')),
    consumer.onSucceeded(execution('run-b1', 'session-b')),
  ]);
  assert.deepEqual(started.sort(), ['session-a', 'session-b'], 'one session loop must not suppress an unrelated session');
  assert.ok(loops.has('session-a') && loops.has('session-b'));
  consumer.onUserPromptAdmitted('session-a', { type: 'user', metadata: {} });
  assert.equal(loops.has('session-a'), false, 'admitted user prompt exits the session loop state');
  assert.equal(loops.has('session-b'), true, 'unrelated session loop state remains active');
  consumer.onStarted(execution('run-a2', 'session-a'));
  consumer.onStarted(execution('run-b2', 'session-b'));
  await Promise.all([
    consumer.onSucceeded(execution('run-a2', 'session-a')),
    consumer.onSucceeded(execution('run-b2', 'session-b')),
  ]);
  assert.equal(started.length, 3, 'only session-a may re-enter a loop after a new user prompt');
});

test('inbox.delivered resets restored loop only for the admitted message, not auto-review kickoff', async () => {
  const persisted = new Set(['session-restored', 'session-kickoff']);
  const messages = new Map();
  const consumer = createNativeReviewConsumer({
    mode: () => 'no', diff: async () => [], offer: async () => {}, kickoff: async () => {},
    isLoopActive: (sessionID) => persisted.has(sessionID),
    setLoopActive: (sessionID, active) => active ? persisted.add(sessionID) : persisted.delete(sessionID),
  });
  const handlers = new Map();
  const cleanups = subscribeNativeReviewEvents(
    { on(type, handler) { handlers.set(type, handler); return () => {}; } },
    consumer,
    assert.fail,
    async (sessionID, messageID) => messages.get(`${sessionID}:${messageID}`),
  );

  messages.set('session-restored:user-2', { type: 'user', metadata: {} });
  handlers.get('session.inbox.delivered')({ data: { sessionID: 'session-restored', inboxID: 'user-2' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(persisted.has('session-restored'), false, 'restored session loop state is explicitly persisted as cleared');
  messages.set('session-kickoff:review-1', { type: 'user', metadata: { 'ctg.raw': true, 'ctg.reviewKickoff': true } });
  handlers.get('session.inbox.delivered')({ data: { sessionID: 'session-kickoff', inboxID: 'review-1' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(persisted.has('session-kickoff'), true, 'review kickoff does not clear its own loop suppression');

  cleanups.forEach((cleanup) => cleanup());
  consumer.dispose();
});

test('execution.started does not use stale cached message state; inbox deliveries distinguish kickoff then user and coalesced work', async () => {
  const persisted = new Set(['session-a']);
  const messages = new Map([
    ['session-a:kickoff', { type: 'user', metadata: { 'ctg.raw': true, 'ctg.reviewKickoff': true } }],
    ['session-a:user-1', { type: 'user', metadata: {} }],
    ['session-a:user-2', { type: 'user', metadata: {} }],
    ['session-a:assistant', { type: 'assistant', metadata: {} }],
  ]);
  const writes = [];
  const consumer = createNativeReviewConsumer({
    mode: () => 'no', diff: async () => [], offer: async () => {}, kickoff: async () => {},
    isLoopActive: (sessionID) => persisted.has(sessionID),
    setLoopActive: (sessionID, active) => { writes.push([sessionID, active]); if (active) persisted.add(sessionID); else persisted.delete(sessionID); },
  });
  const handlers = new Map();
  const cleanups = subscribeNativeReviewEvents(
    { on(type, handler) { handlers.set(type, handler); return () => {}; } }, consumer, assert.fail,
    async (sessionID, messageID) => messages.get(`${sessionID}:${messageID}`),
  );
  // The execution-start lifecycle fires first; it must not inspect an old
  // cached message and reset this restored loop.
  handlers.get('session.execution.started')(execution('run-1', 'session-a'));
  assert.deepEqual(writes, []);
  handlers.get('session.inbox.delivered')({ data: { sessionID: 'session-a', inboxID: 'kickoff' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, [], 'kickoff delivery preserves suppression');

  // Multiple queued user messages are distinct admissions even if the host
  // coalesces them into one later execution.started event.
  handlers.get('session.inbox.delivered')({ data: { sessionID: 'session-a', inboxID: 'user-1' } });
  handlers.get('session.inbox.delivered')({ data: { sessionID: 'session-a', inboxID: 'user-2' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, [['session-a', false]], 'restored state is persisted cleared once on real user admission');
  assert.equal(persisted.has('session-a'), false);

  handlers.get('session.inbox.delivered')({ data: { sessionID: 'session-a', inboxID: 'assistant' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, [['session-a', false]], 'non-user delivered message is ignored');
  cleanups.forEach((cleanup) => cleanup());
  consumer.dispose();
});

test('failed/interrupted and unchanged executions do not launch a workflow', async () => {
  const starts = [];
  const consumer = createNativeReviewConsumer({
    mode: () => 'yes', diff: async () => [], offer: async () => assert.fail(),
    kickoff: async (sessionID) => starts.push(sessionID),
  });
  consumer.onStarted(execution('failed', 'failed'));
  await consumer.onFailed(execution('failed', 'failed'));
  consumer.onStarted(execution('interrupted', 'interrupted'));
  await consumer.onInterrupted(execution('interrupted', 'interrupted'));
  consumer.onStarted(execution('unchanged', 'unchanged'));
  await consumer.onSucceeded(execution('unchanged', 'unchanged'));
  assert.deepEqual(starts, []);
});

test('host execution subscriptions are disposed and plugin shutdown blocks pending review admission', async () => {
  const handlers = new Map();
  const unsubscribed = [];
  const data = { on(type, handler) { handlers.set(type, handler); return () => unsubscribed.push(type); } };
  const offers = [];
  const consumer = createNativeReviewConsumer({ mode: () => 'ask', diff: makeDiff(), offer: async (value) => offers.push(value), kickoff: async () => {} });
  const cleanups = subscribeNativeReviewEvents(data, consumer);
  handlers.get('session.execution.started')(execution('run', 'session'));
  handlers.get('session.execution.succeeded')(execution('run', 'session'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(offers.length, 1);
  consumer.dispose();
  assert.equal(await offers[0].start(), false);
  cleanups.forEach((cleanup) => cleanup());
  assert.equal(unsubscribed.length, 5);
});
