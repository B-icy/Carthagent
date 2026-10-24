import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canEquip, createVoyagesState, handleVoyagesEvent, voyagesCatalogLabel, voyagesErrorCode, voyagesEventAction } from '../plugins/carthagent/src/ui/voyages-state.mjs';

const item = { item: 'hat:beanie', itemKey: 'beanie', name: 'Beanie', slot: 'hat', price: 5, requiresPurchase: true, available: true, eligible: true };
const snapshot = () => ({ profile: { version: 2, name: 'Captain', shipName: 'Ship', coins: 10, config: { hat: 'none' }, owned: [] }, items: [{ ...item }] });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function fixture(overrides = {}) {
  const writes = [];
  const api = {
    snapshot: async () => snapshot(),
    customize: async (input) => { writes.push(['customize', input]); },
    equip: async (input) => { writes.push(['equip', input]); },
    quote: async () => ({ quote: { id: 'q1', item: item.item, price: 5, expiresAt: new Date(20000).toISOString() } }),
    purchase: async (input) => { writes.push(['purchase', input]); },
    retryPurchase: async (input) => { writes.push(['retry', input]); },
    ...overrides,
  };
  let latest;
  const controller = createVoyagesState({ api, now: () => 10000, changed: (next) => { latest = next; } });
  return { controller, writes, api, view: () => latest };
}

test('canceling customization, equip, purchase and pending retry performs zero writes', async () => {
  const { controller, view, writes } = fixture();
  await controller.refresh();
  await controller.customize(async () => ({ name: 'Preview' }), async () => false);
  view().snapshot.profile.owned.push(item.item);
  await controller.equip(item, async () => false);
  view().snapshot.profile.owned = [];
  await controller.purchase(item, async () => false);
  view().snapshot.pending = { quoteId: 'q1', item: item.item, price: 5 };
  await controller.retry(async () => false);
  assert.deepEqual(writes, []);
});

test('quote expiry during confirmation prevents purchase', async () => {
  const { controller, api, writes } = fixture();
  let now = 10000;
  let uiView;
  const ui = createVoyagesState({ api, now: () => now, changed: (next) => { uiView = next; } });
  await ui.refresh();
  await ui.purchase(item, async () => { now = 21000; return true; });
  assert.deepEqual(writes, []);
  assert.match(uiView.error, /no success assumed/);
  assert.equal(uiView.notice, '');
  controller.dispose();
});

test('invalid quote, insufficient funds and ineligible item never purchase', async () => {
  for (const quote of [ { item: 'hat:other', price: 5 }, { item: item.item, price: 11 }, { item: item.item, price: -1 } ]) {
    let confirmed = false;
    const { controller, writes } = fixture({ quote: async () => ({ quote: { ...quote, id: 'q1', expiresAt: new Date(20000).toISOString() } }) });
    await controller.refresh();
    await controller.purchase(item, async () => { confirmed = true; return true; });
    assert.equal(confirmed, false);
    assert.deepEqual(writes, []);
  }
  const { controller, writes } = fixture();
  await controller.refresh();
  await controller.purchase({ ...item, eligible: false }, async () => true);
  assert.deepEqual(writes, []);
});

test('network/auth failures clear protected state and never report success', async () => {
  const { controller, view, api } = fixture();
  await controller.refresh();
  api.snapshot = async () => { throw new Error('secret unsafe detail'); };
  await controller.refresh();
  assert.equal(view().snapshot, undefined);
  assert.equal(view().notice, '');
  assert.doesNotMatch(view().error, /secret/);
});

test('account switch and disposal ignore stale callbacks and dialog confirmation', async () => {
  for (const dispose of [false, true]) {
    const pending = deferred();
    const { controller, view, writes } = fixture();
    await controller.refresh();
    const action = controller.customize(async () => ({ name: 'Other' }), () => pending.promise);
    await Promise.resolve();
    if (dispose) controller.dispose(); else controller.invalidate();
    pending.resolve(true);
    await action;
    assert.deepEqual(writes, []);
    assert.equal(view().snapshot, undefined);
    assert.equal(view().notice, '');
  }
  const stale = deferred();
  const { controller, view } = fixture({ snapshot: () => stale.promise });
  const read = controller.refresh();
  controller.invalidate();
  stale.resolve(snapshot());
  await read;
  assert.equal(view().snapshot, undefined);
});

