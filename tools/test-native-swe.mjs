#!/usr/bin/env node
// Adapter/unit smoke using a deterministic injected API; the real host acceptance
// lives in test-native-swe-host.mjs.
import test from 'node:test';
import { Schema } from 'effect';
import { Tool } from '@opencode/schema/session-event';
import { AssistantTool } from '@opencode/schema/session-message';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { runNativeEvaluation } from '../lib/opencode/evaluation.mjs';

// Validate native event payloads, including the absence of a name on Called.
const toolEvent = (definition, id, extra = {}, assistantMessageID = 'msg_a', sessionID = 'ses_accounting') => ({
  type: definition.type,
  data: Schema.decodeUnknownSync(definition.data)({ sessionID, assistantMessageID, id, ...extra }),
});
const started = (id, name, message) => toolEvent(Tool.Input.Started, id, { name }, message);
const called = (id, message) => toolEvent(Tool.Called, id, { input: {}, executed: true }, message);
const terminal = (id, type, extra = {}, message) => toolEvent(type === 'success' ? Tool.Success : Tool.Failed, id, {
  executed: true,
  ...(type === 'success' ? { content: [{ type: 'text', text: 'ok' }] } : { error: { type: 'fixture', message: 'failed' } }),
  ...extra,
}, message);
const toolPart = (id, name, status, content = [], metadata = {}) => ({
  type: 'tool', id, name, state: { status, content, metadata },
});
const resultText = status => [{ type: 'text', text: JSON.stringify({ status }) }];
async function accountTools(parts, events = [], messages) {
  const api = {
    server: { info: async () => ({ version: '2.0.32' }) },
    plugin: { list: async () => ({ data: [{ id: 'ctg.evaluation-budget', state: { status: 'active' } }] }) },
    session: {
      create: async () => ({ id: 'ses_accounting' }), prompt: async () => {}, wait: async () => {},
      get: async () => ({ outcome: 'succeeded', cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }),
    },
    event: { subscribe: async function* () { yield* events; } },
    message: { list: async () => {
      if (parts === null) throw Error('fixture transcript unavailable');
      return { data: messages || [{ id: 'msg_a', type: 'assistant', finish: 'stop', content: parts }], cursor: {} };
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
  const events = [
    started('e1', 'execute'), called('e1'),
    terminal('e1', 'success', { metadata: { toolCalls: [{ tool: 'carthagent.delivery_plan', status: 'error' }] } }),
    started('f1', 'carthagent_delivery_finish'), called('f1'),
    terminal('f1', 'success', { content: resultText('verified') }),
  ];
  const completed = await accountTools(null, events);
  assert.equal(completed.exitCode, 1);
  assert.ok(completed.errors.includes('fixture transcript unavailable'));
  assert.deepEqual(completed.tools, { execute: 1, delivery_plan: 1, delivery_finish: 1 });
  assert.deepEqual(completed.toolErrors, { delivery_plan: 1 });
  assert.equal(completed.deliveryStatus, 'verified');

  const failed = await accountTools(null, [...events,
    started('f2', 'carthagent.delivery_finish'), called('f2'), terminal('f2', 'failed'),
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
    started('f1', 'carthagent_delivery_finish'), called('f1'),
    started('f1', 'carthagent_delivery_finish'), called('f1'),
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
      create: async () => ({ id: 'ses_1' }),
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
          toolEvent(Tool.Input.Started, 't1', { name: 'edit' }, 'msg_1', 'ses_1'),
          toolEvent(Tool.Called, 't1', { input: {path:'src/value.mjs'}, executed: true }, 'msg_1', 'ses_1'),
          toolEvent(Tool.Input.Started, 't2', { name: 'shell' }, 'msg_1', 'ses_1'),
          toolEvent(Tool.Called, 't2', { input: {command:'node --test src/value.test.mjs'}, executed: true }, 'msg_1', 'ses_1'),
          { type: 'session.step.ended', data: { sessionID: 'ses_1', assistantMessageID:'msg_1', finish:'stop', cost:0, tokens:{total:12} } },
          { type: 'session.idle', data: { sessionID:'ses_1' } },
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
    message: { list: async () => ({ data:[{id:'msg_1',type:'assistant',finish:'stop',cost:0,tokens:{total:12},content:[
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


test('event fallback scopes reused IDs by assistant message and ignores input-only calls', async () => {
  const result = await accountTools(null, [
    started('same', 'shell'), called('same'), terminal('same', 'failed'),
    started('same', 'edit', 'msg_b'), called('same', 'msg_b'), terminal('same', 'success', {}, 'msg_b'),
    started('never-called', 'delivery_finish'),
    // A duplicate called observation must not erase a terminal result.
    called('same'),
  ]);
  assert.deepEqual(result.tools, { shell: 1, edit: 1 });
  assert.deepEqual(result.toolErrors, { shell: 1 });
  assert.equal(result.deliveryStatus, null);
});

test('transcript IDs deduplicate within, not across, assistant messages', async () => {
  const messages = ['msg_a', 'msg_b'].map(id => ({ id, type: 'assistant', finish: 'stop', content: [
    toolPart('wrapper', 'execute', 'completed', [], { toolCalls: [{ id: 'same', tool: 'shell', status: 'error' }] }),
    toolPart('same', 'shell', 'error'),
  ] }));
  const result = await accountTools([], [], messages);
  assert.deepEqual(result.tools, { execute: 2, shell: 2 });
  assert.deepEqual(result.toolErrors, { shell: 2 });
});

test('metadata tool names are safe own properties in plain serialized counters', async () => {
  const names = ['constructor', 'toString', '__proto__'];
  const result = await accountTools([toolPart('wrapper', 'execute', 'completed', [], {
    toolCalls: names.flatMap(tool => [{ tool, status: 'error' }, { tool, status: 'error' }]),
  })]);
  assert.equal(Object.getPrototypeOf(result.tools), Object.prototype);
  assert.deepEqual(JSON.parse(JSON.stringify(result.tools)), Object.fromEntries([['execute', 1], ...names.map(name => [name, 2])]));
  assert.deepEqual(result.toolErrors, Object.fromEntries(names.map(name => [name, 2])));
});

test('available transcript ignores streaming-only tools without losing real calls or the last finish', async () => {
  const nativePart = (id, name, state) => Schema.decodeUnknownSync(AssistantTool)({
    type: 'tool', id, name, state, time: { created: 1 },
  });
  const streaming = nativePart('stream', 'delivery_finish', { status: 'streaming', input: '{"status":' });
  const events = [started('stream', 'delivery_finish')];
  const onlyInput = await accountTools([streaming], events);
  assert.equal(onlyInput.exitCode, 0);
  assert.deepEqual(onlyInput.tools, {});
  assert.deepEqual(onlyInput.toolErrors, {});
  assert.equal(onlyInput.deliveryStatus, null);

  const mixed = await accountTools([
    nativePart('running', 'shell', { status: 'running', input: {}, metadata: {} }),
    nativePart('error', 'edit', { status: 'error', input: {}, error: { type: 'fixture', message: 'failed' } }),
    nativePart('finish', 'delivery_finish', { status: 'completed', input: {}, content: resultText('verified') }),
    streaming,
  ], events);
  assert.equal(mixed.exitCode, 0);
  assert.deepEqual(mixed.tools, { shell: 1, edit: 1, delivery_finish: 1 });
  assert.deepEqual(mixed.toolErrors, { edit: 1 });
  assert.equal(mixed.deliveryStatus, 'verified');
});

test('finish accepts only supported terminal verdict strings', async () => {
  for (const status of [{ verified: true }, ['verified'], 'running', 'unknown', true, 1]) {
    const result = await accountTools([toolPart('finish', 'delivery_finish', 'completed', resultText(status))]);
    assert.equal(result.deliveryStatus, null, JSON.stringify(status));
  }
});
