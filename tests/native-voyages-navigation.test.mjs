import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createVoyagesNavigationState } from '../plugins/carthagent/src/ui/voyages-navigation-state.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const account = { profile: { name: 'Captain', shipName: 'Ship', coins: 10, level: 3, totalXp: 200, config: { private: true }, owned: ['secret'] }, items: [{ private: true }], pending: { quoteId: 'private' } };
const assignments = { accountKey: 'private-account', slate: { day: '2026-10-30', endsAt: '2026-10-31T00:00:00Z', items: [{ id: 'quest-one', definition: { title: 'Protect a boundary', criteria: ['private'] }, status: 'open' }] }, records: [{ request: { evidence: 'private-claim', consent: true } }] };
function fixture(overrides = {}) {
  const updates = [], calls = [];
  const controller = createVoyagesNavigationState({
    changed: (state) => updates.push(structuredClone(state)),
    profile: async (signal) => { calls.push(['profile', signal]); return account; },
    daily: async (signal) => { calls.push(['daily', signal]); return assignments; },
    ...overrides,
  });
  return { controller, calls, updates, last: () => updates.at(-1) };
}

test('navigation loads only when selected, reads once per activation and retains no evidence, consent or purchase state', async () => {
  const f = fixture();
  await f.controller.refresh();
  assert.equal(f.calls.length, 0);
  await f.controller.activate(true);
  assert.deepEqual(f.calls.map(([name]) => name), ['profile', 'daily']);
  assert.equal(f.calls[0][1], f.calls[1][1]);
  assert.deepEqual(f.last(), {
    busy: false, error: '',
    profile: { name: 'Captain', shipName: 'Ship', coins: 10, level: 3, totalXp: 200 },
    daily: { day: '2026-10-30', endsAt: '2026-10-31T00:00:00Z', items: [{ id: 'quest-one', title: 'Protect a boundary', status: 'open' }] },
  });
  assert.doesNotMatch(JSON.stringify(f.last()), /private|consent|evidence|quoteId|owned|criteria/);
  await f.controller.activate(true);
  assert.equal(f.calls.length, 2);
  f.controller.dispose();
});

test('switching back to Projects synchronously clears protected summaries and aborts without routes or mutations', async () => {
  const f = fixture();
  await f.controller.activate(true);
  const signal = f.calls[0][1];
  f.controller.activate(false);
  assert.equal(signal.aborted, true);
  assert.deepEqual(f.last(), { busy: false, error: '', profile: undefined, daily: undefined });
  await f.controller.refresh();
  assert.equal(f.calls.length, 2);
  await f.controller.activate(true);
  assert.equal(f.calls.length, 4);
  f.controller.dispose();
});

test('hidden pane cannot resurrect a late authenticated response', async () => {
  const profile = deferred(), daily = deferred();
  const f = fixture({ profile: () => profile.promise, daily: () => daily.promise });
  const pending = f.controller.activate(true);
  assert.equal(f.last().busy, true);
  f.controller.activate(false);
  profile.resolve(account); daily.resolve(assignments);
  await pending;
  assert.equal(f.last().profile, undefined);
  assert.equal(f.last().daily, undefined);
  f.controller.dispose();
});

test('either authentication failure hides both account-bound summaries and never renders server messages', async () => {
  for (const boundary of ['profile', 'daily']) {
    const f = fixture({ [boundary]: async () => { throw { type: boundary === 'profile' ? 'voyagesError' : 'dailyQuestError', data: { code: 'authentication_required' }, message: 'private token' }; } });
    await f.controller.activate(true);
    assert.equal(f.last().profile, undefined);
    assert.equal(f.last().daily, undefined);
    assert.equal(f.last().error, 'authentication_required');
    assert.doesNotMatch(JSON.stringify(f.updates), /private token/);
    f.controller.dispose();
  }
});

test('untrusted error codes and transport messages cannot leak through the rail', async () => {
  for (const error of [new Error('private message'), { type: 'dailyQuestError', data: { code: 'private\u001b[31m' } }, { type: 'voyagesError', data: { code: 'x'.repeat(65) } }]) {
    const f = fixture({ daily: async () => { throw error; } });
    await f.controller.activate(true);
    assert.match(f.last().error, /^(voyages_request_failed|voyages_error)$/);
    assert.doesNotMatch(JSON.stringify(f.updates), /private/);
    f.controller.dispose();
  }
});