test('uncertain purchase reconciles pending but never reports success or retries automatically', async () => {
  let purchases = 0;
  const { controller, view } = fixture({
    purchase: async () => { purchases++; throw { type: 'voyagesError', message: 'network_error', data: { code: 'network_error', uncertain: true, status: 0 } }; },
    snapshot: async () => ({ ...snapshot(), ...(purchases ? { pending: { quoteId: 'q1', item: item.item, price: 5 } } : {}) }),
  });
  await controller.refresh();
  await controller.purchase(item, async () => true);
  assert.equal(purchases, 1);
  assert.equal(view().notice, '');
  assert.equal(view().snapshot.pending.quoteId, 'q1');
  await controller.purchase(item, async () => true);
  assert.equal(purchases, 1);
});

test('zero-priced paid offers require purchase; owned/free catalog entries equip explicitly', async () => {
  const { controller, view, writes } = fixture();
  await controller.refresh();
  assert.equal(canEquip(view().snapshot, { ...item, price: 0 }), false);
  assert.equal(canEquip(view().snapshot, { ...item, requiresPurchase: false }), true);
  view().snapshot.profile.owned.push(item.item);
  assert.equal(canEquip(view().snapshot, item), true);
  await controller.equip(item, async () => true);
  assert.deepEqual(writes, [['equip', { version: 2, slot: 'hat', item: 'beanie' }]]);
});

test('busy guard covers asynchronous dialogs and writes', async () => {
  const pending = deferred();
  const { controller, writes } = fixture();
  await controller.refresh();
  const first = controller.customize(async () => ({ name: 'Preview' }), () => pending.promise);
  await controller.purchase(item, async () => true);
  await controller.refresh();
  pending.resolve(true);
  await first;
  assert.deepEqual(writes, [['customize', { version: 2, name: 'Preview' }]]);
});

test('native RPC error envelope exposes only validated structured Voyages codes', async () => {
  assert.equal(voyagesErrorCode({ type: 'voyagesError', message: 'unsafe token', data: { code: 'terms_changed', status: 409, uncertain: false } }), 'terms_changed');
  for (const error of [new Error('secret'), { type: 'other', data: { code: 'terms_changed' } }, { type: 'voyagesError', data: { code: 'secret value\n' } }, { type: 'voyagesError', data: {} }]) {
    assert.equal(voyagesErrorCode(error), 'voyages_request_failed');
  }
  const { controller, view, api } = fixture();
  await controller.refresh();
  api.customize = async () => { throw { type: 'voyagesError', message: 'unsafe detail', data: { code: 'version_conflict', status: 409, uncertain: false } }; };
  await controller.customize(async () => ({ name: 'Draft' }), async () => true);
  assert.match(view().error, /^version_conflict\./);
  assert.doesNotMatch(view().error, /unsafe/);
  assert.equal(view().notice, '');
});

test('native event mapping respects location and integration scope', () => {
  const location = { directory: '/selected', workspaceID: 'w1' };
  for (const type of ['provider.updated', 'integration.updated', 'credential.updated', 'server.connected']) {
    assert.equal(voyagesEventAction({ type, data: {} }, location), 'refresh');
    assert.equal(voyagesEventAction({ type, location, data: {} }, location), 'refresh');
    assert.equal(voyagesEventAction({ type, location: { directory: '/other' }, data: {} }, location), 'ignore');
    assert.equal(voyagesEventAction({ type, location: { ...location, workspaceID: 'w2' }, data: {} }, location), 'ignore');
  }
  assert.equal(voyagesEventAction({ type: 'credential.switched', data: { integrationID: 'experiential-labs', credentialID: null } }, location), 'refresh');
  assert.equal(voyagesEventAction({ type: 'credential.switched', data: { integrationID: 'anthropic' } }, location), 'ignore');
  assert.equal(voyagesEventAction({ type: 'session.updated', data: {} }, location), 'ignore');
  assert.equal(voyagesEventAction({ type: 'server.disconnected' }, location), 'clear');
});

test('credential event immediately clears old profile/dialog and freshly loads signed-in account', async () => {
  const { controller, view, api, writes } = fixture();
  await controller.refresh();
  const confirmation = deferred();
  const action = controller.customize(async () => ({ name: 'Old account draft' }), () => confirmation.promise);
  await Promise.resolve();
  const nextAccount = deferred();
  let signal;
  api.snapshot = (abortSignal) => { signal = abortSignal; return nextAccount.promise; };
  let closed = 0;
  const reloading = handleVoyagesEvent(controller, { type: 'credential.switched', data: { integrationID: 'experiential-labs', credentialID: 'new' } }, { directory: '/selected' }, () => { closed++; });
  assert.equal(view().snapshot, undefined);
  assert.equal(closed, 1);
  assert.ok(signal instanceof AbortSignal);
  confirmation.resolve(true);
  await action;
  assert.deepEqual(writes, []);
  const next = snapshot(); next.profile.name = 'New account';
  nextAccount.resolve(next);
  await reloading;
  assert.equal(view().snapshot.profile.name, 'New account');
  await handleVoyagesEvent(controller, { type: 'credential.switched', data: { integrationID: 'anthropic' } }, { directory: '/selected' }, () => { closed++; });
  assert.equal(closed, 1);
  assert.equal(view().snapshot.profile.name, 'New account');
  handleVoyagesEvent(controller, { type: 'server.disconnected' }, { directory: '/selected' });
  assert.equal(view().snapshot, undefined);
});

