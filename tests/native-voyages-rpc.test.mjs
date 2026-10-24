import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { CloudClient } from '../lib/cloud/client.mjs';
import { mkdtempSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JsonSchema, Schema, SchemaRepresentation } from 'effect';
const testRoot = mkdtempSync(join(tmpdir(), 'ctg-voyages-rpc-'));
after(() => rm(testRoot, { recursive: true, force: true }));
const { createJiti } = createRequire(import.meta.url)('jiti');
const jiti = createJiti(import.meta.url);
const { createVoyagesRpcHandlers } = await jiti.import('../plugins/carthagent/src/server/voyages-rpc.ts');
const { Voyages } = await jiti.import('../plugins/carthagent/src/voyages-rpc.ts');
const NOW = 1800000000000;
const profile = {
  version: 1, name: 'Voyager', shipName: 'Maiden', coins: 10, totalXp: 0, level: 1, xpIntoLevel: 0, xpForLevel: 500, km: 0, weeklyKm: 0,
  config: { hairStyle: 'cropped', hat: 'beanie', shirt: 'none', bottoms: 'underwear', shoes: 'barefoot', pet: 'none', hull: 'cedar', sail: 'gold', setting: 'dusk', skin: 'warm', hair: 'dark', pattern: 'stripes' }, owned: ['hat:beanie'],
};
const catalog = { item: 'hat:captain', name: 'Captain', slot: 'hat', itemKey: 'captain', price: 5, requiresPurchase: true, available: true, eligible: true, reason: null };
const authoritativeQuote = { id: 'quote-1', item: catalog.item, price: 5, expiresAt: new Date(NOW + 120000).toISOString() };
const receipt = { receiptId: 'receipt-1', item: catalog.item, price: 5 };
const call = { signal: new AbortController().signal, error(type, message, data) { throw Object.assign(new Error(message), { type, data }); } };
function setup() {
  const profileRoot = mkdtempSync(join(testRoot, 'profile-'));
  const data = new Map(), requests = [], writes = [];
  let id = 'account-a';
  const ctx = {
    storage: { get: async k => structuredClone(data.get(k)), set: async (k, v) => { writes.push(structuredClone(v)); data.set(k, structuredClone(v)); } },
    integration: { connection: {
      active: async integration => { assert.equal(integration, 'experiential-labs'); return id ? { id, type: 'credential', method: 'oauth' } : undefined; },
      resolve: async () => ({ type: 'oauth', methodID: 'carthagent-device', access: 'secret-fixture' }),
    } },
  };
  const cloud = { request: async (path, input) => {
    requests.push({ path, ...input });
    if (path.endsWith('/bootstrap')) return { signedIn: true, profile: structuredClone(profile) };
    if (path.endsWith('/shop')) return { items: [structuredClone(catalog)] };
    if (path.endsWith('/quotes')) return { quote: structuredClone(authoritativeQuote) };
    if (path.endsWith('/purchases')) { assert.ok([...data.values()].some(s => s.pending?.key === input.body.key)); return receipt; }
    return { profile: structuredClone(profile) };
  } };
  const journal = { get: file => ctx.storage.get(file), set: (file, state) => ctx.storage.set(file, state) };
  const make = (baseUrl = 'https://api.example.test') => createVoyagesRpcHandlers(ctx, { cloudClient: cloud, baseUrl, now: () => NOW, profileRoot, journal });
  return { ctx, cloud, data, requests, writes, make, profileRoot, handlers: make(), switchAccount: value => { id = value; } };
}
const rejected = (promise, code, uncertain = false) => assert.rejects(promise, error => error.type === 'voyagesError' && error.message === code && error.data.code === code && error.data.uncertain === uncertain);
const getQuote = handlers => handlers.quote({ slot: 'hat', item: 'captain' }, call);

test('Voyages is a separate six-method typed error contract', () => {
  assert.equal(Voyages.id, 'carthagent.voyages');
  assert.deepEqual(Object.keys(Voyages.methods), ['snapshot', 'customize', 'equip', 'quote', 'purchase', 'retryPurchase']);
  for (const method of Object.values(Voyages.methods)) assert.ok(method.errors.voyagesError);
});

