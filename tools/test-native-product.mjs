#!/usr/bin/env node
/** Integration entrypoint probe: all handlers must load from the shipped plugin. */
import assert from 'node:assert/strict';
import { nativeFixture } from './native-fixture.mjs';

const host = await nativeFixture({ plugin: process.argv[2] });
const stream = new AbortController();
let watching;
try {
  const { client, location, model, request } = host;
  await host.active();
  const rpc = async (rpcID, method, input) => (await client.rpc.call({ rpcID, method, input, location }, request())).output;
  const session = await client.session.create({ location, model, title: 'Product entrypoint probe' }, request());
  const health = await rpc('carthagent', 'health', {});
  assert.equal(health.directory, host.cwd);
  assert.equal(health.hostVersion, '2.0.32');
  const snapshot = await rpc('carthagent.workspace', 'snapshot', {});
  assert.equal(snapshot.projects.length, 1);
  assert.equal(snapshot.projects[0].id, session.projectID);
  assert.equal(snapshot.projects[0].directory, host.cwd);
  assert.deepEqual(snapshot.tasks, []);
  const opened = await rpc('carthagent.workspace', 'open', { sessionID: session.id });
  assert.deepEqual(opened, { opened: true, directory: host.cwd });
  assert.deepEqual(await rpc('carthagent.workspace', 'delivery', { sessionID: session.id }), { status: 'unavailable' });
  const archives = await rpc('carthagent.archive', 'list', {});
  assert.deepEqual(archives.items, []);
  assert.equal(archives.total, 0);
  assert.deepEqual(await rpc('carthagent.session', 'framing', { sessionID: session.id, enabled: false }), { enabled: false });
  let connected;
  const ready = new Promise(resolve => { connected = resolve; });
  let changed;
  const updated = new Promise(resolve => { changed = resolve; });
  watching = (async () => {
    try {
      for await (const event of client.event.subscribe({ signal: stream.signal })) {
        if (event.type === 'server.connected') connected();
        if (event.type === 'rpc.carthagent.workspace.updated' && event.location?.directory === host.cwd) changed(event);
      }
    } catch (error) { if (!stream.signal.aborted) throw error; }
  })();
  let timer;
  const timed = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Workspace event stream did not reconcile')), 10_000); });
  try {
    await Promise.race([ready, timed]);
    await client.session.prompt({ sessionID: session.id, text: 'Fixture event refresh' }, request());
    await client.session.wait({ sessionID: session.id }, request());
    const event = await Promise.race([updated, timed]);
    assert.equal(typeof event.data.revision, 'string');
  } finally { clearTimeout(timer); }
  console.log(JSON.stringify({ host: '2.0.32', entrypoint: 'passed', workspace: 'passed', archive: 'passed', controls: 'passed', eventInvalidation: 'passed' }));
} catch (error) {
  console.error(host.output);
  throw error;
} finally {
  stream.abort();
  try { await watching; }
  finally { await host.close(); }
}
