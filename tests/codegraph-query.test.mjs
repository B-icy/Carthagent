import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodeIndex } from '../lib/codegraph.mjs';
import { queryCodeIndex } from '../lib/codegraph-query.mjs';
import { buildEngineArgs } from '../lib/engine.mjs';
import { needsImplementation } from '../lib/planning-access.mjs';

test('navigation is allowed before approval but unknown tools stay locked; scan flag forwards', () => {
  assert.equal(needsImplementation('code_nav'), false);
  assert.equal(needsImplementation('untrusted_graph'), true);
  const args = buildEngineArgs({ codegraphMaxFiles: '123' });
  assert.equal(args[args.indexOf('--codegraph-max-files') + 1], '123');
  for (const value of ['-1', '0', '1.2', 'x']) assert.throws(() => buildEngineArgs({ codegraphMaxFiles: value }), /positive/);
});
test('graph pages enumerate all candidates; filters disambiguate call-site scope', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'graph-pages-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'a.ts'), 'class A { run() { save(); save(); } }');
  writeFileSync(join(dir, 'b.ts'), 'class B { run() { save(); } }');
  const index = await createCodeIndex(dir);
  const first = queryCodeIndex(index, { op: 'callers', name: 'save', limit: 1 });
  assert.equal(first.total, 3); assert.equal(first.truncated, true); assert.equal(first.nextOffset, 1);
  assert.match(first.semantics, /not resolved/);
  const rest = queryCodeIndex(index, { op: 'callers', name: 'save', offset: 1, limit: 2 });
  assert.equal(rest.returned, 2); assert.equal(rest.nextOffset, null);
  const scoped = queryCodeIndex(index, { op: 'callers', name: 'save', path: 'b.ts', container: 'B' });
  assert.equal(scoped.total, 1); assert.equal(scoped.results[0].file, 'b.ts');
  assert.equal(queryCodeIndex(index, { op: 'definition', name: 'run', container: 'A' }).total, 1);
  assert.equal(queryCodeIndex(index, { op: 'definition', name: 'run', path: join(dir, 'a.ts') }).total, 1);
  assert.throws(() => queryCodeIndex(index, { op: 'symbols', name: 'run', path: dir }), /directory/);
  assert.match(queryCodeIndex(index, { op: 'symbols', name: 'absent' }).next, /find\/ls/);
});
test('coverage counts remain stable across refreshes and disclose capped indexing', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'graph-coverage-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const file of ['a', 'b', 'c']) writeFileSync(join(dir, file + '.ts'), `function ${file}() {}`);
  const index = await createCodeIndex(dir, { maxFiles: 1 });
  const before = index.stats(); await index.refresh(); await index.refresh();
  assert.equal(index.stats().skipped, 2); assert.equal(index.stats().discovered, 3);
  assert.equal(index.stats().complete, false); assert.equal(index.stats().parsed, before.parsed);
  assert.equal(queryCodeIndex(index, { op: 'symbols', name: 'a' }).coverage.complete, false);
});
