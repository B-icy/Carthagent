import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDailyQuestsState, dailyErrorCode, dailySubmissionLabel } from '../plugins/carthagent/src/ui/daily-quests-state.mjs';
import { dailyRequest } from '../plugins/carthagent/src/daily-evidence.mjs';
import { dailyCancellationNotice, handleDailyQuestsEvent } from '../plugins/carthagent/src/ui/daily-quests-events.mjs';

const ACCOUNT = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const QUEST = '11111111-1111-4111-8111-111111111111';
const SUB = '22222222-2222-4222-8222-222222222222';
const NEXT = '33333333-3333-4333-8333-333333333333';
const clone = value => JSON.parse(JSON.stringify(value));
const evidence = () => ({ projectId: QUEST, outcomeId: SUB, runId: NEXT, revision: 'a'.repeat(40), goal: ' Verify a selected change ', change: 'A bounded change', checks: [{ name: 'unit', before: 'failed', after: 'passed', revision: 'a'.repeat(40), result: '1 passing check' }], findings: [] });
const quest = (id = QUEST) => ({ id, status: 'open', definition: { title: 'Selected quest' } });
const submission = (status = 'queued', decision = null) => ({ id: SUB, questId: QUEST, status, decision, rewards: false, assessmentBasis: 'tui_submitted', nextAttemptAt: null, errorCode: null });
const record = () => ({ id: SUB, questId: QUEST, createdAt: '2026-01-01', request: dailyRequest(SUB, evidence()), submission: null });
const snapshot = () => ({ accountKey: ACCOUNT, slate: { day: '2026-01-01', items: [quest()] }, records: [] });
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const rpcError = (code = 'network_error') => ({ type: 'dailyQuestError', message: 'secret credential and raw payload', data: { code, uncertain: true, status: 0 } });

function fixture(overrides = {}, options = {}) {
  const reads = [];
  const writes = [];
  const history = [];
  let remote = snapshot();
  let latest;
  const api = {
    snapshot: async signal => { reads.push(['snapshot', signal]); return clone(remote); },
    detail: async ({ id }, signal) => { reads.push(['detail', id, signal]); return { ...quest(id), latestSubmission: clone(remote.records.find(entry => entry.questId === id)?.submission ?? null) }; },
    submit: async (input, signal) => {
      writes.push(['submit', clone(input), signal]);
      remote.records.push({ id: input.id, questId: input.questId, request: { id: input.id, consent: input.consent, evidence: clone(input.evidence) }, submission: submission() });
      return { submission: submission() };
    },
    retry: async (input, signal) => { writes.push(['retry', clone(input), signal]); return { submission: submission() }; },
    poll: async (input, signal) => { reads.push(['poll', input.id, signal]); return { submission: submission() }; },
    forgetPayload: async (input, signal) => { writes.push(['forget', clone(input), signal]); remote.records.find(entry => entry.id === input.id).request = null; return { ok: true }; },
    ...overrides,
  };
  const controller = createDailyQuestsState({ api, changed: next => { latest = next; history.push(next); }, ...options });
  return { controller, api, reads, writes, history, view: () => latest, remote: () => remote, setRemote: next => { remote = next; } };
}
async function compose(f) {
  await f.controller.refresh();
  await f.controller.select(QUEST);
  await f.controller.compose(async () => ({ id: SUB, evidence: evidence(), provenance: 'Selected local result; review before sharing.' }));
}
async function preview(f) { await compose(f); f.controller.preview(); }

// Model the pinned SelectRenderable's numeric-index retention/clamping. The
// production helper must call its real setSelectedIndex before options shrink.
function eventPage(f, { selectedIndex = 4, interrupted = true } = {}) {
  let options = ['refresh', 'signin', 'back', 'quest', 'submit'];
  let notice = '';
  let closed = 0;
  const order = [];
  const collapse = () => { options = options.slice(0, 3); selectedIndex = Math.min(selectedIndex, options.length - 1); };
  const actions = {
    isDestroyed: false,
    setSelectedIndex(index) {
      order.push('reset');
      assert.ok(f.view().snapshot, 'reset happens before protected state is cleared');
      if (index >= 0 && index < options.length) selectedIndex = index;
    },
  };
  const handle = (event, changedLocation = false) => handleDailyQuestsEvent({
    controller: {
      invalidate: () => { order.push('invalidate'); f.controller.invalidate(); collapse(); },
      refresh: () => { order.push('refresh'); return f.controller.refresh(); },
    },
    event, location: { directory: '/selected', workspaceID: 'w1' }, changedLocation, interrupted, actions,
    clearReplay: () => { order.push('clearReplay'); collapse(); },
    closeDialog: () => { order.push('closeDialog'); closed++; },
    notice: text => { notice = text; },
  });
  return { handle, actions, order, notice: () => notice, closed: () => closed, selected: () => options[selectedIndex] };
}

