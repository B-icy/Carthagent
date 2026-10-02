import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createShipAdvisor, createShipJev } from '../lib/ship-jev.mjs';
import { resolveShipAccessToken } from '../lib/ship-auth.mjs';
import { CARTHAGENT_SHIP_PROVIDER_ID } from '../lib/providers/names.mjs';

const plan = { goal: 'g', acceptance: [], checks: [], outputs: [], assumptions: [], design: 'd', workflow: 'w' };
const jevPayload = model => JSON.stringify({
  model, answers: { srp: { type: 'noul', noul: 0.62 }, di: { type: 'noul', noul: 0.1 }, tests: { type: 'noul', noul: 0.3 } },
  usage: { input_tokens: 120, output_tokens: 9, cost: 0 },
});

function agentDir(t, credential) {
  const dir = mkdtempSync(join(tmpdir(), 'ctg-ship-auth-'));
  writeFileSync(join(dir, 'auth.json'), JSON.stringify({ [CARTHAGENT_SHIP_PROVIDER_ID]: credential }));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('Ship Jev posts the plan state to the managed /jev endpoint', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(jevPayload('jev-latest'), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const advisor = createShipJev({ accessToken: 'tok-1', baseUrl: 'https://api.carthagent.xyz/v1', fetchImpl });
  const result = await advisor.classify(plan);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.carthagent.xyz/v1/jev');
  assert.equal(calls[0].init.headers.authorization, 'Bearer tok-1');
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.state, plan);
  assert.equal(body.model, undefined); // the backend owns the managed model choice
  assert.equal(result.probabilities.srp, 0.62);
  assert.equal(result.costUsd, 0);
});

test('resolveShipAccessToken reuses a fresh credential and refreshes an expired one', async t => {
  const fresh = agentDir(t, { type: 'oauth', access: 'live-tok', refresh: 'rt', expires: Date.now() + 3_600_000 });
  assert.equal(await resolveShipAccessToken({ agentDir: fresh }), 'live-tok');

  const stale = agentDir(t, { type: 'oauth', access: 'dead-tok', refresh: 'rt-1', expires: Date.now() - 1000 });
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(url, 'https://api.carthagent.xyz/v1/token/refresh');
    assert.equal(body.refreshToken, 'rt-1');
    return new Response(JSON.stringify({ accessToken: 'new-tok', refreshToken: 'rt-2', expiresIn: 3600, tokenType: 'Bearer' }), { status: 200 });
  };
  assert.equal(await resolveShipAccessToken({ agentDir: stale, fetchImpl }), 'new-tok');
  const stored = JSON.parse(readFileSync(join(stale, 'auth.json'), 'utf8'))[CARTHAGENT_SHIP_PROVIDER_ID];
  assert.equal(stored.access, 'new-tok');
  assert.equal(stored.refresh, 'rt-2');

  const empty = mkdtempSync(join(tmpdir(), 'ctg-ship-auth-'));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  assert.equal(await resolveShipAccessToken({ agentDir: empty }), null);
});

test('Ship advisor resolves the stored credential lazily and stays bounded', async t => {
  const dir = agentDir(t, { type: 'oauth', access: 'tok-stored', refresh: 'rt', expires: Date.now() + 3_600_000 });
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    return new Response(jevPayload('typesafe/jev-1.13.4'), { status: 200 });
  };
  const advisor = createShipAdvisor({ agentDir: dir, fetchImpl });
  const result = await advisor.classify(plan);
  assert.equal(result.probabilities.tests, 0.3);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/v1\/jev$/);

  const missing = createShipAdvisor({ agentDir: mkdtempSync(join(tmpdir(), 'ctg-ship-auth-')), fetchImpl });
  await assert.rejects(() => missing.classify(plan), /Ship credential/);
});
