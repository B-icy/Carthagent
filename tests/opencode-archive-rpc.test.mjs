import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
const jiti = createJiti(import.meta.url);
const { registerArchive } = await jiti.import('../plugins/carthagent/src/server/archive-rpc.ts');

test('archive RPC uses opaque IDs, confines roots, skips symlinks, and never changes legacy bytes', async t => {
  const root = mkdtempSync(join(tmpdir(), 'ctg archive rpc ')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const trusted = join(root, 'trusted'); const outside = join(root, 'outside'); mkdirSync(trusted); mkdirSync(outside);
  const source = join(trusted, 'legacy.jsonl'); const bytes = '{"type":"session","id":"pi-original"}\n{"type":"message","message":{"role":"user","content":"needle"}}\nnot-json\n';
  writeFileSync(source, bytes); writeFileSync(join(outside, 'escape.jsonl'), '{"type":"session","id":"outside"}\n');
  symlinkSync(join(outside, 'escape.jsonl'), join(trusted, 'linked.jsonl'));
  let methods;
  const dispose = await registerArchive({ rpc: { async register(contract, handlers) { assert.equal(contract.id, 'carthagent.archive'); methods = handlers; return { dispose() {} }; } } }, { archiveRoots: [trusted] });
  t.after(dispose);
  const call = { signal: new AbortController().signal, error(_type, message, data) { return Object.assign(new Error(message), data); } };
  const listing = await methods.list({}, call);
  assert.equal(listing.total, 1);
  assert.doesNotMatch(JSON.stringify(listing), /legacy\.jsonl|trusted/);
  const id = listing.items[0].id;
  assert.match(id, /^[a-f0-9]{64}$/);
  const found = await methods.search({ query: 'needle' }, call);
  assert.equal(found.items[0].id, id);
  assert.match(found.items[0].excerpt, /needle/);
  const transcript = await methods.read({ id }, call);
  assert.equal(transcript.archiveOnly, true);
  assert.equal(transcript.records.length, 2);
  assert.deepEqual(transcript.malformedLines, [{ line: 3 }]);
  assert.equal((await methods.export({ id, format: 'jsonl' }, call)).content, bytes);
  assert.equal((await methods.read({ id: join(outside, 'escape.jsonl') }, call)).code, 'not_found');
  assert.equal(readFileSync(source, 'utf8'), bytes);
});

test('archive RPC validates host-configured roots and bounds pages and query inputs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ctg archive validation '));
  try {
    await assert.rejects(registerArchive({ rpc: { register() {} } }, { archiveRoots: ['relative-root'] }), /normalized absolute/);
    let methods;
    await registerArchive({ rpc: { async register(_contract, handlers) { methods = handlers; return { dispose() {} }; } } }, { archiveRoots: [root] });
    const call = { signal: new AbortController().signal, error(_type, message, data) { return Object.assign(new Error(message), data); } };
    assert.equal((await methods.list({ limit: 101 }, call)).code, 'invalid_request');
    assert.equal((await methods.search({ query: 'x'.repeat(201) }, call)).code, 'invalid_request');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('archive root validation uses platform-native absolute paths', async t => {
  if (process.platform !== 'win32') { t.skip('drive-root validation is exercised on Windows CI'); return; }
  const root = mkdtempSync(join(tmpdir(), 'ctg archive windows ')); t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(isAbsolute(root), true);
  let methods;
  await registerArchive({ rpc: { async register(_contract, handlers) { methods = handlers; return { dispose() {} }; } } }, { archiveRoots: [root] });
  assert.equal((await methods.list({}, { signal: new AbortController().signal })).total, 0);
});

test('archive refuses oversized transcripts before parsing and honors cancellation', async t => {
  const root = mkdtempSync(join(tmpdir(), 'ctg archive oversize ')); t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'large.jsonl'), Buffer.alloc(4_000_001));
  let methods;
  await registerArchive({ rpc: { async register(_contract, handlers) { methods = handlers; return { dispose() {} }; } } }, { archiveRoots: [root] });
  const call = { signal: new AbortController().signal, error(_type, message, data) { return Object.assign(new Error(message), data); } };
  assert.equal((await methods.list({}, call)).code, 'limit_exceeded');
  const canceled = { signal: AbortSignal.abort() };
  await assert.rejects(methods.list({}, canceled), /abort/i);
});