test('pinned Effect native conversion accepts every RPC input, output and typed error', () => {
  const samples = {
    snapshot: [{}, { profile, items: [catalog, { ...catalog, item: 'hat:beanie', itemKey: 'beanie', price: null }], pending: { quoteId: 'quote-1', item: catalog.item, price: 5 } }],
    customize: [{ version: 1, name: 'New', skin: 'warm', hair: 'dark', pattern: 'plain' }, { profile }],
    equip: [{ version: 1, slot: 'hat', item: 'beanie' }, { profile }],
    quote: [{ slot: 'hat', item: 'captain' }, { quote: authoritativeQuote }],
    purchase: [{ quoteId: 'quote-1' }, receipt],
    retryPurchase: [{ quoteId: 'quote-1' }, receipt],
  };
  const decode = (schema, value) => Schema.decodeUnknownSync(SchemaRepresentation.fromJsonSchemaDocument(JsonSchema.fromSchemaDraft2020_12(schema)))(value);
  // Prove this exercises the failure mode, not a permissive substitute validator.
  assert.throws(() => decode({ type: 'string', pattern: '^[a-z]+$' }, 'beanie'));
  for (const [name, method] of Object.entries(Voyages.methods)) {
    assert.deepEqual(decode(method.input, samples[name][0]), samples[name][0], `${name} input`);
    assert.deepEqual(decode(method.output, samples[name][1]), samples[name][1], `${name} output`);
    for (const schema of Object.values(method.errors)) {
      const error = { code: 'quote_expired', status: 409, uncertain: false };
      assert.deepEqual(decode(schema, error), error, `${name} error`);
    }
  }
  assert.throws(() => decode(Voyages.methods.retryPurchase.input, {}));
});

test('manual key checks reject invalid equip and quote selections before network traffic', async () => {
  for (const method of ['equip', 'quote']) {
    const s = setup();
    await rejected(s.handlers[method]({ version: 1, slot: 'hat', item: '../unsafe' }, call), 'invalid_response');
    assert.equal(s.requests.length, 0);
  }
});

test('confirmed retry identity mismatch never sends, and only proven expired replay clears pending', async () => {
  const s = setup(), original = s.cloud.request;
  await getQuote(s.handlers);
  s.cloud.request = async () => { throw new Error('unknown'); };
  await rejected(s.handlers.purchase({ quoteId: 'quote-1' }, call), 'request_failed', true);
  const pending = structuredClone([...s.data.values()][0].pending);
  for (const input of [{}, { quoteId: 'different-quote' }]) {
    s.cloud.request = async () => assert.fail('mismatched confirmation must not send');
    await rejected(s.handlers.retryPurchase(input, call), 'pending_changed', true);
    assert.deepEqual([...s.data.values()][0].pending, pending);
  }
  for (const [code, status] of [['invalid_token', 401], ['insufficient_scope', 403], ['quote_consumed', 409], ['key_conflict', 409]]) {
    s.cloud.request = async () => { throw Object.assign(new Error('private'), { code, status }); };
    await rejected(s.handlers.retryPurchase({ quoteId: 'quote-1' }, call), code, true);
    assert.deepEqual([...s.data.values()][0].pending, pending);
  }
  s.cloud.request = async () => { throw Object.assign(new Error('expired'), { code: 'quote_expired', status: 409 }); };
  await rejected(s.handlers.retryPurchase({ quoteId: 'quote-1' }, call), 'quote_expired');
  assert.equal([...s.data.values()][0].pending, undefined);
  s.cloud.request = original;
  assert.deepEqual(await getQuote(s.handlers), { quote: authoritativeQuote });
});

test('snapshot validates authoritative DTOs, strips extras and uses native credentials', async () => {
  const s = setup();
  assert.deepEqual(await s.handlers.snapshot({}, call), { profile, items: [catalog] });
  assert.deepEqual(s.requests.map(r => r.path), ['/v1/voyages/bootstrap', '/v1/voyages/shop']);
  for (const request of s.requests) { assert.equal(request.accessToken, 'secret-fixture'); assert.equal(request.signal, call.signal); }
  assert.equal(JSON.stringify(await s.handlers.snapshot({}, call)).includes('secret-fixture'), false);
  s.ctx.integration.connection.resolve = async () => ({ type: 'oauth', methodID: 'other', access: 'secret-fixture' });
  await rejected(s.handlers.snapshot({}, call), 'authentication_required');
  s.switchAccount(undefined);
  await rejected(s.handlers.snapshot({}, call), 'authentication_required');
});

