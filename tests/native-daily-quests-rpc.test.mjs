import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { readFile, readdir, rm, stat, writeFile, symlink, mkdir, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JsonSchema, Schema, SchemaRepresentation } from 'effect';
import { CloudClient } from '../lib/cloud/client.mjs';
import { dailyRequest } from '../plugins/carthagent/src/daily-evidence.mjs';
const { createJiti } = createRequire(import.meta.url)('jiti');
const jiti = createJiti(import.meta.url);
const { createDailyQuestsRpcHandlers } = await jiti.import('../plugins/carthagent/src/server/daily-quests-rpc.ts');
const { DailyQuests } = await jiti.import('../plugins/carthagent/src/daily-quests-rpc.ts');
const root = mkdtempSync(join(tmpdir(), 'daily-rpc-'));
after(() => rm(root, { recursive: true, force: true }));
const NOW = Date.parse('2026-10-26T23:59:00.000Z'), DAY = 86400000;
const ID = '12345678-1234-1234-1234-123456789abc';
const ID2 = '12345678-1234-1234-1234-123456789abd';
const QID = 'abcdef01-1234-1234-1234-123456789abc';
const flags = { assessmentBasis: 'tui_submitted', rewards: false };
const evidence = { projectId: ID, outcomeId: ID, runId: ID, revision: 'a'.repeat(40), goal: 'Selected goal', change: 'Selected change', checks: [], findings: [] };
const accepted = { id: ID, questId: QID, status: 'queued', decision: null, scores: null, model: null, rubricVersion: null, attempts: 0, createdAt: new Date(NOW).toISOString(), consentAt: new Date(NOW).toISOString(), finishedAt: null, nextAttemptAt: new Date(NOW).toISOString(), errorCode: null, ...flags };
const graded = { ...accepted, status: 'graded', decision: 'not_met', scores: { outcome: 0.1, 'dynamic-criterion': 0.5 }, model: 'jev-model', rubricVersion: 'daily-rubric-v1:test', attempts: 1, finishedAt: new Date(NOW + 120000).toISOString(), nextAttemptAt: null };
const quest = { id: QID, day: '2026-10-26', definition: { templateId: 'change-v1', title: 'A real backend objective', kind: 'change', rubricVersion: 'daily-rubric-v1:test', criteria: [{ id: 'outcome', text: 'Concrete outcome?' }] }, status: 'open', endsAt: '2026-10-27T00:00:00.000Z', completedAt: null, ...flags };
const slate = { day: quest.day, endsAt: quest.endsAt, policyVersion: 'daily-outcomes-v1', items: [quest, ...['tests', 'review'].map((kind, i) => ({ ...quest, id: QID.slice(0, -1) + (i + 1), definition: { ...quest.definition, kind } }))], ...flags };
const call = { signal: new AbortController().signal, error(type, message, data) { throw Object.assign(new Error(message), { type, data }); } };
function setup({ disk = false } = {}) {
  const profileRoot = mkdtempSync(join(root, 'profile-')), data = new Map(), requests = [], writes = [];
  let account = 'credential-a', time = NOW;
  const ctx = { integration: { connection: {
    active: async integration => { assert.equal(integration, 'experiential-labs'); return account ? { id: account, type: 'credential', method: 'oauth' } : undefined; },
    resolve: async () => ({ type: 'oauth', methodID: 'carthagent-device', access: 'never-persist-token' }),
  } } };
  const cloud = { request: async (path, input) => {
    requests.push({ path, ...input, body: input.body ? structuredClone(input.body) : undefined });
    if (path === '/v1/voyages/daily-quests') return structuredClone(slate);
    if (path === `/v1/voyages/daily-quests/${QID}`) return { ...structuredClone(quest), latestSubmission: null };
    if (path.startsWith('/v1/voyages/daily-submissions/')) throw Object.assign(new Error('not found'), { code: 'not_found', status: 404 });
    return { submission: structuredClone(accepted) };
  } };
  const journal = { get: async file => structuredClone(data.get(file)), set: async (file, state) => { writes.push(structuredClone(state)); data.set(file, structuredClone(state)); } };
  const make = (baseUrl = 'https://api.example.test') => createDailyQuestsRpcHandlers(ctx, { cloudClient: cloud, baseUrl, now: () => time, profileRoot, ...(disk ? {} : { journal }) });
  return { ctx, cloud, journal, profileRoot, make, handlers: make(), data, requests, writes, switchAccount: id => { account = id; }, setTime: n => { time = n; } };
}
const rejected = (promise, code, uncertain = false) => assert.rejects(promise, error => error.type === 'dailyQuestError' && error.message === code && error.data.code === code && error.data.uncertain === uncertain);
const key = async s => (await s.handlers.snapshot({}, call)).accountKey;
const send = async (s, overrides = {}, invocation = call) => s.handlers.submit({ accountKey: await key(s), questId: QID, id: ID, consent: true, evidence, ...overrides }, invocation);
const raw = s => [...s.data.values()][0]?.records[0];
const unknown = s => { const original = s.cloud.request; s.cloud.request = async (path, input) => { const result = await original(path, input); if (input.method === 'POST') throw new Error('private network error'); return result; }; };

