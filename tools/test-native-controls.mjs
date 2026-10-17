#!/usr/bin/env node
/** Real host, local provider only. Verifies admission, framing and compaction. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeFixture } from './native-fixture.mjs';

const host = await nativeFixture({ plugin: process.argv[2] });
try {
  let { client } = host;
  const { location, request, model, requests } = host;
  const a = await client.session.create({ location, title: 'Framed', model }, request());
  const b = await client.session.create({ location, title: 'Raw', model }, request());
  const rpc = (method, input, at = location) => host.client.rpc.call({ rpcID: 'carthagent.session', method, input, location: at }, request());
  await host.active();
  assert.deepEqual((await rpc('framing', { sessionID: a.id, enabled: true })).output, { enabled: true });
  await Promise.all([
    client.session.prompt({ sessionID: a.id, text: 'Implement a parser' }, request()),
    client.session.prompt({ sessionID: b.id, text: 'Implement a parser', metadata: { 'ctg.raw': true } }, request()),
  ]);
  await Promise.all([client.session.wait({ sessionID: a.id }, request()), client.session.wait({ sessionID: b.id }, request())]);
  const aMessages = await client.session.context({ sessionID: a.id }, request());
  const bMessages = await client.session.context({ sessionID: b.id }, request());
  assert.notEqual(aMessages.find(m => m.type === 'user')?.text, 'Implement a parser');
  assert.equal(bMessages.find(m => m.type === 'user')?.text, 'Implement a parser');
  assert.ok(aMessages.some(m => m.type === 'assistant'), JSON.stringify(aMessages));
  assert.ok(bMessages.some(m => m.type === 'assistant'), JSON.stringify(bMessages));
  assert.equal(aMessages.at(-1).outcome, 'succeeded');
  assert.equal(bMessages.at(-1).outcome, 'succeeded');
  await client.session.update({ sessionID: b.id, metadata: { 'carthagent.options': { guide: false } } }, request());
  await client.session.prompt({ sessionID: b.id, text: 'Implement a second parser' }, request());
  await client.session.wait({ sessionID: b.id }, request());
  const disabled = await client.session.context({ sessionID: b.id }, request());
  assert.equal(disabled.filter(m => m.type === 'user').at(-1).text, 'Implement a second parser');
  assert.deepEqual((await rpc('framing', { sessionID: b.id })).output, { enabled: true });
  await client.session.prompt({ sessionID: b.id, text: 'Implement a third parser' }, request());
  await client.session.wait({ sessionID: b.id }, request());
  const enabled = await client.session.context({ sessionID: b.id }, request());
  assert.notEqual(enabled.filter(m => m.type === 'user').at(-1).text, 'Implement a third parser');
  const marker = 'Preserve fixture decision 3e7b9';
  await rpc('compact', { sessionID: a.id, notes: marker });
  await client.session.wait({ sessionID: a.id }, request());
  const compacted = await client.session.context({ sessionID: a.id }, request());
  assert.ok(compacted.some(m => m.type === 'compaction'), JSON.stringify(compacted));
  assert.ok(requests.some(body =>
    JSON.stringify(body.messages).includes(marker)
    && JSON.stringify(body.messages.at(-1)).includes('structured summary')
  ), 'User notes reached the actual native summary request');

  // Exercise real RPC location ownership, rather than relying on stubbed context.
  const other = { directory: join(host.temp, 'other') };
  await mkdir(other.directory);
  await host.active(other);
  // The host intentionally redacts ordinary handler errors at the RPC boundary.
  await assert.rejects(rpc('framing', { sessionID: a.id, enabled: false }, other), { name: 'RpcInternalError' });
  await assert.rejects(rpc('compact', { sessionID: a.id, notes: 'Must not be admitted' }, other), { name: 'RpcInternalError' });
  assert.deepEqual(await client.session.context({ sessionID: a.id }, request()), compacted);

  // Persisted controls and launcher metadata must survive losing the whole service.
  await rpc('framing', { sessionID: a.id, enabled: false });
  await host.stop();
  client = await host.start();
  await host.active();
  await Promise.all([
    client.session.prompt({ sessionID: a.id, text: 'Implement after reconnect A' }, request()),
    client.session.prompt({ sessionID: b.id, text: 'Implement after reconnect B' }, request()),
  ]);
  await Promise.all([client.session.wait({ sessionID: a.id }, request()), client.session.wait({ sessionID: b.id }, request())]);
  const afterA = await client.session.context({ sessionID: a.id }, request());
  const afterB = await client.session.context({ sessionID: b.id }, request());
  assert.equal(afterA.filter(m => m.type === 'user').at(-1).text, 'Implement after reconnect A');
  assert.notEqual(afterB.filter(m => m.type === 'user').at(-1).text, 'Implement after reconnect B');
  assert.equal((await client.session.get({ sessionID: b.id }, request())).metadata['carthagent.options'].guide, false);
  assert.equal(afterA.at(-1).outcome, 'succeeded');
  assert.equal(afterB.at(-1).outcome, 'succeeded');
  assert.deepEqual(host.providerErrors, []);
  console.log(JSON.stringify({ host: '2.0.32', sessions: 2, providerRequests: requests.length,
    framing: 'passed', raw: 'passed', compaction: 'passed', locationOwnership: 'passed', serviceRestart: 'passed' }));
} catch (error) {
  console.error(host.output);
  throw error;
} finally {
  await host.close();
}