test('malformed profile, numeric/config fields and shop metadata fail closed', async () => {
  for (const change of [p => { p.coins = '10'; }, p => { p.config.skin = 'bogus'; }, p => { p.config.hat = {}; }, p => { p.weeklyKm = Infinity; }, p => { p.version = 0; }, p => { p.owned = ['hat:beanie:extra']; }]) {
    const s = setup(), p = structuredClone(profile); change(p);
    s.cloud.request = async () => ({ signedIn: true, profile: p });
    await rejected(s.handlers.snapshot({}, call), 'invalid_response');
  }
  const s = setup(), original = s.cloud.request;
  s.cloud.request = async (path, input) => path.endsWith('/shop') ? { items: [{ ...catalog, requiresPurchase: undefined }] } : original(path, input);
  await rejected(s.handlers.snapshot({}, call), 'invalid_response');
});

test('owned retired paid catalog price stays null, while unowned null and null quote prices fail closed', async () => {
  const s = setup(), original = s.cloud.request;
  const retired = { ...catalog, item: 'hat:beanie', itemKey: 'beanie', name: 'Beanie', price: null, available: false, reason: 'retired' };
  s.cloud.request = async (path, input) => path.endsWith('/shop') ? { items: [retired] } : original(path, input);
  const snapshot = await s.handlers.snapshot({}, call);
  assert.deepEqual(snapshot.items, [retired]);
  assert.equal(snapshot.items[0].price, null);
  assert.equal(snapshot.items[0].requiresPurchase, true);
  s.cloud.request = async (path, input) => path.endsWith('/shop') ? { items: [{ ...catalog, price: null }] } : original(path, input);
  await rejected(s.handlers.snapshot({}, call), 'invalid_response');
  s.cloud.request = async () => ({ quote: { ...authoritativeQuote, price: null } });
  await rejected(getQuote(s.handlers), 'invalid_response');
  assert.equal(s.data.size, 0);
});

test('exact mutation endpoints forward versions and cancellation without retries', async () => {
  const s = setup();
  await s.handlers.customize({ version: 1, name: 'New' }, call);
  await s.handlers.equip({ version: 1, slot: 'hat', item: 'beanie' }, call);
  assert.deepEqual(s.requests.map(r => [r.path, r.method, r.body]), [
    ['/v1/voyages/profile', 'PATCH', { version: 1, name: 'New' }],
    ['/v1/voyages/equip', 'POST', { version: 1, slot: 'hat', item: 'beanie' }],
  ]);
  s.cloud.request = async () => { throw Object.assign(new Error('secret response detail'), { code: 'version_conflict', status: 409, detail: 'secret' }); };
  await rejected(s.handlers.customize({ version: 1, name: 'New' }, call), 'version_conflict');
  const controller = new AbortController(); controller.abort(new Error('secret abort reason'));
  await rejected(s.handlers.equip({}, { ...call, signal: controller.signal }), 'request_failed');
});

test('stored authoritative quote is required, TTL bounded and price never comes from UI', async () => {
  const s = setup();
  await rejected(s.handlers.purchase({ quoteId: 'quote-1' }, call), 'quote_required');
  assert.deepEqual(await getQuote(s.handlers), { quote: authoritativeQuote });
  await s.handlers.purchase({ quoteId: 'quote-1', price: 0 }, call);
  const request = s.requests.find(r => r.path.endsWith('/purchases'));
  assert.deepEqual(Object.keys(request.body).sort(), ['key', 'quoteId']);
  assert.match(request.body.key, /^[\da-f-]{36}$/);
  assert.deepEqual([...s.data.values()][0], { quotes: [] });
});

test('persistence failure prevents send; unknown result survives restart and replays exact pair', async () => {
  const s = setup(); await getQuote(s.handlers);
  const save = s.ctx.storage.set;
  s.ctx.storage.set = async () => { throw new Error('disk secret'); };
  await rejected(s.handlers.purchase({ quoteId: 'quote-1' }, call), 'request_failed');
  assert.equal(s.requests.some(r => r.path.endsWith('/purchases')), false);
  s.ctx.storage.set = save;
  const original = s.cloud.request;
  s.cloud.request = async (path, input) => { const result = await original(path, input); if (path.endsWith('/purchases')) throw new Error('connection lost'); return result; };
  await rejected(s.handlers.purchase({ quoteId: 'quote-1' }, call), 'request_failed', true);
  const pair = s.requests.at(-1).body;
  const restarted = s.make();
  assert.deepEqual((await restarted.snapshot({}, call)).pending, { quoteId: 'quote-1', item: catalog.item, price: 5 });
  await rejected(getQuote(restarted), 'purchase_pending', true);
  await rejected(restarted.purchase({ quoteId: 'quote-1' }, call), 'purchase_pending', true);
  s.cloud.request = original;
  assert.deepEqual(await restarted.retryPurchase({ quoteId: 'quote-1' }, call), receipt);
  assert.deepEqual(s.requests.at(-1).body, pair);
  await rejected(restarted.retryPurchase({ quoteId: 'quote-1' }, call), 'no_pending_purchase');
});

