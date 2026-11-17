#!/usr/bin/env node
// Adapter/unit smoke using a deterministic injected API; the real host acceptance
// lives in test-native-swe-host.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { runNativeEvaluation } from '../lib/opencode/evaluation.mjs';

const toolPart = (id, name, status, content = [], metadata = {}) => ({
  type: 'tool', id, name, state: { status, content, metadata },
});
const resultText = status => [{ type: 'text', text: JSON.stringify({ status }) }];
async function accountTools(parts, events = []) {
  const api = {
    server: { info: async () => ({ version: '2.0.32' }) },
    plugin: { list: async () => ({ data: [{ id: 'ctg.evaluation-budget', state: { status: 'active' } }] }) },
    session: {
      create: async () => ({ id: 'accounting' }), prompt: async () => {}, wait: async () => {},
      get: async () => ({ outcome: 'succeeded', cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }),
    },
    event: { subscribe: async function* () { yield* events; } },
    message: { list: async () => {
      if (parts === null) throw Error('fixture transcript unavailable');
      return { data: [{ type: 'assistant', finish: 'stop', content: parts }], cursor: {} };
    } },
  };
  return runNativeEvaluation({ client: api, directory: tmpdir(), prompt: 'fixture', model: 'fake', provider: 'local' });
}

test('native accounting counts observed nested calls and errors, not code or search matches', async () => {
  // Pilot shape: nested entries have tool/status/input, but no ID or result.
  const part = toolPart('e1', 'execute', 'completed', resultText('verified'), { toolCalls: [
    { tool: 'carthagent.delivery_plan', status: 'error', input: {} },
    { tool: 'carthagent.delivery_plan', status: 'completed', input: {} },
    { tool: 'search', status: 'completed', input: { query: 'delivery_finish' } },
  ] });
  part.state.input = { code: 'tools.carthagent.delivery_finish()' };
  const result = await accountTools([part, part]);
  assert.deepEqual(result.tools, { execute: 1, delivery_plan: 2, search: 1 });
  assert.deepEqual(result.toolErrors, { delivery_plan: 1 });
  assert.equal(result.deliveryStatus, null);
});

test('event-only accounting ignores opaque provider state and preserves terminal observations', async () => {
  const called = (id, tool) => ({ type: 'session.tool.called', data: {
    sessionID: 'accounting', id, tool, state: { opaque: 'provider-state' },
  } });
  const terminal = (id, type, extra = {}) => ({ type: `session.tool.${type}`, data: { sessionID: 'accounting', id, ...extra } });
  const events = [
    called('e1', 'execute'),
    terminal('e1', 'success', { metadata: { toolCalls: [{ tool: 'carthagent.delivery_plan', status: 'error' }] } }),
    called('f1', 'carthagent_delivery_finish'),
    terminal('f1', 'success', { content: resultText('verified') }),
  ];
  const completed = await accountTools(null, events);
  assert.equal(completed.exitCode, 1);
  assert.ok(completed.errors.includes('fixture transcript unavailable'));
  assert.deepEqual(completed.tools, { execute: 1, delivery_plan: 1, delivery_finish: 1 });
  assert.deepEqual(completed.toolErrors, { delivery_plan: 1 });
  assert.equal(completed.deliveryStatus, 'verified');

  const failed = await accountTools(null, [...events,
    called('f2', 'carthagent.delivery_finish'), terminal('f2', 'failed'),
  ]);
  assert.deepEqual(failed.toolErrors, { delivery_plan: 1, delivery_finish: 1 });
  assert.equal(failed.deliveryStatus, null);
});

