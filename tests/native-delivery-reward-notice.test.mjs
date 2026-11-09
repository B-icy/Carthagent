import test from 'node:test';
import assert from 'node:assert/strict';
import { DELIVERY_REWARD_NOTICE, createDeliveryRewardNotice } from '../plugins/carthagent/src/ui/delivery-reward-notice.mjs';

test('a verified delivery surfaces the reward claim once per run, and never claims by itself', async () => {
  const notices = [];
  let delivery = { status: 'verified', runId: 'run-1' };
  const lookups = [];
  const notice = createDeliveryRewardNotice({
    delivery: async sessionID => { lookups.push(sessionID); return delivery; },
    notify: (message, sessionID) => notices.push([message, sessionID]),
  });
  assert.equal(await notice.onSucceeded({ data: { sessionID: 's1' } }), true);
  assert.deepEqual(notices, [[DELIVERY_REWARD_NOTICE, 's1']]);
  assert.match(DELIVERY_REWARD_NOTICE, /\/voyages claim/);
  // Later turns in the same run do not repeat it.
  assert.equal(await notice.onSucceeded({ data: { sessionID: 's1' } }), false);
  // A new verified run does.
  delivery = { status: 'verified', runId: 'run-2' };
  assert.equal(await notice.onSucceeded({ data: { sessionID: 's1' } }), true);
  assert.equal(notices.length, 2);
});

test('unverified, missing or failing deliveries stay quiet', async () => {
  const notices = [];
  const results = [{ status: 'blocked', runId: 'r' }, { status: 'unavailable' }, { status: 'verified' }, undefined];
  const notice = createDeliveryRewardNotice({
    delivery: async () => { if (!results.length) throw new Error('rpc down'); return results.shift(); },
    notify: message => notices.push(message),
  });
  for (let i = 0; i < 5; i++) assert.equal(await notice.onSucceeded({ data: { sessionID: 's' } }), false);
  assert.equal(await notice.onSucceeded({}), false);
  assert.deepEqual(notices, []);
});

test('bursts of completion events for one session share one lookup', async () => {
  let calls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const notice = createDeliveryRewardNotice({
    delivery: async () => { calls++; await gate; return { status: 'verified', runId: 'r' }; },
    notify: () => {},
  });
  const first = notice.onSucceeded({ data: { sessionID: 's' } });
  const second = notice.onSucceeded({ data: { sessionID: 's' } });
  release();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(calls, 1);
});