for (const event of [
  { type: 'credential.switched', data: { integrationID: 'experiential-labs' } },
  { type: 'credential.updated' }, { type: 'provider.updated' },
  { type: 'integration.updated' }, { type: 'server.connected' }, { type: 'server.disconnected' },
  { type: 'session.updated', changedLocation: true },
  { type: 'server.disconnected', changedLocation: true },
]) {
  test(`daily ${event.type}${event.changedLocation ? ' with changed location' : ''} cancels confirmation and resets late Enter to Refresh`, async () => {
    const f = fixture();
    await preview(f);
    const confirmation = deferred(), next = deferred();
    let live;
    const submitting = f.controller.submit((_shown, isLive) => { live = isLive; return confirmation.promise; });
    assert.equal(f.view().busy, true);
    const page = eventPage(f);
    f.api.snapshot = () => next.promise;
    const refreshing = page.handle(event, event.changedLocation);
    assert.equal(live(), false);
    assert.equal(f.view().snapshot, undefined);
    assert.equal(f.view().draft, undefined);
    assert.equal(f.view().preview, undefined);
    assert.equal(f.view().detail, undefined);
    assert.equal(page.closed(), 1);
    assert.deepEqual(page.order.slice(0, 4), ['reset', 'clearReplay', 'invalidate', 'closeDialog']);
    assert.equal(page.selected(), 'refresh', 'delayed Enter cannot activate Back');
    assert.equal(page.notice(), dailyCancellationNotice);
    const clearing = event.type === 'server.disconnected';
    assert.equal(f.view().busy, !clearing);
    confirmation.resolve(true);
    await submitting;
    assert.deepEqual(f.writes, [], 'a late true consent must never call api.submit');
    assert.equal(f.view().busy, !clearing, 'stale callback cannot unlock the new refresh');
    next.resolve({ ...snapshot(), accountKey: OTHER });
    await refreshing;
    assert.equal(f.view().busy, false);
    assert.equal(f.view().snapshot?.accountKey, clearing ? undefined : OTHER);
    assert.equal(page.notice(), dailyCancellationNotice, 'notice survives background refresh');
    f.controller.dispose();
  });
}

test('unrelated or differently scoped events leave confirmation, selection and notice untouched', async () => {
  const f = fixture();
  await preview(f);
  const confirmation = deferred();
  const pending = f.controller.submit(() => confirmation.promise);
  const page = eventPage(f);
  for (const event of [
    { type: 'session.updated' },
    { type: 'credential.switched', data: { integrationID: 'anthropic' } },
    { type: 'provider.updated', location: { directory: '/other', workspaceID: 'w1' } },
    { type: 'credential.updated', location: { directory: '/selected', workspaceID: 'w2' } },
  ]) await page.handle(event);
  assert.equal(f.view().busy, true);
  assert.equal(f.view().phase, 'preview');
  assert.equal(page.selected(), 'submit');
  assert.deepEqual(page.order, []);
  assert.equal(page.notice(), '');
  assert.equal(page.closed(), 0);
  confirmation.resolve(false);
  await pending;
  assert.deepEqual(f.writes, []);
  f.controller.dispose();
});

test('event during dispatched submit aborts UI lifetime without claiming it withdrew evidence or replaying', async () => {
  const f = fixture();
  await preview(f);
  const sent = deferred(), result = deferred();
  let signal;
  f.api.submit = async (input, abortSignal) => {
    signal = abortSignal;
    f.writes.push(['submit', clone(input)]);
    // Model the durable journal written before the request was dispatched.
    f.remote().records.push(record());
    sent.resolve();
    return result.promise;
  };
  const pending = f.controller.submit(async () => true);
  await sent.promise;
  const page = eventPage(f);
  await page.handle({ type: 'credential.updated' });
  assert.equal(signal.aborted, true);
  assert.equal(page.selected(), 'refresh');
  assert.match(page.notice(), /Nothing was resent automatically/);
  assert.match(page.notice(), /check the recovery journal for any request already started/);
  assert.doesNotMatch(page.notice(), /nothing (?:was )?(?:sent|uploaded)|no (?:upload|request was sent)/i);
  assert.equal(f.view().draft, undefined);
  assert.equal(f.view().preview, undefined);
  assert.equal(f.view().snapshot.records[0].id, SUB);
  assert.equal(f.view().snapshot.records[0].submission, null);
  const reads = f.reads.length;
  result.resolve({ submission: submission('graded', 'assessed_complete') });
  await pending;
  assert.equal(f.reads.length, reads, 'no stale reconciliation after the late result');
  assert.equal(f.writes.length, 1, 'never resubmit an already-started request');
  assert.equal(f.view().snapshot.records[0].submission, null, 'no success assumed');
  assert.equal(f.view().busy, false);
  f.controller.dispose();
});