test('retired null prices stay unknown, never quote/purchase or imply free equipment', async () => {
  for (const requiresPurchase of [true, false, null]) {
    const retired = { ...item, price: null, requiresPurchase };
    let quotes = 0;
    const { controller, view, writes } = fixture({
      snapshot: async () => ({ ...snapshot(), items: [retired] }),
      quote: async () => { quotes++; throw new Error('must not quote'); },
    });
    await controller.refresh();
    assert.equal(view().snapshot.items[0].price, null);
    assert.match(voyagesCatalogLabel(view().snapshot, retired), /Retired.*price unavailable/);
    assert.doesNotMatch(voyagesCatalogLabel(view().snapshot, retired), /Free|null coins|0 coins/);
    assert.equal(canEquip(view().snapshot, retired), false);
    await controller.purchase(retired, async () => true);
    assert.equal(quotes, 0);
    assert.deepEqual(writes, []);
    view().snapshot.profile.owned.push(retired.item);
    assert.match(voyagesCatalogLabel(view().snapshot, retired), /^Owned.*price unavailable/);
    assert.equal(canEquip(view().snapshot, retired), true);
    assert.equal(canEquip(view().snapshot, { ...retired, available: false }), false);
    assert.equal(canEquip(view().snapshot, { ...retired, eligible: false }), false);
    await controller.equip(retired, async () => true);
    assert.deepEqual(writes, [['equip', { version: 2, slot: 'hat', item: 'beanie' }]]);
    assert.equal(quotes, 0);
  }
});

test('pending retry stays bound to Q1 when another TUI replaces server pending with Q2', async () => {
  let pending = { quoteId: 'q1', item: item.item, price: 5 };
  const { controller, writes } = fixture({ snapshot: async () => ({ ...snapshot(), pending }) });
  await controller.refresh();
  await controller.retry(async (shown) => {
    assert.equal(shown.quoteId, 'q1');
    pending = { quoteId: 'q2', item: 'hat:other', price: 8 };
    return true;
  });
  assert.deepEqual(writes, [['retry', { quoteId: 'q1' }]]);
  assert.equal('state' in controller, false);
});

test('human wait longer than a minute does not expire name/equip confirmation; timeout starts on each network call', async () => {
  let time = 0;
  const timers = [];
  const writes = [];
  const current = snapshot(); current.profile.owned.push(item.item);
  const ui = createVoyagesState({
    now: () => time,
    timeoutSignal: () => { const abort = new AbortController(); timers.push({ time, abort }); return abort.signal; },
    api: {
      snapshot: async () => current,
      customize: async (input, signal) => { assert.equal(signal.aborted, false); writes.push(input); },
      equip: async (input, signal) => { assert.equal(signal.aborted, false); writes.push(input); },
    },
  });
  await ui.refresh();
  await ui.customize(async () => {
    assert.equal(timers.length, 1);
    time = 120000;
    timers[0].abort.abort();
    return { name: 'After a long wait' };
  }, async () => { time += 120000; return true; });
  await ui.equip(item, async () => { time += 120000; return true; });
  assert.equal(writes.length, 2);
  assert.equal(timers[1].time, 240000);
  assert.equal(timers[3].time, 360000);
});

test('per-request timeout is reported visibly, not silently dropped as an expired UI lifetime', async () => {
  const timers = [];
  let latest;
  const failed = deferred();
  const ui = createVoyagesState({
    timeoutSignal: () => { const abort = new AbortController(); timers.push(abort); return abort.signal; },
    changed: (next) => { latest = next; if (next.error) failed.resolve(); },
    api: { snapshot: (signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) },
  });
  const loading = ui.refresh();
  timers[0].abort(new DOMException('Timed out', 'TimeoutError'));
  await failed.promise;
  assert.match(latest.error, /no success assumed/);
  assert.equal(latest.snapshot, undefined);
  timers[1].abort(new DOMException('Timed out', 'TimeoutError'));
  await loading;
  assert.equal(latest.busy, false);
  assert.equal(latest.notice, '');
});