test('concurrent purchases serialize and never replace a pending request key', async () => {
  const s = setup(); await getQuote(s.handlers);
  const original = s.cloud.request;
  s.cloud.request = async (path, input) => { await original(path, input); throw new Error('unknown'); };
  const results = await Promise.allSettled([s.handlers.purchase({ quoteId: 'quote-1' }, call), s.make().purchase({ quoteId: 'quote-1' }, call)]);
  assert.equal(results.every(r => r.status === 'rejected'), true);
  assert.equal(s.requests.filter(r => r.path.endsWith('/purchases')).length, 1);
});

test('account and API origin isolate pending; account switch during request is fail closed', async () => {
  const s = setup(); await getQuote(s.handlers);
  const original = s.cloud.request;
  s.cloud.request = async (path, input) => { const result = await original(path, input); if (path.endsWith('/purchases')) s.switchAccount('account-b'); return result; };
  await rejected(s.handlers.purchase({ quoteId: 'quote-1' }, call), 'account_changed', true);
  assert.equal((await s.handlers.snapshot({}, call)).pending, undefined);
  await rejected(s.handlers.retryPurchase({ quoteId: 'quote-1' }, call), 'no_pending_purchase');
  s.switchAccount('account-a');
  assert.ok((await s.handlers.snapshot({}, call)).pending);
  assert.equal((await s.make('https://other.example.test').snapshot({}, call)).pending, undefined);
  await rejected(s.make('https://other.example.test').retryPurchase({ quoteId: 'quote-1' }, call), 'no_pending_purchase');
});

test('terminal no-debit rejection clears first attempt, but conflicts and replay errors retain pending', async () => {
  for (const code of ['insufficient_coins', 'terms_changed', 'key_conflict', 'quote_consumed', 'invalid_token', 'insufficient_scope']) {
    const s = setup(); await getQuote(s.handlers);
    s.cloud.request = async () => { throw Object.assign(new Error('secret'), { code, status: code === 'invalid_token' ? 401 : code === 'insufficient_scope' ? 403 : 409 }); };
    const uncertain = ['key_conflict', 'quote_consumed'].includes(code);
    await rejected(s.handlers.purchase({ quoteId: 'quote-1' }, call), code, uncertain);
    assert.equal(!![...s.data.values()][0].pending, uncertain);
    if (uncertain) {
      s.cloud.request = async () => { throw Object.assign(new Error('secret'), { code: 'quote_expired', status: 409 }); };
      await rejected(s.handlers.retryPurchase({ quoteId: 'quote-1' }, call), 'quote_expired');
      assert.equal([...s.data.values()][0].pending, undefined);
    }
  }
});

test('only bounded UTC ISO quote expiry is accepted, never numeric or non-UTC', async () => {
  for (const q of [
    ...[(NOW + 10000) / 1000, NOW + 10000, new Date(NOW - 1000).toISOString(), new Date(NOW + 999999).toISOString(), '2027-01-15T08:02:00+00:00', '2027-02-30T08:02:00Z'].map(expiresAt => ({ ...authoritativeQuote, expiresAt })),
    { ...authoritativeQuote, item: 'hat:other' },
  ]) {
    const s = setup(); s.cloud.request = async () => ({ quote: q });
    await rejected(getQuote(s.handlers), 'invalid_response');
    assert.equal(s.data.size, 0);
  }
});

test('in-flight cancellation retains persisted purchase pair and passes the original signal', async () => {
  const s = setup(); await getQuote(s.handlers);
  const controller = new AbortController(), original = s.cloud.request;
  s.cloud.request = async (path, input) => {
    assert.equal(input.signal, controller.signal);
    await original(path, input);
    controller.abort(new Error('private cancellation reason'));
    input.signal.throwIfAborted();
  };
  await rejected(s.handlers.purchase({ quoteId: 'quote-1' }, { ...call, signal: controller.signal }), 'request_failed', true);
  assert.ok([...s.data.values()][0].pending);
  const pair = s.requests.at(-1).body;
  s.cloud.request = original;
  await s.make().retryPurchase({ quoteId: 'quote-1' }, call);
  assert.deepEqual(s.requests.at(-1).body, pair);
});