test('compose and recovery dialogs are canceled even without an evidence draft', async () => {
  for (const action of ['compose', 'retry', 'forget']) {
    const f = fixture();
    f.remote().records.push(record());
    await f.controller.refresh();
    await f.controller.select(QUEST);
    const waiting = deferred();
    const callback = () => waiting.promise;
    const pending = action === 'compose' ? f.controller.compose(callback) : f.controller[action](SUB, callback);
    assert.equal(f.view().draft, undefined);
    const page = eventPage(f);
    await page.handle({ type: 'credential.updated' });
    waiting.resolve(action === 'compose' ? { id: SUB, evidence: evidence() } : true);
    await pending;
    assert.equal(page.closed(), 1);
    assert.equal(page.notice(), dailyCancellationNotice);
    assert.equal(page.selected(), 'refresh');
    assert.deepEqual(f.writes, []);
    assert.equal(f.view().draft, undefined);
    f.controller.dispose();
  }
});

for (const phase of ['edit', 'preview', 'replay']) {
  test(`background invalidation visibly cancels ${phase} even without an active dialog`, async () => {
    const f = fixture();
    if (phase === 'replay') { f.remote().records.push(record()); await f.controller.refresh(); }
    else if (phase === 'edit') await compose(f);
    else await preview(f);
    assert.equal(f.view().busy, false);
    const page = eventPage(f);
    await page.handle({ type: 'server.disconnected' });
    assert.equal(page.notice(), dailyCancellationNotice);
    assert.equal(page.selected(), 'refresh');
    assert.equal(f.view().snapshot, undefined);
    assert.equal(f.view().draft, undefined);
    assert.equal(f.view().preview, undefined);
    assert.deepEqual(f.writes, []);
    f.controller.dispose();
  });
}

test('ordinary background refresh needs no cancellation notice', async () => {
  const f = fixture();
  await f.controller.refresh();
  const page = eventPage(f, { interrupted: false });
  await page.handle({ type: 'credential.updated' });
  assert.equal(page.notice(), '');
  assert.equal(page.selected(), 'refresh');
  assert.ok(f.view().snapshot);
  f.controller.dispose();
});

test('destroyed actions are never touched during background refresh', async () => {
  const f = fixture();
  await f.controller.refresh();
  const page = eventPage(f, { interrupted: false });
  page.actions.isDestroyed = true;
  await page.handle({ type: 'credential.updated' });
  assert.equal(page.notice(), '');
  assert.equal(page.order.includes('reset'), false);
  assert.ok(f.view().snapshot);
  f.controller.dispose();
});

test('selecting accepted detail immediately erases matching in-memory recovery evidence', async () => {
  const accepted = submission();
  const f = fixture({ detail: async () => ({ ...quest(), latestSubmission: accepted }) });
  f.remote().records.push({ ...record(), submission: null });
  await f.controller.refresh();
  assert.ok(f.view().snapshot.records[0].request);
  await f.controller.select(QUEST);
  assert.equal(f.view().detail.latestSubmission.status, 'queued');
  assert.equal(f.view().snapshot.records[0].request, null);
  assert.deepEqual(f.view().snapshot.records[0].submission, accepted);
  let confirmed = false;
  await f.controller.retry(SUB, async () => { confirmed = true; return true; });
  assert.equal(confirmed, false);
  assert.deepEqual(f.writes, []);
  f.controller.dispose();
});

test('compose, preview and refresh only read; explicit cancellation performs zero writes', async () => {
  const f = fixture();
  await f.controller.refresh();
  await f.controller.select(QUEST);
  let args;
  await f.controller.compose(async (...values) => { args = values; return undefined; });
  assert.equal(args[0].id, QUEST);
  assert.equal(args[1](), true);
  assert.ok(args[2] instanceof AbortSignal);
  assert.equal(f.view().draft, undefined);
  await preview(f);
  assert.equal(f.view().phase, 'preview');
  await f.controller.submit(async () => false);
  f.controller.cancelDraft();
  f.remote().records.push(record());
  await f.controller.refresh();
  await f.controller.retry(SUB, async () => false);
  await f.controller.forget(SUB, async (_record, live) => {
    assert.equal(live(), true);
    return false;
  });
  assert.deepEqual(f.writes, []);
  assert.equal(f.reads.some(entry => entry[0] === 'poll'), false);
  assert.equal(f.view().phase, 'overview');
});