test('refresh clears stale account data before either new response is available', async () => {
  let gate;
  const f = fixture({ profile: async () => gate ? gate.promise : account });
  await f.controller.activate(true);
  gate = deferred();
  const pending = f.controller.refresh();
  assert.equal(f.last().busy, true);
  assert.equal(f.last().profile, undefined);
  assert.equal(f.last().daily, undefined);
  gate.resolve(account);
  await pending;
  assert.equal(f.last().profile.name, 'Captain');
  f.controller.dispose();
});

test('account/location invalidation aborts old requests and only publishes the fresh pair', async () => {
  const old = deferred();
  let count = 0;
  const signals = [];
  const f = fixture({ profile: (signal) => { signals.push(signal); return ++count === 1 ? old.promise : Promise.resolve({ profile: { ...account.profile, name: 'New captain' } }); } });
  const previous = f.controller.activate(true);
  const next = f.controller.contextChanged();
  assert.equal(signals[0].aborted, true);
  await next;
  old.resolve(account);
  await previous;
  assert.equal(f.last().profile.name, 'New captain');
  f.controller.dispose();
});

test('disconnect clears synchronously, does not auto-reconnect, and permits an explicit read-only refresh', async () => {
  const f = fixture();
  await f.controller.activate(true);
  f.controller.disconnect();
  assert.equal(f.last().profile, undefined);
  assert.equal(f.last().daily, undefined);
  assert.equal(f.calls.length, 2);
  await f.controller.refresh();
  assert.equal(f.calls.length, 4);
  f.controller.dispose();
});

test('duplicate refresh while busy is ignored; disposal revokes every late callback', async () => {
  const old = deferred();
  const f = fixture({ profile: () => old.promise });
  const pending = f.controller.activate(true);
  await f.controller.refresh();
  f.controller.dispose();
  const length = f.updates.length;
  old.resolve(account);
  await pending;
  await f.controller.refresh();
  await f.controller.activate(true);
  await f.controller.contextChanged();
  assert.equal(f.updates.length, length);
  assert.equal(f.last().profile, undefined);
});

test('timeout clears busy and fails closed without an unhandled promise', async () => {
  const timeout = new AbortController();
  const f = fixture({ timeoutSignal: () => timeout.signal, daily: (signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
  const pending = f.controller.activate(true);
  timeout.abort(new Error('private transport information'));
  await pending;
  assert.equal(f.last().busy, false);
  assert.equal(f.last().profile, undefined);
  assert.equal(f.last().daily, undefined);
  assert.doesNotMatch(JSON.stringify(f.updates), /private/);
  f.controller.dispose();
});

test('native extension is optional; navigation cannot itself accept consent or purchase', async () => {
  const root = new URL('../plugins/carthagent/src/', import.meta.url);
  const [tui, pane, adapter, daily, voyages] = await Promise.all(['tui.tsx', 'ui/voyages-navigation.tsx', 'ui/native-navigation.ts', 'ui/daily-quests.tsx', 'ui/voyages.tsx'].map((file) => readFile(new URL(file, root), 'utf8')));
  assert.match(tui, /if \(navigation\) cleanups.push\(navigation.register/);
  assert.match(adapter, /navigation\?: NativeNavigation/);
  assert.match(pane, /!props.active \|\| context.keymap.mode.current\(\) !== "navigation" \|\| !props.focused/);
  assert.match(pane, /showDescription=\{!props.compact\}/);
  assert.match(pane, /Badges & friends: no native views yet/);
  assert.doesNotMatch(pane, /\.submit\(|\.retry\(|\.purchase\(|\.quote\(|\.customize\(|\.equip\(|dialog\.confirm|consent: true/);
  assert.match(daily, /controller.refresh\(\).then\(\(\) => \{ if \(props.questID\) return controller.select\(props.questID\)/);
  assert.match(voyages, /view\(\).busy \|\| context.keymap.mode.current\(\) !== "base"/);
});
