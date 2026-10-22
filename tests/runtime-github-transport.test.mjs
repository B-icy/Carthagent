import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntimeGithubFetch } from '../lib/opencode/runtime-github-transport.mjs';

const token = 'fixture-token-never-real';
const base = 'https://github.com/B-icy/Carthagent/releases/download/v9.8.7';
const api = 'https://api.github.com/repos/B-icy/Carthagent';
const runtimeAsset = 'opencode-linux-x64.tar.gz';

test('draft transport uses bounded paginated exact-tag and exact-asset API GETs', async () => {
  const requests = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    requests.push({ url, init });
    if (url.pathname === '/repos/B-icy/Carthagent/releases') {
      if (url.searchParams.get('page') === '1') return Response.json(Array.from({ length: 100 }, (_, index) => ({ id: index + 1, tag_name: `v0.0.${index}` })));
      return Response.json([{ id: 88, tag_name: 'v9.8.7' }]);
    }
    if (url.pathname === '/repos/B-icy/Carthagent/releases/88/assets') {
      if (url.searchParams.get('page') === '1') return Response.json(Array.from({ length: 100 }, (_, index) => ({ id: index + 200, name: `other-${index}` })));
      return Response.json([{ id: 777, name: runtimeAsset, state: 'uploaded', size: 5, url: `${api}/releases/assets/777` }]);
    }
    if (url.pathname === '/repos/B-icy/Carthagent/releases/assets/777') return new Response('bytes');
    assert.fail(`Unexpected URL ${url.href}`);
  };
  const fetch = createRuntimeGithubFetch({ token, fetchImpl });
  const response = await fetch(`${base}/${runtimeAsset}`, { redirect: 'manual' });
  assert.equal(await response.text(), 'bytes');
  assert.equal(requests.length, 5);
  assert.deepEqual(requests.map(({ url }) => url.searchParams.get('page')), ['1', '2', '1', '2', null]);
  for (const { init } of requests) {
    assert.equal(init.method, 'GET');
    assert.equal(init.headers.authorization, `Bearer ${token}`);
    assert.equal(init.redirect, 'manual');
  }
});

test('asset redirect is fetched without forwarding GitHub authorization', async () => {
  const requests = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    requests.push({ url, init });
    if (url.pathname === '/repos/B-icy/Carthagent/releases') return Response.json([{ id: 88, tag_name: 'v9.8.7' }]);
    if (url.pathname === '/repos/B-icy/Carthagent/releases/88/assets') return Response.json([{ id: 777, name: runtimeAsset, state: 'uploaded', size: 5, url: `${api}/releases/assets/777` }]);
    if (url.pathname === '/repos/B-icy/Carthagent/releases/assets/777') return new Response(null, { status: 302, headers: { location: 'https://cdn.example.test/signed?id=1' } });
    if (url.origin === 'https://cdn.example.test') return new Response('bytes');
    assert.fail(`Unexpected URL ${url.href}`);
  };
  const fetch = createRuntimeGithubFetch({ token, fetchImpl });
  const first = await fetch(`${base}/${runtimeAsset}`, { redirect: 'manual' });
  assert.equal(first.status, 302);
  const redirected = await fetch(first.headers.get('location'), { redirect: 'manual' });
  assert.equal(await redirected.text(), 'bytes');
  assert.equal(requests.length, 4);
  assert.ok(requests.slice(0, 3).every(({ init }) => init.headers.authorization === `Bearer ${token}`));
  assert.equal(requests[3].init.headers?.authorization, undefined);
});

test('explicit transport fails closed for absent, duplicate, malformed, or unavailable exact release', async () => {
  const cases = [
    { releases: [], message: /release was not found/ },
    { releases: [{ id: 1, tag_name: 'v9.8.7' }, { id: 2, tag_name: 'v9.8.7' }], message: /duplicate exact-version/ },
    { releases: [{ id: '88', tag_name: 'v9.8.7' }], message: /invalid exact-version/ },
    { failure: true, message: /failed before a response/ },
  ];
  for (const item of cases) {
    const fetch = createRuntimeGithubFetch({ token, fetchImpl: async () => {
      if (item.failure) throw new Error(`request leaked ${token}`);
      return Response.json(item.releases);
    } });
    await assert.rejects(fetch(`${base}/${runtimeAsset}`), (error) => {
      assert.match(error.message, item.message);
      assert.equal(error.message.includes(token), false);
      return true;
    });
  }
});

test('rejects unexpected and duplicate exact assets without downloading bytes', async () => {
  for (const [assets, message] of [
    [[], /asset .* was not found/],
    [[777, 778].map((id) => ({ id, name: runtimeAsset, state: 'uploaded', size: 5, url: `${api}/releases/assets/${id}` })), /duplicate .* assets/],
  ]) {
    const fetch = createRuntimeGithubFetch({ token, fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname === '/repos/B-icy/Carthagent/releases') return Response.json([{ id: 88, tag_name: 'v9.8.7' }]);
      if (url.pathname === '/repos/B-icy/Carthagent/releases/88/assets') return Response.json(assets);
      assert.fail('asset body must not be requested for invalid metadata');
    } });
    await assert.rejects(fetch(`${base}/${runtimeAsset}`), message);
  }
});

test('rejects malformed asset id, URL, state, and size before requesting the asset body', async () => {
  for (const asset of [
    { id: 0, url: `${api}/releases/assets/0`, state: 'uploaded', size: 5 },
    { id: 777, url: 'https://attacker.example/asset', state: 'uploaded', size: 5 },
    { id: 777, url: `${api}/releases/assets/777`, state: 'starter', size: 5 },
    { id: 777, url: `${api}/releases/assets/777`, state: 'uploaded', size: -1 },
  ]) {
    const fetch = createRuntimeGithubFetch({ token, fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname === '/repos/B-icy/Carthagent/releases') return Response.json([{ id: 88, tag_name: 'v9.8.7' }]);
      if (url.pathname === '/repos/B-icy/Carthagent/releases/88/assets') return Response.json([{ ...asset, name: runtimeAsset }]);
      assert.fail('malformed asset metadata must block the binary request');
    } });
    await assert.rejects(fetch(`${base}/${runtimeAsset}`), /invalid metadata/);
  }
});

test('rejects API metadata redirects without following or forwarding authorization', async () => {
  const calls = [];
  const fetch = createRuntimeGithubFetch({ token, fetchImpl: async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(null, { status: 302, headers: { location: 'https://api.github.com/elsewhere' } });
  } });
  await assert.rejects(fetch(`${base}/${runtimeAsset}`), /unexpectedly redirected/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.authorization, `Bearer ${token}`);
});

test('only canonical fixed-repository runtime asset URLs enter authenticated transport', async () => {
  const calls = [];
  const fetch = createRuntimeGithubFetch({ token, fetchImpl: async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response('ordinary');
  } });
  await fetch('https://example.test/asset');
  await fetch(`${base}/untrusted.tar.gz`);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ init }) => init.headers?.authorization === undefined));
});