test('draft validation is local, bounded and correctable; edit/back discard consent', async () => {
  const f = fixture();
  await compose(f);
  const before = f.reads.length;
  for (const text of ['{bad secret', JSON.stringify({ ...evidence(), change: 'x'.repeat(3073) }), JSON.stringify({ ...evidence(), unknown: true }), JSON.stringify({ ...evidence(), checks: Array(13).fill(evidence().checks[0]) })]) {
    f.controller.edit(text);
    f.controller.preview();
    assert.equal(f.view().phase, 'edit');
    assert.equal(f.view().preview, undefined);
    assert.equal(f.view().draft.text, text);
    assert.match(f.view().error, /^invalid_daily_evidence\./);
    assert.doesNotMatch(f.view().error, /secret/);
    await f.controller.submit(async () => { assert.fail('invalid preview must not confirm'); });
  }
  f.controller.edit(JSON.stringify(evidence()));
  f.controller.preview();
  assert.equal(f.view().draft.text, JSON.stringify(dailyRequest(SUB, evidence()).evidence, null, 2));
  assert.equal(f.view().draft.provenance, 'Selected local result; review before sharing.');
  assert.equal(f.view().preview.consent, true);
  f.controller.edit(f.view().draft.text);
  assert.equal(f.view().preview, undefined);
  f.controller.preview();
  f.controller.backToEdit();
  assert.equal(f.view().preview, undefined);
  assert.equal(f.view().phase, 'edit');
  assert.equal(f.reads.length, before);
  assert.deepEqual(f.writes, []);
});

test('emitted snapshots, drafts and previews are detached from authoritative controller data', async () => {
  const f = fixture();
  await preview(f);
  const expected = dailyRequest(SUB, evidence());
  f.view().snapshot.accountKey = OTHER;
  f.view().snapshot.slate.items.length = 0;
  f.view().detail.id = NEXT;
  f.view().draft.id = NEXT;
  f.view().preview.evidence.change = 'Injected mutable output';
  await f.controller.submit(async shown => {
    assert.deepEqual(shown.request, expected);
    assert.equal(shown.quest.id, QUEST);
    assert.ok(Object.isFrozen(shown.request.evidence));
    try { shown.request.evidence.change = 'Changed in confirmation'; } catch {}
    shown.request = dailyRequest(NEXT, { ...evidence(), change: 'Replacement' });
    return true;
  });
  assert.deepEqual(f.writes[0][1], { accountKey: ACCOUNT, questId: QUEST, ...expected });
  assert.equal(f.writes.length, 1);
  assert.equal(f.view().draft, undefined);
  assert.equal(f.view().preview, undefined);
  assert.equal(f.view().detail.latestSubmission.status, 'queued');
});

test('confirmation requires literal true; compose requires selected open authoritative detail', async () => {
  const f = fixture();
  await f.controller.compose(async () => { assert.fail('missing detail'); });
  await f.controller.refresh();
  await f.controller.select(NEXT);
  assert.equal(f.reads.filter(entry => entry[0] === 'detail').length, 0);
  await f.controller.select(QUEST);
  f.api.detail = async () => ({ ...quest(), status: 'assessed_complete', latestSubmission: null });
  await f.controller.select(QUEST);
  await f.controller.compose(async () => { assert.fail('closed quest'); });
  f.api.detail = async () => ({ ...quest(), latestSubmission: null });
  await preview(f);
  for (const result of [undefined, 1, 'yes', {}, false]) await f.controller.submit(async () => result);
  assert.deepEqual(f.writes, []);
});

test('selecting another known quest clears draft and reads detail, never fabricates it', async () => {
  const f = fixture();
  f.remote().slate.items.push(quest(NEXT));
  await preview(f);
  await f.controller.select(NEXT);
  assert.equal(f.view().detail.id, NEXT);
  assert.equal(f.view().draft, undefined);
  assert.equal(f.view().preview, undefined);
  assert.equal(f.view().phase, 'overview');
  assert.equal(f.writes.length, 0);
});