test('evaluation report serializes native tool errors alongside tool counts', async () => {
  const result = await accountTools([toolPart('e1', 'execute', 'completed', [], { toolCalls: [
    { tool: 'carthagent.delivery_plan', status: 'error' },
  ] })]);
  // Execute the actual CLI summary projection without launching a live provider
  // or service. This exercises its serialized consumer contract, not a regex.
  const source = readFileSync(new URL('../evaluate.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('  const summary = {');
  const end = source.indexOf('  summary.developmentChecks =', start);
  assert.ok(start >= 0 && end > start);
  const serialized = runInNewContext(`${source.slice(start, end)}\nJSON.stringify(summary)`, {
    result, mode: 'custom', scenarioName: 'fixture', args: { provider: 'local', model: 'fake' },
    cwd: '/fixture', NATIVE_EVALUATION_RUNTIME: 'opencode-2',
  });
  const report = JSON.parse(serialized);
  assert.deepEqual(report.tools, { execute: 1, delivery_plan: 1 });
  assert.deepEqual(report.toolErrors, { delivery_plan: 1 });
  assert.equal(report.deliveryStatus, null);
});

test('native accounting normalizes finish names and deduplicates IDs across metadata and events', async () => {
  const finish = toolPart('f1', 'carthagent_delivery_finish', 'completed', resultText('verified'));
  const result = await accountTools([
    toolPart('e1', 'execute', 'completed', [], { toolCalls: [
      { id: 'f1', tool: 'carthagent.delivery_finish', status: 'completed', content: resultText('verified') },
    ] }), finish,
  ], [
    { type: 'session.tool.called', data: { sessionID: 'accounting', id: 'f1', tool: 'carthagent_delivery_finish' } },
    { type: 'session.tool.called', data: { sessionID: 'accounting', id: 'f1', tool: 'carthagent_delivery_finish' } },
  ]);
  assert.deepEqual(result.tools, { execute: 1, delivery_finish: 1 });
  assert.equal(result.deliveryStatus, 'verified');
});

test('native accounting never retains verified after a failed, pending or unreadable finish', async () => {
  for (const status of ['error', 'running', 'completed']) {
    const result = await accountTools([
      toolPart('f1', 'delivery_finish', 'completed', resultText('verified')),
      toolPart('e1', 'execute', 'completed', resultText('verified'), { toolCalls: [
        { tool: 'carthagent.delivery_finish', status, input: { status: 'verified' } },
      ] }),
    ]);
    assert.equal(result.deliveryStatus, null, status);
    assert.equal(result.tools.delivery_finish, 2);
    assert.deepEqual(result.toolErrors, status === 'error' ? { delivery_finish: 1 } : {});
  }
  const blocked = await accountTools([toolPart('f1', 'carthagent.delivery_finish', 'completed', resultText('blocked'))]);
  assert.equal(blocked.deliveryStatus, 'blocked');
});

test('native evaluation adapter consumes native event shapes and reconciles session usage', async () => {
  const events = [];
  const api = {
    server: { info: async () => ({ version: '2.0.32' }) },
    plugin: { list: async () => ({ data:[{id:'ctg.evaluation-budget',state:{status:'active'}}] }) },
    session: {
      create: async () => ({ id: 's1' }),
      synthetic: async () => ({}),
      prompt: async () => {
        // Deterministic fake model plan using normal workspace operations. It
        // first observes a failing test, applies an edit, then reruns it green.
        const source = join(root, 'src/value.mjs'), testFile = join(root, 'src/value.test.mjs');
        const first = spawnSync(process.execPath, ['-e', "import('./src/value.mjs').then(({value})=>process.exit(value===42?0:1))"], { cwd: root });
        if (first.status === 0) throw Error('fixture unexpectedly started green');
        writeFileSync(source, 'export const value = 42;\n');
        const checked = spawnSync(process.execPath, ['--test', testFile], { cwd: root });
        assert.equal(checked.status, 0, checked.stderr.toString());
        events.push(
          { type: 'session.tool.called', data: { sessionID:'s1', id:'t1', tool:'edit', input:{path:'src/value.mjs'} } },
          { type: 'session.tool.called', data: { sessionID:'s1', id:'t2', tool:'shell', input:{command:'node --test src/value.test.mjs'} } },
          { type: 'session.step.ended', data: { sessionID: 's1', assistantMessageID:'m1', finish:'stop', cost:0, tokens:{total:12} } },
          { type: 'session.idle', data: { sessionID:'s1' } },
        );
        return {};
      },
      stats: async () => ({ models: [{ cost: 0, tokens: { total: 12 } }] }),
      wait: async () => ({}),
      context: async () => [
        {type:'assistant',finish:'stop',cost:0,tokens:{total:12},content:[
          {type:'tool',name:'edit',id:'t1',state:{status:'completed',input:{path:'src/value.mjs'},content:[]}},
          {type:'tool',name:'shell',id:'t2',state:{status:'completed',input:{command:'node --test src/value.test.mjs'},content:[]}},
        ]},
      ],
      get: async () => ({outcome:'succeeded',cost:0,tokens:{input:8,output:4,reasoning:0,cache:{read:0,write:0}}}),
      interrupt: async () => ({}),
    },
    message: { list: async () => ({ data:[{id:'m1',type:'assistant',finish:'stop',cost:0,tokens:{total:12},content:[
      {type:'tool',name:'edit',id:'t1',state:{status:'completed',input:{path:'src/value.mjs'},content:[]}},
      {type:'tool',name:'shell',id:'t2',state:{status:'completed',input:{command:'node --test src/value.test.mjs'},content:[]}},
    ]}],cursor:{}}) },
    event: { subscribe: async function* ({signal}) { await new Promise((resolve,reject) => { if (signal.aborted) return resolve(); signal.addEventListener('abort',resolve,{once:true}); setTimeout(resolve,40); }); for (const event of events) yield event; } },
  };
  const root = mkdtempSync(join(tmpdir(), 'ctg-native-swe-'));
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/value.mjs'), 'export const value = 0;\n');
    writeFileSync(join(root, 'src/value.test.mjs'), "import test from 'node:test'; import assert from 'node:assert/strict'; import { value } from './value.mjs'; test('value fixed',()=>assert.equal(value,42));\n");
    const output = await runNativeEvaluation({ client: api, directory: root, prompt: 'fixture', model: 'fake', provider: 'local', timeoutSeconds: 2, maxTurns: 5, maxCost: 1 });
    assert.equal(output.runtime, 'opencode-2');
    assert.equal(output.turns, 1, JSON.stringify(output));
    assert.equal(output.productiveTurns, 1);
    assert.equal(output.tools.edit, 1);
    assert.equal(output.tools.shell, 1);
    assert.equal(output.cost, 0);
    assert.equal(readFileSync(join(root, 'src/value.mjs'), 'utf8'), 'export const value = 42;\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('native evaluation bounds a nonresponsive interrupt cleanup and reports interruption unknown', async () => {
  const controller = new AbortController();
  const api = {
    server: { info: async () => ({ version: '2.0.32' }) },
    plugin: { list: async () => ({ data:[{id:'ctg.evaluation-budget',state:{status:'active'}}] }) },
    session: {
      create: async () => ({ id: 'hung-session' }),
      prompt: (_input, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once:true })),
      interrupt: () => new Promise(() => {}),
      get: async () => ({ cost: 0, tokens: { input:0, output:0, reasoning:0, cache:{read:0,write:0} } }),
    },
    event: { subscribe: async function* ({ signal }) {
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once:true }));
    } },
  };
  const abortTimer = setTimeout(() => controller.abort(Error('test cancellation')), 50);
  const started = Date.now();
  try {
    const result = await runNativeEvaluation({ client:api, directory:tmpdir(), prompt:'hang', model:'fixture', provider:'local', signal:controller.signal, timeoutSeconds:5, maxTurns:2, maxCost:1 });
    assert.equal(result.exitCode,1);
    assert.equal(result.outcome,null);
    assert.equal(result.interruptionStatus,'unknown');
    assert.equal(result.budgetReason,'cancelled');
    assert.ok(Date.now()-started < 3000, 'a never-resolving interrupt must not hold evaluation cleanup');
  } finally { clearTimeout(abortTimer); }
});

