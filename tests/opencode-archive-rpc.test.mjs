import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  const call = { signal: new AbortController().signal };
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
  await assert.rejects(methods.read({ id: join(outside, 'escape.jsonl') }, call), /ID was not found/);
  assert.equal(readFileSync(source, 'utf8'), bytes);
});

test('archive RPC validates host-configured roots and bounds pages and query inputs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ctg archive validation '));
  try {
    await assert.rejects(registerArchive({ rpc: { register() {} } }, { archiveRoots: ['relative-root'] }), /normalized absolute/);
    let methods;
    await registerArchive({ rpc: { async register(_contract, handlers) { methods = handlers; return { dispose() {} }; } } }, { archiveRoots: [root] });
    const call = { signal: new AbortController().signal };
    await assert.rejects(methods.list({ limit: 101 }, call), /page limit/);
    await assert.rejects(methods.search({ query: 'x'.repeat(201) }, call), /1 to 200/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