test('busy guard does not enqueue edits, refreshes, selections or writes', async () => {
  const f = fixture();
  await preview(f);
  const waiting = deferred();
  const text = f.view().draft.text;
  const reads = f.reads.length;
  const pending = f.controller.submit(() => waiting.promise);
  assert.equal(f.view().busy, true);
  f.controller.edit('changed');
  f.controller.preview();
  await f.controller.refresh();
  await f.controller.select(QUEST);
  await f.controller.compose(async () => { assert.fail('busy compose'); });
  await f.controller.submit(async () => { assert.fail('busy submit'); });
  await f.controller.retry(SUB, async () => { assert.fail('busy retry'); });
  await f.controller.forget(SUB, async () => { assert.fail('busy forget'); });
  await f.controller.poll(SUB);
  assert.equal(f.view().draft.text, text);
  assert.equal(f.reads.length, reads);
  waiting.resolve(true);
  await pending;
  assert.equal(f.writes.length, 1);
  assert.equal(f.view().busy, false);
});

for (const action of ['compose', 'submit', 'retry', 'forget']) {
  for (const cancellation of ['invalidate', 'dispose', 'cancelDraft']) {
    test(`${cancellation} cancels awaited ${action} and prevents writes/stale state`, async () => {
      const f = fixture();
      f.remote().records.push(record());
      await preview(f);
      const waiting = deferred();
      let live;
      let signal;
      const callback = (_shown, isLive, abortSignal) => { live = isLive; signal = abortSignal; return waiting.promise; };
      const pending = action === 'compose' ? f.controller.compose(callback)
        : action === 'submit' ? f.controller.submit(callback)
          : f.controller[action](SUB, callback);
      assert.equal(live(), true);
      f.controller[cancellation]();
      assert.equal(live(), false);
      if (action === 'compose') assert.equal(signal.aborted, true);
      waiting.resolve(action === 'compose' ? { id: SUB, evidence: evidence(), provenance: 'stale' } : true);
      await pending;
      assert.deepEqual(f.writes, []);
      assert.equal(f.view().draft, undefined);
      assert.equal(f.view().preview, undefined);
      assert.equal(f.view().busy, false);
      if (cancellation !== 'cancelDraft') assert.equal(f.view().snapshot, undefined);
    });
  }
}

test('back-to-edit revokes an outstanding submit confirmation', async () => {
  const f = fixture();
  await preview(f);
  const waiting = deferred();
  const pending = f.controller.submit(() => waiting.promise);
  f.controller.backToEdit();
  assert.equal(f.view().phase, 'edit');
  assert.equal(f.view().preview, undefined);
  waiting.resolve(true);
  await pending;
  assert.deepEqual(f.writes, []);
});

test('account switch during confirmation cannot send old evidence; stale GET is ignored', async () => {
  const f = fixture();
  await preview(f);
  const waiting = deferred();
  const pending = f.controller.submit(() => waiting.promise);
  f.controller.invalidate();
  f.setRemote({ ...snapshot(), accountKey: OTHER });
  await f.controller.refresh();
  waiting.resolve(true);
  await pending;
  assert.equal(f.view().snapshot.accountKey, OTHER);
  assert.deepEqual(f.writes, []);
  const oldRead = deferred();
  f.api.snapshot = () => oldRead.promise;
  const stale = f.controller.refresh();
  f.controller.invalidate();
  f.api.snapshot = async () => ({ ...snapshot(), accountKey: ACCOUNT });
  await f.controller.refresh();
  oldRead.resolve({ ...snapshot(), accountKey: OTHER });
  await stale;
  assert.equal(f.view().snapshot.accountKey, ACCOUNT);
});

test('stale selected detail and stale failed requests cannot overwrite new identity', async () => {
  for (const reject of [false, true]) {
    const f = fixture();
    await f.controller.refresh();
    const old = deferred();
    f.api.detail = () => old.promise;
    const pending = f.controller.select(QUEST);
    f.controller.invalidate();
    f.setRemote({ ...snapshot(), accountKey: OTHER });
    await f.controller.refresh();
    if (reject) old.reject(rpcError()); else old.resolve({ ...quest(), latestSubmission: submission() });
    await pending;
    assert.equal(f.view().snapshot.accountKey, OTHER);
    assert.equal(f.view().detail, undefined);
    assert.equal(f.view().error, '');
    assert.equal(f.reads.filter(entry => entry[0] === 'snapshot').length, 2);
  }
});