test('native evaluation interrupts its own session after a non-abort API failure without terminal outcome', async () => {
  const interrupts = [];
  let terminal = false;
  const api = {
    server: { info: async () => ({ version:'2.0.32' }) },
    plugin: { list: async () => ({ data:[{id:'ctg.evaluation-budget',state:{status:'active'}}] }) },
    session: {
      create: async () => ({ id:'api-failure-session' }),
      prompt: async () => { throw Error('fixture API transport failure'); },
      wait: async () => {},
      get: async () => terminal
        ? { outcome:'interrupted',cost:0,tokens:{input:0,output:0,reasoning:0,cache:{read:0,write:0}} }
        : { cost:0,tokens:{input:0,output:0,reasoning:0,cache:{read:0,write:0}} },
      interrupt: async (input) => { interrupts.push(input); terminal=true; },
    },
    event: { subscribe: async function* ({signal}) { await new Promise(resolve => signal.addEventListener('abort',resolve,{once:true})); } },
  };
  const result = await runNativeEvaluation({client:api,directory:tmpdir(),prompt:'fail API',model:'fixture',provider:'local',timeoutSeconds:5,maxTurns:2,maxCost:1,outcomeTimeoutSeconds:1});
  assert.equal(result.exitCode,1);
  assert.equal(result.outcome,'interrupted');
  assert.equal(result.interruptionStatus,'confirmed');
  assert.equal(interrupts.length,1);
  assert.equal(interrupts[0].sessionID,'api-failure-session');
  assert.equal(interrupts[0].resume,false);
  assert.ok(result.errors.some(error=>/fixture API transport failure/.test(error)));
});
