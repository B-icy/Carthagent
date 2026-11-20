import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyzeCpuProfile, analyzeHeapProfile, foldStacks, formatCpuSummary, parseProfileArgs } from '../tools/profile.mjs';

const root = resolve('/proj');
const url = relative => pathToFileURL(resolve(root, relative)).href;
const frame = (functionName, file, lineNumber = 0) => ({ functionName, scriptId: '1', url: file, lineNumber, columnNumber: 0 });
const depUrl = url('node_modules/dep/index.js');

const profile = {
  startTime: 0,
  endTime: 6000,
  nodes: [
    { id: 1, callFrame: frame('(root)', ''), children: [2] },
    { id: 2, callFrame: frame('main', url('bin/x.mjs')), children: [3, 4] },
    { id: 3, callFrame: frame('helper', url('lib/a.mjs'), 9), children: [5] },
    { id: 4, callFrame: frame('dep', depUrl), children: [] },
    { id: 5, callFrame: frame('helper', url('lib/a.mjs'), 9), children: [] },
  ],
  samples: [3, 3, 4, 5, 2, 1],
  timeDeltas: [0, 1000, 1000, 1000, 1000, 1000],
};

test('self and total time aggregate per function without double-counting recursion', () => {
  const analysis = analyzeCpuProfile(profile, { root });
  assert.equal(analysis.totalMs, 6);
  assert.equal(analysis.samples, 6);
  const byName = Object.fromEntries(analysis.functions.map(row => [row.name, row]));
  assert.deepEqual(Object.keys(byName).sort(), ['dep', 'helper', 'main']);
  assert.equal(byName.helper.selfMs, 3);
  assert.equal(byName.helper.totalMs, 3);
  assert.equal(byName.helper.location, 'lib/a.mjs:10');
  assert.equal(byName.helper.firstParty, true);
  assert.equal(byName.main.selfMs, 1);
  assert.equal(byName.main.totalMs, 5);
  assert.equal(byName.dep.selfMs, 1);
  assert.equal(byName.dep.firstParty, false);
});

test('hit counts are used when a profile has no samples', () => {
  const legacy = {
    startTime: 0,
    endTime: 4000,
    nodes: [
      { id: 1, callFrame: frame('(root)', ''), hitCount: 0, children: [2] },
      { id: 2, callFrame: frame('work', url('lib/w.mjs')), hitCount: 4, children: [] },
    ],
  };
  const [work] = analyzeCpuProfile(legacy, { root }).functions;
  assert.equal(work.selfMs, 4);
  assert.equal(work.totalMs, 4);
});

test('folded stacks list each distinct root-to-leaf stack with its sample count', () => {
  const lines = foldStacks(profile, { root }).split('\n');
  const dep = resolve(root, 'node_modules/dep/index.js');
  assert.deepEqual(lines, [
    'main (bin/x.mjs:1) 1',
    `main (bin/x.mjs:1);dep (${dep}:1) 1`,
    'main (bin/x.mjs:1);helper (lib/a.mjs:10) 2',
    'main (bin/x.mjs:1);helper (lib/a.mjs:10);helper (lib/a.mjs:10) 1',
  ]);
  const semicolon = { ...profile, nodes: profile.nodes.map(node => (node.id === 2 ? { ...node, callFrame: frame('a;b', url('bin/x.mjs')) } : node)) };
  assert.ok(
    foldStacks(semicolon, { root })
      .split('\n')
      .every(line => line.split(';')[0].startsWith('a:b')),
  );
});

test('the summary marks first-party rows and ranks by self and total time', () => {
  const text = formatCpuSummary(analyzeCpuProfile(profile, { root }), { top: 2 });
  const lines = text.split('\n');
  assert.match(lines[0], /CPU profile: 6\.0 ms, 6 samples/);
  const self = lines.indexOf('Top 2 by self time');
  assert.match(lines[self + 1], /^\* +3\.0ms +50\.0% {2}helper {2}lib\/a\.mjs:10$/);
  assert.equal(lines.slice(self + 1, lines.indexOf('', self)).length, 2);
  const total = lines.indexOf('Top 2 by total time');
  assert.match(lines[total + 1], /^\* +5\.0ms +83\.3% {2}main {2}bin\/x\.mjs:1$/);
  assert.match(text, /Top 2 first-party functions by total time\n\* +5\.0ms/);
  assert.doesNotMatch(text, /\(root\)/);
});

test('heap profiles aggregate sampled bytes per allocating function', () => {
  const heap = {
    head: {
      callFrame: frame('(root)', ''),
      selfSize: 0,
      children: [
        {
          callFrame: frame('alloc', url('lib/a.mjs'), 4),
          selfSize: 2048,
          children: [{ callFrame: frame('alloc', url('lib/a.mjs'), 4), selfSize: 1024, children: [] }],
        },
        { callFrame: frame('other', depUrl), selfSize: 0, children: [] },
      ],
    },
  };
  const analysis = analyzeHeapProfile(heap, { root });
  assert.equal(analysis.totalBytes, 3072);
  assert.deepEqual(
    analysis.functions.map(row => [row.name, row.location, row.selfBytes, row.firstParty]),
    [['alloc', 'lib/a.mjs:5', 3072, true]],
  );
});

test('arguments select the command, server or test mode, and reject mistakes', () => {
  assert.deepEqual(parseProfileArgs([]).command, ['node', 'bin/ctg.mjs', '--help']);
  const custom = parseProfileArgs(['--heap', '--top', '5', '--out', 'x', '--', 'node', 'bin/ctg.mjs', 'status', '--json']);
  assert.equal(custom.heap, true);
  assert.equal(custom.top, 5);
  assert.equal(custom.out, 'x');
  assert.deepEqual(custom.command, ['node', 'bin/ctg.mjs', 'status', '--json']);
  assert.equal(parseProfileArgs(['--server']).mode, 'server');
  assert.deepEqual(
    [parseProfileArgs(['--test', 'tests/a.test.mjs']).mode, parseProfileArgs(['--test', 'tests/a.test.mjs']).testFile],
    ['test', 'tests/a.test.mjs'],
  );
  assert.throws(() => parseProfileArgs(['--top', '0']), /positive integer/);
  assert.throws(() => parseProfileArgs(['--test']), /Missing value/);
  assert.throws(() => parseProfileArgs(['--']), /Expected a command/);
  assert.throws(() => parseProfileArgs(['--nope']), /Unknown option/);
});