test('unknown submit clears raw UI then reads exact same-ID journal without replay or assumed success', async () => {
  const f = fixture();
  await preview(f);
  f.api.submit = async (input, signal) => {
    f.writes.push(['submit', clone(input), signal]);
    f.remote().records.push({ ...record(), request: { id: input.id, consent: true, evidence: clone(input.evidence) }, submission: null });
    throw rpcError();
  };
  const start = f.history.length;
  await f.controller.submit(async () => true);
  assert.equal(f.writes.length, 1);
  assert.ok(f.history.slice(start).some(state => state.error && !state.snapshot && !state.detail && !state.draft && !state.preview));
  assert.equal(f.view().draft, undefined);
  assert.equal(f.view().preview, undefined);
  assert.equal(f.view().detail, undefined);
  assert.equal(f.view().snapshot.records[0].id, SUB);
  assert.deepEqual(f.view().snapshot.records[0].request, dailyRequest(SUB, evidence()));
  assert.equal(f.view().snapshot.records[0].submission, null);
  assert.match(f.view().error, /^network_error\..*no success assumed/);
  await f.controller.refresh();
  assert.equal(f.writes.length, 1);
  await f.controller.retry(SUB, async shown => {
    assert.deepEqual(shown.request, dailyRequest(SUB, evidence()));
    assert.ok(Object.isFrozen(shown.request.evidence));
    return true;
  });
  assert.deepEqual(f.writes.map(entry => [entry[0], entry[1].id]), [['submit', SUB], ['retry', SUB]]);
  assert.deepEqual(f.writes[1][1], { accountKey: ACCOUNT, id: SUB });
});

test('unknown failure without a durable record never preserves raw evidence or offers retry', async () => {
  const f = fixture({ submit: async () => { throw rpcError(); } });
  await preview(f);
  await f.controller.submit(async () => true);
  await f.controller.retry(SUB, async () => { assert.fail('no durable payload'); });
  assert.equal(f.view().draft, undefined);
  assert.equal(f.view().preview, undefined);
  assert.deepEqual(f.view().snapshot.records, []);
  assert.deepEqual(f.writes, []);
});

test('auth/conflict errors clear protected state, redact unsafe RPC content and never replay', async () => {
  for (const method of ['submit', 'retry', 'forget']) {
    for (const code of ['unauthorized', 'daily_conflict']) {
      const f = fixture();
      f.remote().records.push(record());
      await preview(f);
      const apiMethod = method === 'forget' ? 'forgetPayload' : method;
      f.api[apiMethod] = async input => { f.writes.push([method, input]); throw rpcError(code); };
      f.api.snapshot = async () => { throw new Error('another private secret'); };
      if (method === 'submit') await f.controller.submit(async () => true);
      else await f.controller[method](SUB, async () => true);
      assert.equal(f.writes.length, 1);
      assert.equal(f.view().snapshot, undefined);
      assert.equal(f.view().detail, undefined);
      assert.equal(f.view().draft, undefined);
      assert.equal(f.view().preview, undefined);
      assert.match(f.view().error, new RegExp(`^${code}\\.`));
      assert.doesNotMatch(f.view().error, /secret|credential and raw/);
    }
  }
});

test('a different account on successful or failed write reconciliation is not old-account success', async () => {
  for (const fail of [false, true]) {
    const f = fixture();
    await preview(f);
    f.api.submit = async input => {
      f.writes.push(['submit', input]);
      f.setRemote({ ...snapshot(), accountKey: OTHER, records: [record()] });
      if (fail) throw rpcError();
      return { submission: submission() };
    };
    await f.controller.submit(async () => true);
    assert.equal(f.writes.length, 1);
    assert.equal(f.view().snapshot, undefined);
    assert.equal(f.view().detail, undefined);
    assert.equal(f.view().draft, undefined);
    assert.match(f.view().error, /^daily_account_changed\./);
    await f.controller.refresh();
    assert.equal(f.view().snapshot.accountKey, OTHER);
    assert.equal(f.view().error, '');
  }
});

test('refresh hides old protected state synchronously and explicit refresh may load a new account', async () => {
  const f = fixture();
  await preview(f);
  const next = deferred();
  f.api.snapshot = () => next.promise;
  const pending = f.controller.refresh();
  assert.equal(f.view().snapshot, undefined);
  assert.equal(f.view().detail, undefined);
  assert.equal(f.view().draft, undefined);
  assert.equal(f.view().preview, undefined);
  next.resolve({ ...snapshot(), accountKey: OTHER });
  await pending;
  assert.equal(f.view().snapshot.accountKey, OTHER);
});

test('retry is ID-bound to the shown saved request, no edited payload or fresh UUID', async () => {
  const f = fixture();
  f.remote().records.push(record());
  await f.controller.refresh();
  await f.controller.retry(SUB, async shown => {
    assert.equal(shown.id, SUB);
    assert.deepEqual(shown.request, dailyRequest(SUB, evidence()));
    f.remote().records.push({ ...record(), id: NEXT, request: dailyRequest(NEXT, evidence()) });
    return true;
  });
  assert.deepEqual(f.writes.map(entry => [entry[0], entry[1]]), [['retry', { accountKey: ACCOUNT, id: SUB }]]);
  assert.equal(f.view().draft, undefined);
  assert.equal(f.view().preview, undefined);
});