test('fixed six-method contract converts through actual pinned Effect with nullable dynamic scores', () => {
  assert.equal(DailyQuests.id, 'carthagent.dailyQuests');
  assert.deepEqual(Object.keys(DailyQuests.methods), ['snapshot', 'detail', 'submit', 'retry', 'poll', 'forgetPayload']);
  const accountKey = 'a'.repeat(64), record = { id: ID, questId: QID, createdAt: accepted.createdAt, request: dailyRequest(ID, evidence), submission: null };
  const samples = {
    snapshot: [{}, { accountKey, slate, records: [record, { ...record, id: ID2, request: null, submission: { ...graded, id: ID2 } }] }],
    detail: [{ id: QID }, { ...quest, latestSubmission: accepted }],
    submit: [{ accountKey, questId: QID, ...dailyRequest(ID, evidence) }, { submission: accepted }],
    retry: [{ accountKey, id: ID }, { submission: graded }], poll: [{ id: ID }, { submission: accepted }],
    forgetPayload: [{ accountKey, id: ID }, { ok: true }],
  };
  const decode = (schema, value) => Schema.decodeUnknownSync(SchemaRepresentation.fromJsonSchemaDocument(JsonSchema.fromSchemaDraft2020_12(schema)))(value);
  assert.throws(() => decode({ type: 'string', pattern: '^[a-z]+$' }, 'foo'));
  for (const [name, method] of Object.entries(DailyQuests.methods)) {
    assert.deepEqual(decode(method.input, samples[name][0]), samples[name][0], `${name}:input`);
    assert.deepEqual(decode(method.output, samples[name][1]), samples[name][1], `${name}:output`);
    const error = { code: 'daily_quest_expired', status: 409, uncertain: false };
    assert.deepEqual(decode(method.errors.dailyQuestError, error), error);
  }
  assert.throws(() => decode(DailyQuests.methods.submit.input, { ...samples.submit[0], consent: false }));
  assert.throws(() => decode(DailyQuests.methods.retry.output, { submission: { ...graded, scores: { outcome: 2 } } }));
  assert.deepEqual(decode(DailyQuests.methods.detail.output, { ...quest, latestSubmission: null }), { ...quest, latestSubmission: null });
});
test('snapshot, flat detail and explicit poll are GET-only, native bearer/no cookies, safe DTOs', async () => {
  const s = setup(), snapshot = await s.handlers.snapshot({}, call);
  assert.match(snapshot.accountKey, /^[a-f0-9]{64}$/); assert.deepEqual(snapshot.slate, slate); assert.deepEqual(snapshot.records, []);
  assert.deepEqual(await s.handlers.detail({ id: QID }, call), { ...quest, latestSubmission: null });
  const base = s.cloud.request;
  s.cloud.request = async (path, input) => path.includes('daily-submissions/') ? { submission: accepted } : base(path, input);
  assert.deepEqual(await s.handlers.poll({ id: ID }, call), { submission: accepted });
  assert.equal(raw(s).request, null);
  assert.ok(s.requests.every(r => r.method === 'GET' && r.accessToken === 'never-persist-token' && r.signal === call.signal));
  assert.equal(JSON.stringify(snapshot).includes('never-persist-token'), false);
  const wire = [];
  const cloud = new CloudClient({ baseUrl: 'https://api.example.test', fetchImpl: async (url, init) => { wire.push({ url, ...init }); return { ok: true, text: async () => JSON.stringify(slate) }; } });
  await createDailyQuestsRpcHandlers(s.ctx, { profileRoot: s.profileRoot, cloudClient: cloud, journal: s.journal }).snapshot({}, call);
  assert.deepEqual(wire[0].headers, { accept: 'application/json', authorization: 'Bearer never-persist-token' });
});
test('consent and evidence are validated server-side before any POST or storage', async () => {
  const s = setup();
  for (const consent of [false, undefined, 'true', 1]) await rejected(send(s, { consent }), 'daily_consent_required');
  await rejected(send(s, { evidence: { ...evidence, goal: 'x'.repeat(1025) } }), 'invalid_daily_evidence');
  await rejected(send(s, { id: 'not-uuid' }), 'invalid_daily_evidence');
  assert.equal(s.requests.filter(r => r.method === 'POST').length, 0); assert.equal(s.writes.length, 0);
});
test('durable exact frozen request precedes POST; queued acceptance erases raw immediately, never means completed', async () => {
  const s = setup(), base = s.cloud.request;
  s.cloud.request = async (path, input) => {
    if (input.method === 'POST') assert.deepEqual(raw(s).request, input.body);
    return base(path, input);
  };
  const result = await send(s, { evidence: { ...evidence, goal: ' \r\n selected \r goal ' } });
  assert.equal(result.submission.status, 'queued'); assert.equal(result.submission.decision, null);
  assert.equal(raw(s).request, null); assert.deepEqual(raw(s).submission, accepted);
  assert.equal(s.writes[0].records[0].request.evidence.goal, 'selected \n goal');
  const post = s.requests.find(r => r.method === 'POST');
  assert.equal(post.path, `/v1/voyages/daily-quests/${QID}/submissions`);
  assert.deepEqual(Object.keys(post.body), ['id', 'consent', 'evidence']);
  await rejected(send(s), 'submission_exists');
});
test('persist failure and cancellation during write produce zero POSTs, no implicit replay', async () => {
  const s = setup(); s.journal.set = async () => { throw new Error('private disk path'); };
  await rejected(send(s), 'storage_failed'); assert.equal(s.requests.filter(r => r.method === 'POST').length, 0);
  const t = setup(), controller = new AbortController(), save = t.journal.set;
  t.journal.set = async (...args) => { await save(...args); controller.abort(new Error('private cancellation')); };
  await rejected(send(t, {}, { ...call, signal: controller.signal }), 'request_failed', true);
  assert.ok(raw(t).request); assert.equal(t.requests.filter(r => r.method === 'POST').length, 0);
  await t.handlers.snapshot({}, call); assert.equal(t.requests.filter(r => r.method === 'POST').length, 0);
});
test('unknown results survive handler restart, block profile-wide new submissions and replay only exact frozen body', async () => {
  const s = setup(), original = s.cloud.request; unknown(s);
  await rejected(send(s), 'request_failed', true);
  const frozen = structuredClone(raw(s).request), accountKey = await key(s);
  const restarted = s.make();
  assert.deepEqual((await restarted.snapshot({}, call)).records[0].request, frozen);
  await rejected(restarted.submit({ accountKey, questId: QID, id: ID2, consent: true, evidence }, call), 'submission_pending', true);
  s.cloud.request = original;
  assert.deepEqual(await restarted.retry({ accountKey, id: ID }, call), { submission: accepted });
  assert.deepEqual(s.requests.filter(r => r.method === 'POST').map(r => r.body), [frozen, frozen]);
  assert.equal(raw(s).request, null);
  await rejected(restarted.retry({ accountKey, id: ID }, call), 'no_pending_payload');
});
test('retry reconciles GET first, never blindly replays after auth, conflict or outage, malformed reconciliation retains raw', async () => {
  for (const [code, status] of [['invalid_token', 401], ['insufficient_scope', 403], ['key_conflict', 409], ['private', 503]]) {
    const s = setup(); unknown(s); await rejected(send(s), 'request_failed', true);
    const accountKey = await key(s), frozen = structuredClone(raw(s).request), count = s.requests.length;
    s.cloud.request = async () => { throw Object.assign(new Error('private'), { code, status }); };
    await rejected(s.handlers.retry({ accountKey, id: ID }, call), code === 'private' ? 'request_rejected' : code, true);
    assert.deepEqual(raw(s).request, frozen); assert.equal(s.requests.length, count);
  }
  const s = setup(); unknown(s); await rejected(send(s), 'request_failed', true);
  const accountKey = await key(s); s.cloud.request = async () => ({ submission: { ...accepted, id: ID2 } });
  await rejected(s.handlers.retry({ accountKey, id: ID }, call), 'invalid_response', true); assert.ok(raw(s).request);
  s.cloud.request = async () => ({ submission: accepted });
  assert.deepEqual(await s.handlers.retry({ accountKey, id: ID }, call), { submission: accepted }); assert.equal(raw(s).request, null);
});
test('fresh definitive backend rejections remove records; unknown errors and all retry POST errors retain them', async () => {
  const definitive = [[400, 'invalid_body'], [401, 'invalid_token'], [403, 'insufficient_scope'], [404, 'not_found'], [409, 'daily_quest_expired'], [429, 'rate_limited']];
  for (const [status, code] of definitive) {
    const s = setup(), original = s.cloud.request;
    s.cloud.request = async (path, input) => { if (input.method === 'POST') throw Object.assign(new Error('private'), { code, status }); return original(path, input); };
    await rejected(send(s), code);
    assert.equal(raw(s), undefined); assert.deepEqual((await s.make().snapshot({}, call)).records, []);
  }
  for (const status of [400, 401, 403, 404, 409, 429, 500, 503, 0]) {
    const s = setup(), original = s.cloud.request;
    s.cloud.request = async (path, input) => { if (input.method === 'POST') throw Object.assign(new Error('private proxy response'), { code: 'private', status }); return original(path, input); };
    await rejected(send(s), status ? 'request_rejected' : 'request_failed', true);
    assert.ok(raw(s).request); assert.equal(raw(s).id, ID); assert.equal(raw(s).submission, null);
  }
  for (const status of [400, 401, 403, 404, 409, 429, 503]) {
    const s = setup(), original = s.cloud.request; unknown(s); await rejected(send(s), 'request_failed', true);
    const accountKey = await key(s);
    s.cloud.request = async (path, input) => { if (input.method === 'POST') throw Object.assign(new Error('private'), { code: 'key_conflict', status }); return original(path, input); };
    await rejected(s.handlers.retry({ accountKey, id: ID }, call), 'key_conflict', true); assert.ok(raw(s).request);
  }
});
test('more than 64 definitive fresh rejections never fill the journal or invent acceptance, preserving unknown IDs', async () => {
  const s = setup(), original = s.cloud.request; unknown(s);
  await rejected(send(s), 'request_failed', true);
  const accountKey = await key(s);
  await s.handlers.forgetPayload({ accountKey, id: ID }, call);
  const unresolved = structuredClone(raw(s));
  const definitive = [[400, 'invalid_body'], [401, 'invalid_token'], [403, 'insufficient_scope'], [404, 'not_found'], [409, 'daily_quest_expired'], [429, 'rate_limited']];
  let dispatched = 0;
  for (let i = 0; i < 66; i++) {
    const [status, code] = definitive[i % definitive.length];
    s.cloud.request = async (path, input) => {
      if (input.method === 'POST') { dispatched++; throw Object.assign(new Error('private'), { code, status }); }
      return original(path, input);
    };
    const id = `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`;
    await rejected(s.make().submit({ accountKey, questId: QID, id, consent: true, evidence }, call), code);
    assert.deepEqual((await s.make().snapshot({}, call)).records, [unresolved]);
  }
  assert.equal(dispatched, 66);
  assert.ok(s.writes.every(state => state.records.every(record => record.submission === null)));
  s.cloud.request = original; unknown(s);
  await rejected(send(s, { id: ID2 }), 'request_failed', true);
  const records = (await s.make().snapshot({}, call)).records;
  assert.deepEqual(records[0], unresolved);
  assert.deepEqual(records[1].request, dailyRequest(ID2, evidence));
  assert.equal(records[1].submission, null);
});
test('failed definitive-rejection deletion retains the durable disk record and reports uncertainty', async () => {
  const s = setup(), accountKey = await key(s);
  let file, saves = 0;
  const journal = {
    get: async path => {
      try { return JSON.parse(await readFile(path, 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
    },
    set: async (path, state) => {
      file = path;
      if (++saves > 1) throw new Error('private disk failure');
      await writeFile(path, JSON.stringify(state), { mode: 0o600 });
    },
  };
  s.cloud.request = async () => { throw Object.assign(new Error('private rejection'), { code: 'daily_quest_expired', status: 409 }); };
  const handlers = createDailyQuestsRpcHandlers(s.ctx, { profileRoot: s.profileRoot, baseUrl: 'https://api.example.test', cloudClient: s.cloud, now: () => NOW, journal });
  await rejected(handlers.submit({ accountKey, questId: QID, id: ID, consent: true, evidence }, call), 'storage_failed', true);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.records.length, 1); assert.deepEqual(saved.records[0].request, dailyRequest(ID, evidence));
  assert.equal(saved.records[0].submission, null);
  s.cloud.request = async () => structuredClone(slate);
  assert.deepEqual((await handlers.snapshot({}, call)).records, saved.records);
});
test('account-key mutations, identity checks around every request, profile and API isolation', async () => {
  const s = setup(), accountKey = await key(s); unknown(s); await rejected(send(s), 'request_failed', true);
  s.switchAccount('credential-b'); const b = await key(s); assert.notEqual(b, accountKey);
  for (const method of ['submit', 'retry', 'forgetPayload']) await rejected(s.handlers[method]({ accountKey, id: ID, questId: QID, consent: true, evidence }, call), 'account_changed');
  assert.deepEqual((await s.handlers.snapshot({}, call)).records, []);
  s.switchAccount('credential-a');
  assert.equal((await s.make('https://other.example.test').snapshot({}, call)).records.length, 0);
  assert.equal((await s.handlers.snapshot({}, call)).records.length, 1);
  const t = setup(), original = t.cloud.request;
  t.cloud.request = async (path, input) => { const result = await original(path, input); if (input.method === 'POST') t.switchAccount('credential-b'); return result; };
  await rejected(send(t), 'account_changed', true); assert.ok(raw(t).request);
  t.switchAccount(undefined); await rejected(t.handlers.snapshot({}, call), 'authentication_required');
  t.switchAccount('credential-a'); t.ctx.integration.connection.resolve = async () => ({ type: 'oauth', methodID: 'wrong', access: 'private' });
  await rejected(t.handlers.snapshot({}, call), 'authentication_required');
});
test('midnight polling retains ID, terminal erases payload, graded alone is not assessed complete', async () => {
  const s = setup(); unknown(s); await rejected(send(s), 'request_failed', true);
  s.setTime(NOW + 120000); s.cloud.request = async () => ({ submission: graded });
  assert.deepEqual(await s.handlers.poll({ id: ID }, call), { submission: graded });
  assert.equal(raw(s).request, null); assert.equal(raw(s).id, ID); assert.equal(raw(s).questId, QID);
  assert.equal(raw(s).submission.decision, 'not_met'); assert.equal(raw(s).submission.rewards, false);
});
test('24h raw expiry and explicit forgetting persist erasure, preserve unresolved ID indefinitely and never auto POST', async () => {
  const s = setup(); unknown(s); await rejected(send(s), 'request_failed', true);
  s.setTime(NOW + DAY); const snapshot = await s.handlers.snapshot({}, call);
  assert.equal(snapshot.records[0].request, null); assert.equal(raw(s).request, null); assert.equal(raw(s).id, ID);
  s.setTime(NOW + 100 * DAY); assert.equal((await s.handlers.snapshot({}, call)).records[0].id, ID);
  assert.equal(s.requests.filter(r => r.method === 'POST').length, 1);
  const t = setup(); unknown(t); await rejected(send(t), 'request_failed', true);
  assert.deepEqual(await t.handlers.forgetPayload({ accountKey: await key(t), id: ID }, call), { ok: true });
  assert.equal(raw(t).request, null); assert.equal(raw(t).id, ID);
  await rejected(t.handlers.retry({ accountKey: await key(t), id: ID }, call), 'no_pending_payload');
});
test('90-day known terminal retention and full unknown journal fail closed rather than evict unresolved IDs', async () => {
  const s = setup(); s.cloud.request = async () => ({ submission: graded });
  await s.handlers.poll({ id: ID }, call);
  s.setTime(NOW + 90 * DAY); s.cloud.request = async () => structuredClone(slate);
  assert.deepEqual((await s.handlers.snapshot({}, call)).records, []);
  const t = setup(); await send(t); const [file] = t.data.keys();
  t.data.set(file, { version: 1, records: Array.from({ length: 64 }, (_, i) => ({ id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`, questId: QID, createdAt: accepted.createdAt, request: null, submission: null })) });
  await rejected(send(t), 'journal_full'); assert.equal(t.data.get(file).records.length, 64);
});
test('concurrent different IDs serialize across handler instances; only one unknown payload may dispatch', async () => {
  const s = setup(), accountKey = await key(s), original = s.cloud.request;
  s.cloud.request = async (path, input) => {
    const result = await original(path, input);
    if (input.method === 'POST') { await new Promise(resolve => setTimeout(resolve, 30)); throw new Error('unknown'); }
    return result;
  };
  const results = await Promise.allSettled([ID, ID2].map(id => s.make().submit({ accountKey, questId: QID, id, consent: true, evidence }, call)));
  assert.deepEqual(results.map(r => r.reason.data.code).sort(), ['request_failed', 'submission_pending']);
  assert.equal(s.requests.filter(r => r.method === 'POST').length, 1);
  assert.equal([...s.data.values()][0].records.length, 1);
});
test('retention erasure failure prevents further HTTP; acceptance erasure failure preserves recovery on disk', async () => {
  const s = setup(); unknown(s); await rejected(send(s), 'request_failed', true);
  s.setTime(NOW + DAY); const before = s.requests.length;
  s.journal.set = async () => { throw new Error('disk failure'); };
  await rejected(s.handlers.snapshot({}, call), 'storage_failed');
  assert.equal(s.requests.length, before); assert.ok(raw(s).request);
  const t = setup(), original = t.cloud.request, save = t.journal.set;
  t.cloud.request = async (path, input) => { const result = await original(path, input); if (input.method === 'POST') t.journal.set = async () => { throw new Error('disk failure'); }; return result; };
  await rejected(send(t), 'storage_failed', true); assert.ok(raw(t).request);
  t.journal.set = save; t.cloud.request = async () => ({ submission: accepted });
  assert.deepEqual(await t.make().poll({ id: ID }, call), { submission: accepted }); assert.equal(raw(t).request, null);
});
test('full journal evicts only oldest known terminal; active and unresolved records remain', async () => {
  const s = setup(); await send(s); const [file] = s.data.keys();
  const records = Array.from({ length: 64 }, (_, i) => {
    const id = `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`;
    return { id, questId: QID, createdAt: new Date(NOW + i).toISOString(), request: null, submission: i < 2 ? { ...graded, id } : i === 2 ? { ...accepted, id } : null };
  });
  s.data.set(file, { version: 1, records });
  await send(s);
  const saved = s.data.get(file).records;
  assert.equal(saved.length, 64); assert.equal(saved.some(r => r.id === records[0].id), false);
  assert.ok(saved.some(r => r.id === records[1].id)); assert.ok(saved.some(r => r.id === records[2].id));
  assert.ok(saved.some(r => r.id === records[63].id));
});
test('bounded validators reject malformed DTOs and identity mismatches without dropping unknown raw', async () => {
  for (const mutate of [s => { s.id = ID2; }, s => { s.questId = ID2; }, s => { s.scores = { criterion: 2 }; }, s => { s.attempts = 5; }, s => { s.rewards = true; }, s => { s.status = 'expired'; }, s => { s.decision = 'assessed_complete'; }, s => { s.finishedAt = '2026-02-30T00:00:00Z'; }]) {
    const s = setup(), original = s.cloud.request, dto = structuredClone(accepted); mutate(dto);
    s.cloud.request = async (path, input) => input.method === 'POST' ? { submission: dto } : original(path, input);
    await rejected(send(s), 'invalid_response', true); assert.ok(raw(s).request);
  }
  const s = setup(); unknown(s); await rejected(send(s), 'request_failed', true);
  s.cloud.request = async () => ({ submission: { ...graded, questId: ID2 } });
  await rejected(s.handlers.poll({ id: ID }, call), 'invalid_response'); assert.ok(raw(s).request);
  s.cloud.request = async () => ({ ...quest, id: ID2, latestSubmission: null });
  await rejected(s.handlers.detail({ id: QID }, call), 'invalid_response');
});
test('queued/grading errorCode remains nonterminal metadata; safe backend errors never echo raw detail', async () => {
  for (const status of ['queued', 'grading']) {
    const s = setup(), dto = { ...accepted, status, errorCode: 'daily_grader_timeout', nextAttemptAt: status === 'grading' ? null : accepted.nextAttemptAt };
    s.cloud.request = async () => ({ submission: dto });
    assert.equal((await s.handlers.poll({ id: ID }, call)).submission.status, status);
    assert.equal(raw(s).request, null);
  }
  const s = setup(); s.cloud.request = async () => { throw Object.assign(new Error('private-token'), { code: 'private-token', detail: 'private-token', status: 503 }); };
  await rejected(s.handlers.snapshot({}, call), 'request_rejected');
});
test('private disk journal, corrupt and oversized files, symlinks fail closed and avoid all POSTs', async () => {
  const s = setup({ disk: true }); unknown(s); await rejected(send(s), 'request_failed', true);
  const directory = join(s.profileRoot, 'state', 'carthagent', 'daily-quests'), [name] = (await readdir(directory)).filter(n => n.endsWith('.json')), file = join(directory, name);
  if (process.platform !== 'win32') { assert.equal((await stat(file)).mode & 0o777, 0o600); assert.equal((await stat(directory)).mode & 0o777, 0o700); }
  const saved = await readFile(file, 'utf8'); assert.equal(saved.includes('never-persist-token'), false);
  for (const bad of ['{broken', 'x'.repeat(262145), JSON.stringify({ version: 1, records: [{}] })]) {
    await writeFile(file, bad); const before = s.requests.length;
    await rejected(s.make().submit({ accountKey: name.slice(0, -5), questId: QID, id: ID2, consent: true, evidence }, call), 'journal_invalid');
    assert.equal(s.requests.length, before);
  }
  await rm(file); const target = join(s.profileRoot, 'target.json'); await writeFile(target, saved); await symlink(target, file);
  const before = s.requests.length;
  for (const invoke of [
    () => s.handlers.snapshot({}, call),
    () => s.handlers.submit({ accountKey: name.slice(0, -5), questId: QID, id: ID2, consent: true, evidence }, call),
  ]) await rejected(invoke(), 'journal_invalid');
  assert.equal(s.requests.length, before); assert.equal(await readFile(target, 'utf8'), saved);
  await rm(target); // A dangling link must not be mistaken for an absent journal.
  await rejected(s.handlers.snapshot({}, call), 'journal_invalid');
  assert.equal(s.requests.length, before);
});
test('locked journal access erases only exact account staging files, with main present or absent, without following symlinks', async () => {
  for (const mode of ['absent', 'expired', 'forget']) {
    const s = setup({ disk: true }), accountKey = await key(s);
    const directory = join(s.profileRoot, 'state', 'carthagent', 'daily-quests');
    const file = join(directory, `${accountKey}.json`);
    const record = { id: ID, questId: QID, createdAt: accepted.createdAt, request: dailyRequest(ID, { ...evidence, goal: 'private orphan evidence' }), submission: null };
    const state = JSON.stringify({ version: 1, records: [record] });
    if (mode !== 'absent') await writeFile(file, state, { mode: 0o600 });
    // Crash after staging bytes/fsync, before rename, including when the main
    // file was never created. A live-looking PID is safe under the scope lock.
    const staging = `${file}.${process.pid}.${ID}.tmp`;
    await writeFile(staging, state, { mode: 0o600 });
    const target = join(s.profileRoot, 'untouched-target.txt');
    await writeFile(target, 'target must remain');
    const link = `${file}.123.${ID2}.tmp`;
    await symlink(target, link);
    const ignored = [
      `${file}.0.${ID}.tmp`, `${file}.01.${ID}.tmp`, `${file}.-1.${ID}.tmp`,
      `${file}.123.not-uuid.tmp`, `${file}.123.${ID}.tmp.backup`,
      join(directory, `${'f'.repeat(64)}.json.123.${ID}.tmp`),
      join(directory, `unrelated.json.123.${ID}.tmp`),
    ];
    for (const path of ignored) await writeFile(path, 'unrelated contents');
    const nonfile = `${file}.456.${ID2}.tmp`;
    await mkdir(nonfile); await writeFile(join(nonfile, 'child'), 'directory contents');
    if (mode === 'expired') s.setTime(NOW + DAY);
    const original = s.cloud.request;
    s.cloud.request = async (path, input) => {
      await assert.rejects(lstat(staging), { code: 'ENOENT' });
      await assert.rejects(lstat(link), { code: 'ENOENT' });
      return original(path, input);
    };
    if (mode === 'forget') assert.deepEqual(await s.make().forgetPayload({ accountKey, id: ID }, call), { ok: true });
    else {
      const snapshot = await s.make().snapshot({}, call);
      assert.deepEqual(snapshot.records, mode === 'absent' ? [] : [{ ...record, request: null }]);
      assert.equal(JSON.stringify(snapshot).includes('private orphan evidence'), false);
    }
    await assert.rejects(lstat(staging), { code: 'ENOENT' });
    await assert.rejects(lstat(link), { code: 'ENOENT' });
    assert.equal(await readFile(target, 'utf8'), 'target must remain');
    for (const path of ignored) assert.equal(await readFile(path, 'utf8'), 'unrelated contents');
    assert.equal(await readFile(join(nonfile, 'child'), 'utf8'), 'directory contents');
    if (mode === 'absent') await assert.rejects(lstat(file), { code: 'ENOENT' });
    else assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).records, [{ ...record, request: null }]);
    assert.equal(s.requests.some(r => r.method === 'POST'), false);
  }
});
test('staging cleanup failure is under the account lock, precedes main read and blocks HTTP without changing records', async () => {
  const s = setup(); unknown(s); await rejected(send(s), 'request_failed', true);
  const accountKey = await key(s), before = structuredClone([...s.data.entries()]);
  let reads = 0, cleanups = 0;
  s.journal.cleanup = async file => {
    assert.equal(file.endsWith(`${accountKey}.json`), true);
    assert.equal((await stat(file.slice(0, -5) + '.lock')).isFile(), true);
    cleanups++;
    throw new Error('private cleanup path and contents');
  };
  s.journal.get = async () => { reads++; assert.fail('cleanup failure must precede journal read'); };
  const requests = s.requests.length;
  await rejected(s.handlers.snapshot({}, call), 'storage_failed');
  await rejected(s.handlers.forgetPayload({ accountKey, id: ID }, call), 'storage_failed');
  await rejected(s.handlers.submit({ accountKey, questId: QID, id: ID2, consent: true, evidence }, call), 'storage_failed');
  assert.equal(cleanups, 3); assert.equal(reads, 0); assert.equal(s.requests.length, requests);
  assert.deepEqual([...s.data.entries()], before);
});
test('cross-process serialization and crash/restart replay preserve the exact canonical UUID/body', async () => {
  const profileRoot = mkdtempSync(join(root, 'processes-'));
  const module = fileURLToPath(new URL('../plugins/carthagent/src/server/daily-quests-rpc.ts', import.meta.url));
  const source = `
    import { createRequire } from 'node:module';
    import { appendFile } from 'node:fs/promises';
    const { createJiti } = createRequire(import.meta.url)('jiti');
    const { createDailyQuestsRpcHandlers } = await createJiti(import.meta.url).import(${JSON.stringify(module)});
    const ctx = { integration: { connection: {
      active: async () => ({ id: 'shared-account', type: 'credential', method: 'oauth' }),
      resolve: async () => ({ type: 'oauth', methodID: 'carthagent-device', access: 'not-persisted' }),
    } } };
    const cloud = { request: async (path, input) => {
      if (path === '/v1/voyages/daily-quests') return ${JSON.stringify(slate)};
      if (input.method === 'GET') throw Object.assign(new Error('absent'), { code: 'not_found', status: 404 });
      await appendFile(${JSON.stringify(join(profileRoot, 'sent.jsonl'))}, JSON.stringify(input.body) + '\\n');
      if (process.argv[1] === 'crash') process.exit(17);
      if (process.argv[1].startsWith('retry')) return { submission: { ...${JSON.stringify(accepted)}, id: input.body.id } };
      await new Promise(r => setTimeout(r, 100)); throw new Error('unknown');
    } };
    const h = createDailyQuestsRpcHandlers(ctx, { cloudClient: cloud, profileRoot: ${JSON.stringify(profileRoot)}, now: () => ${NOW} });
    const call = { signal: new AbortController().signal, error(type, message, data) { throw Object.assign(new Error(message), { data }); } };
    try {
      const { accountKey } = await h.snapshot({}, call);
      const result = process.argv[1].startsWith('retry') ? await h.retry({ accountKey, id: process.argv[1] === 'retry-crash' ? ${JSON.stringify(ID2)} : ${JSON.stringify(ID)} }, call)
        : await h.submit({ accountKey, questId: ${JSON.stringify(QID)}, id: process.argv[1] === 'crash' ? ${JSON.stringify(ID2)} : ${JSON.stringify(ID)}, consent: true, evidence: ${JSON.stringify(evidence)} }, call);
      console.log(JSON.stringify(result));
    } catch(e) { console.log(JSON.stringify(e.data)); }
  `;
  const child = mode => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', source, mode], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; p.stdout.on('data', x => { out += x; }); p.stderr.on('data', x => { err += x; });
    p.on('error', reject); p.on('close', code => { if (code) return reject(new Error(`child_exit_${code}: ${err}`)); try { resolve(JSON.parse(out.trim())); } catch (error) { reject(error); } });
  });
  const results = await Promise.all([child('submit'), child('submit')]);
  assert.deepEqual(results.map(r => r.code).sort(), ['request_failed', 'submission_exists']);
  assert.deepEqual(await child('retry'), { submission: accepted });
  const sent = (await readFile(join(profileRoot, 'sent.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(sent.length, 2); assert.deepEqual(sent[0], sent[1]);
  await assert.rejects(child('crash'), /child_exit_17/);
  const directory = join(profileRoot, 'state', 'carthagent', 'daily-quests');
  const [name] = (await readdir(directory)).filter(n => n.endsWith('.json'));
  const state = JSON.parse(await readFile(join(directory, name), 'utf8'));
  assert.equal(state.records.find(r => r.id === ID2).request.id, ID2);
  assert.deepEqual(await child('retry-crash'), { submission: { ...accepted, id: ID2 } });
  const afterCrash = (await readFile(join(profileRoot, 'sent.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(afterCrash.length, 4); assert.deepEqual(afterCrash[2], afterCrash[3]);
});
