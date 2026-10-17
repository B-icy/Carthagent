#!/usr/bin/env node
// Offline native-runtime adapter smoke: proves real filesystem edits and tests
// can be made through the standard OpenCode edit/write/shell tools without a key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runNativeEvaluation } from '../lib/opencode/evaluation.mjs';

test('native evaluation consumes actual OpenCode event shapes and fails closed on unknown cost', async () => {
  const events = [];
  const api = {
    server: { info: async () => ({ version: '2.0.32' }) },
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
    const result = await runNativeEvaluation({ client:api, directory:'/tmp', prompt:'hang', model:'fixture', provider:'local', signal:controller.signal, timeoutSeconds:5, maxTurns:2, maxCost:1 });
    assert.equal(result.exitCode,1);
    assert.equal(result.outcome,null);
    assert.equal(result.interruptionStatus,'unknown');
    assert.equal(result.budgetReason,'cancelled');
    assert.ok(Date.now()-started < 3000, 'a never-resolving interrupt must not hold evaluation cleanup');
  } finally { clearTimeout(abortTimer); }
});