test('forget requires a retained request and preserves authoritative metadata and ID', async () => {
  const f = fixture();
  f.remote().records.push(record());
  await f.controller.refresh();
  await f.controller.forget(NEXT, async () => { assert.fail('unknown record'); });
  for (const result of [undefined, 1, 'yes', {}, false]) await f.controller.forget(SUB, async () => result);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.view().snapshot.records[0].request, dailyRequest(SUB, evidence()));
  await f.controller.forget(SUB, async () => true);
  assert.deepEqual(f.writes.map(entry => [entry[0], entry[1]]), [['forget', { accountKey: ACCOUNT, id: SUB }]]);
  assert.equal(f.view().snapshot.records[0].id, SUB);
  assert.equal(f.view().snapshot.records[0].request, null);
  assert.equal(f.view().snapshot.records[0].submission, null);
  await f.controller.forget(SUB, async () => { assert.fail('already forgotten'); });
  await f.controller.retry(SUB, async () => { assert.fail('cannot replay forgotten evidence'); });
  assert.equal(f.writes.length, 1);
});

test('later-midnight saved record can select/poll original quest rather than current slate', async () => {
  const f = fixture();
  f.remote().slate = { day: '2026-01-02', items: [quest(NEXT)] };
  f.remote().records.push(record());
  await f.controller.refresh();
  assert.equal(f.reads.some(entry => entry[0] === 'poll'), false);
  await f.controller.select(QUEST);
  assert.equal(f.view().detail.id, QUEST);
  f.api.poll = async ({ id }) => {
    f.reads.push(['poll', id]);
    f.remote().records[0].submission = submission('graded', 'needs_evidence');
    return { submission: clone(f.remote().records[0].submission) };
  };
  await f.controller.select(NEXT);
  await f.controller.poll(SUB);
  assert.equal(f.view().detail.id, QUEST);
  assert.equal(f.view().detail.latestSubmission.decision, 'needs_evidence');
  assert.equal(f.view().snapshot.records[0].submission.status, 'graded');
  const reads = f.reads.length;
  await f.controller.poll('unknown');
  assert.equal(f.reads.length, reads);
  assert.equal(f.writes.length, 0);
});

test('poll accepts detail.latestSubmission without a saved payload record', async () => {
  const f = fixture({ detail: async ({ id }) => ({ ...quest(id), latestSubmission: submission('grading') }) });
  await f.controller.refresh();
  await f.controller.select(QUEST);
  await f.controller.poll(SUB);
  assert.equal(f.reads.filter(entry => entry[0] === 'poll').length, 1);
  assert.equal(f.view().detail.id, QUEST);
  assert.equal(f.view().detail.latestSubmission.status, 'grading');
  assert.equal(f.writes.length, 0);
});

test('processing failure is not a negative coding assessment; graded does not mean verified complete', () => {
  assert.equal(dailySubmissionLabel(submission()), 'Queued (not completed)');
  assert.equal(dailySubmissionLabel(submission('grading')), 'Grading (not completed)');
  assert.equal(dailySubmissionLabel(submission('failed', 'not_met')), 'Processing failed (not a coding assessment)');
  assert.equal(dailySubmissionLabel(submission('graded', 'assessed_complete')), 'Classifier-assessed complete (not independently verified)');
  assert.equal(dailySubmissionLabel(submission('graded', 'not_met')), 'Graded: not met');
  assert.equal(dailySubmissionLabel(submission('graded', 'needs_evidence')), 'Graded: needs evidence');
  assert.equal(dailySubmissionLabel(submission('graded')), 'Graded: assessment unavailable');
  assert.equal(dailySubmissionLabel({ status: 'secret unknown status' }), 'Submission status unavailable');
});

test('authoritative queued/grading/failed/graded detail is not synthesized from write response', async () => {
  for (const [status, decision] of [['queued', null], ['grading', null], ['failed', null], ['graded', 'not_met'], ['graded', 'assessed_complete']]) {
    const f = fixture();
    await preview(f);
    f.api.submit = async input => {
      f.writes.push(['submit', input]);
      f.remote().records.push({ ...record(), submission: submission(status, decision) });
      return { submission: submission('graded', 'assessed_complete') };
    };
    await f.controller.submit(async () => true);
    assert.equal(f.view().detail.latestSubmission.status, status);
    assert.equal(f.view().detail.latestSubmission.decision, decision);
    assert.equal(f.view().detail.status, 'open');
    assert.equal(f.view().error, '');
    assert.equal(f.view().busy, false);
    assert.equal(f.writes.length, 1);
  }
});

