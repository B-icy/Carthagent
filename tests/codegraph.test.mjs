import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodeIndex } from '../lib/codegraph.mjs';

const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'codegraph-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'a.ts'), [
    `import { helper } from './b';`,
    `import './side';`,
    `export function main() { helper(); thing.h(); }`,
    `export class K { m() { helper(); } }`,
    `export const arrow = () => helper();`,
  ].join('\n'));
  writeFileSync(join(dir, 'src', 'b.ts'), `export function helper() {}\n`);
  writeFileSync(join(dir, 'src', 'side.ts'), `export const sideEffect = 1;\n`);
  writeFileSync(join(dir, 'src', 'c.py'), [
    `import os`,
    `def f():`,
    `    helper()`,
    `class K:`,
    `    def m(self):`,
    `        main()`,
  ].join('\n'));
  writeFileSync(join(dir, 'src', 'd.rs'), [
    `fn f() { g(); obj.h(); }`,
    `struct S {}`,
    `impl S { fn m(&self) { main(); } }`,
  ].join('\n'));
  return dir;
};

test('codegraph indexes definitions across languages', async t => {
  const dir = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ix = await createCodeIndex(dir);
  const stats = ix.stats();
  assert.equal(stats.files, 5);
  assert.equal(stats.parseErrors, 0);

  const helper = ix.definition('helper');
  assert.equal(helper.length, 1);
  assert.equal(helper[0].file, 'src/b.ts');
  assert.equal(helper[0].kind, 'function');

  // Qualified lookup finds methods under their container in every language.
  const methods = ix.definition('K.m');
  assert.equal(methods.length, 2);
  assert.deepEqual(new Set(methods.map(d => d.container)), new Set(['K']));
});

test('codegraph traces callers and callees', async t => {
  const dir = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ix = await createCodeIndex(dir);

  const callers = ix.callers('helper').map(c => c.caller?.name).sort();
  assert.deepEqual(callers, ['arrow', 'f', 'm', 'main'].sort());
  // Member calls record the method name.
  assert.ok(ix.callers('h').length >= 2);

  const callees = ix.callees('main').map(c => c.name).sort();
  assert.deepEqual(callees, ['h', 'helper']);
});

test('codegraph resolves import edges both directions', async t => {
  const dir = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ix = await createCodeIndex(dir);

  assert.deepEqual(ix.imports('src/a.ts').sort(), ['./b', './side']);
  const importers = ix.importers('src/b.ts');
  assert.equal(importers.length, 1);
  assert.equal(importers[0].file, 'src/a.ts');
  assert.deepEqual(ix.importers('src/side.ts'), [{ file: 'src/a.ts', spec: './side' }]);
});

test('codegraph outlines a file and finds symbols by substring', async t => {
  const dir = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ix = await createCodeIndex(dir);

  assert.deepEqual(ix.outline('src/b.ts').map(d => d.name), ['helper']);
  const outline = ix.outline('src/a.ts').map(d => d.name);
  assert.deepEqual(outline, ['main', 'K', 'm', 'arrow']);

  const matches = ix.symbols('arr');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].displayName, 'arrow');
});

test('codegraph refreshes incrementally on mtime change', async t => {
  const dir = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ix = await createCodeIndex(dir);
  assert.equal(ix.definition('added').length, 0);

  writeFileSync(join(dir, 'src', 'b.ts'), `export function helper() {}\nexport function added() { helper(); }\n`);
  const future = new Date(Date.now() + 2000);
  utimesSync(join(dir, 'src', 'b.ts'), future, future);
  await ix.refresh();

  assert.equal(ix.definition('added').length, 1);
  assert.ok(ix.callers('helper').some(c => c.caller?.name === 'added'));

  rmSync(join(dir, 'src', 'c.py'));
  await ix.refresh();
  assert.equal(ix.stats().files, 4);
  assert.equal(ix.outline('src/c.py').length, 0);
});

test('codegraph callees distinguishes same-named methods in one file', async t => {
  const dir = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'src', 'two.ts'), [
    `class A { run() { alpha(); } }`,
    `class B { run() { beta(); } }`,
  ].join('\n'));
  const ix = await createCodeIndex(dir);

  assert.deepEqual(ix.callees('A.run').map(c => c.name), ['alpha']);
  assert.deepEqual(ix.callees('B.run').map(c => c.name), ['beta']);
});

test('codegraph drops stale entries when a file grows past maxBytes', async t => {
  const dir = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ix = await createCodeIndex(dir, { maxBytes: 80 });

  writeFileSync(join(dir, 'src', 'small.ts'), `export function tiny() { helper(); }\n`);
  await ix.refresh();
  assert.equal(ix.definition('tiny').length, 1);

  writeFileSync(join(dir, 'src', 'small.ts'), `export function tiny() { helper(); } ${'// pad'.repeat(30)}\n`);
  const future = new Date(Date.now() + 2000);
  utimesSync(join(dir, 'src', 'small.ts'), future, future);
  await ix.refresh();
  assert.equal(ix.definition('tiny').length, 0);
});