test('receipt validation and clearing storage failures preserve exact pending replay', async () => {
  for (const invalid of [true, false]) {
    const s = setup(); await getQuote(s.handlers);
    const original = s.cloud.request, save = s.ctx.storage.set;
    s.cloud.request = async (path, input) => {
      const result = await original(path, input);
      if (!path.endsWith('/purchases')) return result;
      if (invalid) return { ...receipt, price: 0 };
      s.ctx.storage.set = async () => { throw new Error('disk error'); };
      return result;
    };
    await rejected(s.handlers.purchase({ quoteId: 'quote-1' }, call), invalid ? 'invalid_response' : 'request_failed', true);
    assert.ok([...s.data.values()][0].pending);
    s.ctx.storage.set = save;
    s.cloud.request = original;
    assert.deepEqual(await s.make().retryPurchase({ quoteId: 'quote-1' }, call), receipt);
  }
});

test('unknown backend codes and details are never reflected; versioned unknown writes are uncertain', async () => {
  const s = setup();
  s.cloud.request = async () => { throw Object.assign(new Error('private-token'), { code: 'private-token', detail: 'private-token', status: 503 }); };
  await rejected(s.handlers.snapshot({}, call), 'request_rejected');
  await rejected(s.handlers.customize({ version: 1, name: 'New' }, call), 'request_rejected', true);
});

test('real CloudClient uses exact bearer endpoints without cookies, CSRF or fabricated origin', async () => {
  const s = setup(), wire = [];
  const cloud = new CloudClient({ baseUrl: 'https://api.example.test', fetchImpl: async (url, init) => {
    wire.push({ url, ...init });
    return { ok: true, text: async () => JSON.stringify(url.endsWith('/bootstrap') ? { signedIn: true, profile } : { items: [catalog] }) };
  } });
  const handlers = createVoyagesRpcHandlers(s.ctx, { cloudClient: cloud, baseUrl: cloud.baseUrl, profileRoot: s.profileRoot });
  await handlers.snapshot({}, call);
  assert.deepEqual(wire.map(r => r.url), ['https://api.example.test/v1/voyages/bootstrap', 'https://api.example.test/v1/voyages/shop']);
  for (const r of wire) assert.deepEqual(r.headers, { accept: 'application/json', authorization: 'Bearer secret-fixture' });
});

test('shop reason permits empty text and null but all three flags remain strict booleans', async () => {
  for (const reason of ['', null]) {
    const s = setup(), original = s.cloud.request;
    s.cloud.request = async (path, input) => path.endsWith('/shop') ? { items: [{ ...catalog, reason }] } : original(path, input);
    assert.equal((await s.handlers.snapshot({}, call)).items[0].reason, reason);
  }
  for (const field of ['available', 'eligible', 'requiresPurchase']) {
    const s = setup(), original = s.cloud.request;
    s.cloud.request = async (path, input) => path.endsWith('/shop') ? { items: [{ ...catalog, [field]: 1 }] } : original(path, input);
    await rejected(s.handlers.snapshot({}, call), 'invalid_response');
  }
});

test('profile journal is fresh across workspace contexts, private, bounded and profile isolated', async () => {
  const s = setup(), first = createVoyagesRpcHandlers(s.ctx, { profileRoot: s.profileRoot, cloudClient: s.cloud, now: () => NOW });
  await getQuote(first);
  s.cloud.request = async () => { throw new Error('unknown'); };
  await rejected(first.purchase({ quoteId: 'quote-1' }, call), 'request_failed', true);
  const directory = join(s.profileRoot, 'state', 'carthagent', 'voyages');
  const [name] = (await readdir(directory)).filter(n => n.endsWith('.json'));
  const file = join(directory, name), saved = JSON.parse(await readFile(file, 'utf8'));
  // Windows uses inherited ACLs; stat mode bits cannot verify owner-only access there.
  if (process.platform !== 'win32') {
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
  }
  assert.equal(JSON.stringify(saved).includes('secret-fixture'), false);
  const otherWorkspace = { ...s.ctx, storage: { get() { throw new Error('location storage must not be used'); } } };
  let pair;
  const cloud = { request: async (_path, input) => { pair = input.body; return receipt; } };
  const second = createVoyagesRpcHandlers(otherWorkspace, { profileRoot: s.profileRoot, cloudClient: cloud, now: () => NOW });
  assert.deepEqual(await second.retryPurchase({ quoteId: 'quote-1' }, call), receipt);
  assert.deepEqual(pair, { quoteId: saved.pending.quoteId, key: saved.pending.key });
  await rejected(first.retryPurchase({ quoteId: 'quote-1' }, call), 'no_pending_purchase');
  const isolatedRoot = await mkdtemp(join(testRoot, 'isolated-'));
  await rejected(createVoyagesRpcHandlers(otherWorkspace, { profileRoot: isolatedRoot, cloudClient: cloud }).retryPurchase({ quoteId: 'quote-1' }, call), 'no_pending_purchase');
  await writeFile(file, 'x'.repeat(65537));
  await rejected(second.retryPurchase({ quoteId: 'quote-1' }, call), 'invalid_response');
});