test('only constrained dailyQuestError data codes are renderable', () => {
  assert.equal(dailyErrorCode(rpcError('daily_conflict')), 'daily_conflict');
  for (const error of [new Error('secret'), { type: 'other', data: { code: 'daily_conflict' } }, { type: 'dailyQuestError', data: { code: 'secret text\n' } }, { type: 'dailyQuestError', data: { code: 'secret\n' } }, { type: 'dailyQuestError', data: { code: '' } }, { type: 'dailyQuestError', data: { code: 'x'.repeat(65) } }, { type: 'dailyQuestError', data: { code: '<token>' } }, { type: 'dailyQuestError', data: {} }]) {
    assert.equal(dailyErrorCode(error), 'daily_request_failed');
  }
});

test('human confirmation does not consume network timeout; every request starts a fresh timeout', async () => {
  const timers = [];
  const f = fixture({}, { timeoutSignal: () => { const timer = new AbortController(); timers.push(timer); return timer.signal; } });
  await preview(f);
  const previous = timers.length;
  const waiting = deferred();
  const pending = f.controller.submit(() => waiting.promise);
  assert.equal(timers.length, previous);
  timers.forEach(timer => timer.abort());
  waiting.resolve(true);
  await pending;
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0][2].aborted, false);
  assert.equal(timers.length, previous + 3);
});

test('per-request timeout shows safe failure and read-only reconciliation', async () => {
  const timers = [];
  const started = deferred();
  const f = fixture({}, { timeoutSignal: () => { const timer = new AbortController(); timers.push(timer); return timer.signal; } });
  await preview(f);
  f.api.submit = async (_input, signal) => {
    started.resolve();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  };
  const pending = f.controller.submit(async () => true);
  await started.promise;
  timers.at(-1).abort(new DOMException('secret unsafe timeout', 'TimeoutError'));
  await pending;
  assert.match(f.view().error, /^daily_request_failed\./);
  assert.doesNotMatch(f.view().error, /secret/);
  assert.equal(f.view().draft, undefined);
  assert.equal(f.view().preview, undefined);
  assert.equal(f.view().busy, false);
  assert.equal(f.writes.length, 0);
});

test('cancellation of a dispatched write ignores its late result and never starts stale reconciliation', async () => {
  for (const cancel of ['invalidate', 'dispose']) {
    const f = fixture();
    await preview(f);
    const sent = deferred();
    const result = deferred();
    let signal;
    f.api.submit = async (input, abortSignal) => {
      f.writes.push(['submit', input]); signal = abortSignal; sent.resolve();
      return result.promise;
    };
    const pending = f.controller.submit(async () => true);
    await sent.promise;
    const reads = f.reads.length;
    f.controller[cancel]();
    assert.equal(signal.aborted, true);
    result.resolve({ submission: submission('graded', 'assessed_complete') });
    await pending;
    assert.equal(f.reads.length, reads);
    assert.equal(f.writes.length, 1);
    assert.equal(f.view().snapshot, undefined);
    assert.equal(f.view().detail, undefined);
    assert.equal(f.view().draft, undefined);
    assert.equal(f.view().error, '');
  }
});

test('dispose aborts a pending snapshot and ignores a transport that resolves anyway', async () => {
  const waiting = deferred();
  let signal;
  const f = fixture({ snapshot: abortSignal => { signal = abortSignal; return waiting.promise; } });
  const pending = f.controller.refresh();
  f.controller.dispose();
  assert.equal(signal.aborted, true);
  const events = f.history.length;
  waiting.resolve(snapshot());
  await pending;
  await f.controller.refresh();
  assert.equal(f.history.length, events);
  assert.equal(f.view().snapshot, undefined);
  assert.equal(f.view().busy, false);
});

test('failed explicit retry reconciles same durable payload without a second retry', async () => {
  const f = fixture();
  f.remote().records.push({ ...record(), submission: null });
  await f.controller.refresh();
  f.api.retry = async input => { f.writes.push(['retry', input]); throw rpcError('key_conflict'); };
  await f.controller.retry(SUB, async shown => {
    assert.deepEqual(shown.request, dailyRequest(SUB, evidence()));
    return true;
  });
  assert.deepEqual(f.writes, [['retry', { accountKey: ACCOUNT, id: SUB }]]);
  assert.deepEqual(f.view().snapshot.records[0].request, dailyRequest(SUB, evidence()));
  assert.match(f.view().error, /^key_conflict\./);
  assert.equal(f.view().draft, undefined);
  assert.equal(f.view().preview, undefined);
  await f.controller.refresh();
  assert.equal(f.writes.length, 1);
});
