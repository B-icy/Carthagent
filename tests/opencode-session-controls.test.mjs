import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { registerSessionControls } = await jiti.import('../plugins/carthagent/src/server/session-controls.ts');

function fixture(options = {}, sessions = {}) {
  const values = new Map();
  const hooks = {};
  const calls = [];
  let handlers;
  const ctx = {
    options, location: { directory: '/project' },
    storage: { get: async key => values.get(key), set: async (key, value) => values.set(key, value) },
    session: {
      get: async ({ sessionID }) => ({ location: { directory: sessionID === 'foreign' ? '/other' : '/project' }, ...sessions[sessionID] }),
      hook: async (name, hook) => { hooks[name] = hook; return { dispose: async () => { delete hooks[name]; } }; },
      synthetic: async input => { calls.push(['synthetic', input]); },
      compact: async input => { calls.push(['compact', input]); },
    },
    rpc: { register: async (_definition, implementation) => { handlers = implementation; return { dispose: async () => { handlers = undefined; } }; } },
  };
  return { ctx, hooks, calls, values, get handlers() { return handlers; } };
}
const call = () => ({
  signal: new AbortController().signal,
  error(type, message, data) { throw Object.assign(new Error(message), { type, data }); },
});

test('native framing is session-scoped, raw-safe and preserves attachments', async () => {
  const f = fixture();
  const cleanup = await registerSessionControls(f.ctx);
  const event = { sessionID: 'a', prompt: { text: 'Implement a parser', files: [{ uri: 'file:///project/input', mention: { start: 0, end: 2, text: 'im' } }] } };
  await f.hooks.prompt(event);
  assert.notEqual(event.prompt.text, 'Implement a parser');
  assert.equal(event.metadata['ctg.original'], 'Implement a parser');
  assert.equal(event.prompt.files[0].uri, 'file:///project/input');
  assert.equal(event.prompt.files[0].mention, undefined);
  const once = event.prompt.text;
  await f.hooks.prompt(event);
  assert.equal(event.prompt.text, once);
  const raw = { sessionID: 'a', prompt: { text: 'Implement a parser' }, metadata: { 'ctg.raw': true } };
  await f.hooks.prompt(raw);
  assert.equal(raw.prompt.text, 'Implement a parser');
  await f.handlers.framing({ sessionID: 'a', enabled: false }, call());
  const a = { sessionID: 'a', prompt: { text: 'Implement a parser' } };
  const b = { sessionID: 'b', prompt: { text: 'Implement a parser' } };
  await f.hooks.prompt(a);
  await f.hooks.prompt(b);
  assert.equal(a.prompt.text, 'Implement a parser');
  assert.notEqual(b.prompt.text, a.prompt.text);
  await assert.rejects(f.handlers.framing({ sessionID: 'foreign' }, call()), { type: 'wrong_workspace', data: { sessionID: 'foreign' } });
  await cleanup();
  assert.equal(f.hooks.prompt, undefined);
});

test('concurrent framing toggles serialize and override a disabled launch default', async () => {
  const f = fixture({ guide: false });
  await registerSessionControls(f.ctx);
  const results = await Promise.all([f.handlers.framing({ sessionID: 'a' }, call()), f.handlers.framing({ sessionID: 'a' }, call())]);
  assert.deepEqual(results, [{ enabled: true }, { enabled: false }]);
  await f.handlers.framing({ sessionID: 'a', enabled: true }, call());
  const event = { sessionID: 'a', prompt: { text: 'Implement a parser' } };
  await f.hooks.prompt(event);
  assert.notEqual(event.prompt.text, 'Implement a parser');
});

test('compaction notes precede queued compaction and cancellation prevents admission', async () => {
  const f = fixture();
  await registerSessionControls(f.ctx);
  assert.deepEqual(await f.handlers.compact({ sessionID: 'a', notes: 'Preserve unresolved decisions' }, call()), { admitted: true });
  assert.deepEqual(f.calls.map(item => item[0]), ['synthetic', 'compact']);
  assert.match(f.calls[0][1].text, /Preserve unresolved decisions/);
  assert.ok(f.calls.every(item => item[1].sessionID === 'a' && item[1].delivery === 'queue'));
  await assert.rejects(f.handlers.compact({ sessionID: 'a' }, { signal: AbortSignal.abort() }));
  assert.equal(f.calls.length, 2);
});

test('persisted per-session launcher settings control framing without affecting neighbors', async () => {
  const f = fixture({}, {
    a: { metadata: { 'carthagent.options': { guide: false } } },
    b: { metadata: { 'carthagent.options': { delivery: false } } },
  });
  await registerSessionControls(f.ctx);
  for (const sessionID of ['a', 'b']) {
    const event = { sessionID, prompt: { text: 'Implement a parser' } };
    await f.hooks.prompt(event);
    assert.equal(event.prompt.text, 'Implement a parser');
  }
  assert.deepEqual(await f.handlers.framing({ sessionID: 'a' }, call()), { enabled: true });
  const event = { sessionID: 'a', prompt: { text: 'Implement a parser' } };
  await f.hooks.prompt(event);
  assert.notEqual(event.prompt.text, 'Implement a parser');
});

test('explicit framing RPC override wins over persisted launch guide setting for only that session', async () => {
  const f = fixture({}, {
    a: { metadata: { 'carthagent.options': { guide: true } } },
    b: { metadata: { 'carthagent.options': { guide: true } } },
  });
  await registerSessionControls(f.ctx);
  await f.handlers.framing({ sessionID: 'a', enabled: false }, call());
  const a = { sessionID: 'a', prompt: { text: 'Implement a parser' } };
  const b = { sessionID: 'b', prompt: { text: 'Implement a parser' } };
  await f.hooks.prompt(a);
  await f.hooks.prompt(b);
  assert.equal(a.prompt.text, 'Implement a parser');
  assert.notEqual(b.prompt.text, 'Implement a parser');
});

test('queued controls recheck ownership after a session moves', async () => {
  const f = fixture();
  let releaseWrite;
  let beganWrite;
  const writing = new Promise(resolve => { beganWrite = resolve; });
  const gate = new Promise(resolve => { releaseWrite = resolve; });
  let directory = '/project';
  f.ctx.session.get = async () => ({ location: { directory } });
  f.ctx.storage.set = async () => { beganWrite(); await gate; };
  await registerSessionControls(f.ctx);
  const first = f.handlers.framing({ sessionID: 'a', enabled: true }, call());
  await writing;
  const queued = f.handlers.compact({ sessionID: 'a', notes: 'Must not be admitted after move' }, call());
  directory = '/other';
  releaseWrite();
  await first;
  await assert.rejects(queued, { type: 'wrong_workspace', data: { sessionID: 'a' } });
  assert.deepEqual(f.calls, []);
});