test('separate native processes serialize profile purchases and restart replays exact pair', async () => {
  const profileRoot = await mkdtemp(join(testRoot, 'processes-'));
  const moduleUrl = fileURLToPath(new URL('../plugins/carthagent/src/server/voyages-rpc.ts', import.meta.url));
  const source = `
    import { createRequire } from 'node:module';
    import { appendFile } from 'node:fs/promises';
    const { createJiti } = createRequire(import.meta.url)('jiti');
    const { createVoyagesRpcHandlers } = await createJiti(import.meta.url).import(${JSON.stringify(moduleUrl)});
    const ctx = { integration: { connection: {
      active: async () => ({ id: 'shared-credential', type: 'credential', method: 'oauth' }),
      resolve: async () => ({ type: 'oauth', methodID: 'carthagent-device', access: 'not-persisted' }),
    } } };
    const cloud = { request: async (path, input) => {
      if (path.endsWith('/quotes')) return { quote: ${JSON.stringify(authoritativeQuote)} };
      await appendFile(${JSON.stringify(join(profileRoot, 'sent.jsonl'))}, JSON.stringify(input.body) + '\\n');
      if (process.argv[1] === 'crash') process.exit(17);
      if (process.argv[1] === 'retry') return ${JSON.stringify(receipt)};
      await new Promise(r => setTimeout(r, 150));
      throw new Error('unknown');
    } };
    const handlers = createVoyagesRpcHandlers(ctx, { profileRoot: ${JSON.stringify(profileRoot)}, cloudClient: cloud, now: () => ${NOW} });
    const call = { signal: new AbortController().signal, error(type, message, data) { throw Object.assign(new Error(message), { data }); } };
    try {
      const mode = process.argv[1];
      const result = mode === 'quote' ? await handlers.quote({ slot: 'hat', item: 'captain' }, call)
        : mode === 'retry' ? await handlers.retryPurchase({ quoteId: 'quote-1' }, call)
        : await handlers.purchase({ quoteId: 'quote-1' }, call);
      console.log(JSON.stringify(result));
    } catch (e) { console.log(JSON.stringify(e.data)); }
  `;
  function child(mode) {
    return new Promise((resolve, reject) => {
      const p = spawn(process.execPath, ['--input-type=module', '-e', source, mode], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '';
      p.stdout.on('data', chunk => { out += chunk; }); p.stderr.on('data', chunk => { err += chunk; });
      p.on('error', reject); p.on('close', code => {
        if (code !== 0) return reject(new Error(`child_exit_${code}: ${err}`));
        try { resolve(JSON.parse(out.trim())); } catch (error) { reject(error); }
      });
    });
  }
  await child('quote');
  const results = await Promise.all([child('purchase'), child('purchase')]);
  assert.deepEqual(results.map(r => r.code).sort(), ['purchase_pending', 'request_failed']);
  const sent = () => readFile(join(profileRoot, 'sent.jsonl'), 'utf8').then(text => text.trim().split('\n').map(JSON.parse));
  assert.equal((await sent()).length, 1);
  assert.deepEqual(await child('retry'), receipt);
  const pairs = await sent();
  assert.equal(pairs.length, 2); assert.deepEqual(pairs[0], pairs[1]);
  // Simulate a native service dying after the durable pair and request send.
  await child('quote');
  await assert.rejects(child('crash'), /child_exit_17/);
  assert.deepEqual(await child('retry'), receipt);
  const afterCrash = await sent();
  assert.equal(afterCrash.length, 4); assert.deepEqual(afterCrash[2], afterCrash[3]);
});
