import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cliHelp, openCodeCliManifest, parseOpenCodeArgs, runOpenCodeCli } from '../lib/opencode/cli.mjs';
import { createOpenCodeCliRuntime, headlessSucceeded, latestSessionForWorkspace, modelWithThinking, nativeJsonEvents, reconcileHeadlessResult, textParts } from '../lib/opencode/cli-runtime.mjs';

function ioCapture() {
  const output = { stdout: [], stderr: [] };
  return { output, io: { log: value => output.stdout.push(String(value)), error: value => output.stderr.push(String(value)) } };
}

test('native CLI parser preserves supported options, aliases and prompt delimiter', () => {
  assert.deepEqual(parseOpenCodeArgs([
    '--provider', 'openai', '--model', 'o4-mini', '--engine-cli', '/opt/opencode',
    '--isolate', '--no-strict', '--json', '--', 'Build', 'it', '--literally',
  ]), {
    provider: 'openai', model: 'o4-mini', engineCli: '/opt/opencode', isolate: true,
    strict: false, json: true, prompt: 'Build it --literally',
  });
  assert.equal(openCodeCliManifest.aliases.ui, 'tui');
  assert.equal(openCodeCliManifest.aliases.s, 'status');
  assert.throws(() => parseOpenCodeArgs(['--model']), /Missing value/);
  assert.throws(() => parseOpenCodeArgs(['--wat']), /Unknown flag/);
});

test('native CLI selects headless execution and preserves output-mode options', async () => {
  const { output, io } = ioCapture();
  let invocation;
  const code = await runOpenCodeCli({
    argv: ['-p', '--model', 'openai/gpt-4.1', 'Do work'], stdoutIsTTY: false, io,
    runtime: { run: async request => { invocation = request; return 7; } },
  });
  assert.equal(code, 7);
  assert.deepEqual(output.stderr, []);
  assert.equal(invocation.mode, 'headless');
  assert.equal(invocation.options.model, 'openai/gpt-4.1');
  assert.equal(invocation.prompt, 'Do work');
});

test('headless CLI validates prompts and maps cancellation to conventional exit code', async () => {
  const { io, output } = ioCapture();
  assert.equal(await runOpenCodeCli({ argv: [], stdoutIsTTY: false, io, runtime: {} }), 1);
  assert.match(output.stderr[0], /requires a prompt/);
  assert.equal(await runOpenCodeCli({
    argv: ['task'], stdoutIsTTY: true, io,
    runtime: { run: async () => { const error = new Error('cancelled'); error.name = 'AbortError'; throw error; } },
  }), 130);
});

test('model, auth, cloud and domain entrypoints dispatch to injected native capabilities', async () => {
  const calls = [];
  const runtime = {
    listModels: async request => { calls.push(['models', request.query]); },
    login: async () => { calls.push(['login']); },
    account: async () => { calls.push(['account']); },
    billing: async request => { calls.push(['billing', request.action]); },
    logout: async request => { calls.push(['logout', request.session]); },
    domain: async request => { calls.push(['domain', request.command, request.args[0]]); return 0; },
  };
  const { io } = ioCapture();
  assert.equal(await runOpenCodeCli({ argv: ['--list-models', 'claude'], runtime, io }), 0);
  assert.equal(await runOpenCodeCli({ argv: ['login'], runtime, io, stdoutIsTTY: true }), 0);
  assert.equal(await runOpenCodeCli({ argv: ['account'], runtime, io }), 0);
  assert.equal(await runOpenCodeCli({ argv: ['billing'], runtime, io }), 0);
  assert.equal(await runOpenCodeCli({ argv: ['logout-cloud', 'session-1'], runtime, io }), 0);
  assert.equal(await runOpenCodeCli({ argv: ['check', 'unit'], runtime, io }), 0);
  assert.deepEqual(calls, [
    ['models', 'claude'], ['login'], ['account'], ['billing', 'checkout'],
    ['logout', 'session-1'], ['domain', 'check', 'unit'],
  ]);
});

test('help preserves command aliases, Ship operations and isolation semantics', async () => {
  const { output, io } = ioCapture();
  assert.equal(await runOpenCodeCli({ argv: ['--help'], io, version: '1.0.3' }), 0);
  assert.match(output.stdout[0], /account.*Ship credit/);
  assert.match(output.stdout[0], /billing.*checkout\|portal/);
  assert.match(output.stdout[0], /--isolate\s+Isolate extension\/skill discovery \(not a worktree\)/);
  assert.equal(cliHelp('x').includes('--engine-cli, --agent-cli'), true);
});

test('missing native capabilities fail explicitly instead of silently succeeding', async () => {
  const { output, io } = ioCapture();
  assert.equal(await runOpenCodeCli({ argv: ['account'], runtime: {}, io }), 1);
  assert.match(output.stderr[0], /does not provide account\(\)/);
});

test('headless native results require authoritative successful terminal and assistant outcomes', () => {
  assert.equal(headlessSucceeded({ messages: [] }), false);
  assert.equal(headlessSucceeded({ messages: [{ type: 'assistant', finish: 'stop', parts: [{ type: 'text', text: 'looks done' }] }] }), false);
  assert.equal(headlessSucceeded({ messages: [
    { type: 'assistant', finish: 'error', error: { message: 'provider failed' } },
    { type: 'idle', outcome: 'failed' },
  ] }), false);
  assert.equal(headlessSucceeded({ session: { outcome: 'interrupted' }, messages: [
    { type: 'assistant', finish: 'stop' }, { type: 'idle', outcome: 'interrupted' },
  ] }), false);
  assert.equal(headlessSucceeded({ session: { outcome: 'succeeded' }, messages: [
    { type: 'assistant', finish: 'stop' }, { type: 'idle', outcome: 'succeeded' },
  ] }), true);
  assert.equal(headlessSucceeded({ session: { outcome: 'failed' }, messages: [
    { type: 'assistant', finish: 'stop' }, { type: 'idle', outcome: 'succeeded' },
  ] }), false);
});

test('thinking level maps to native model variant, not an invented prompt property', () => {
  assert.deepEqual(modelWithThinking({ providerID: 'fixture', id: 'model' }, 'high'), {
    providerID: 'fixture', id: 'model', variant: 'high',
  });
  assert.equal(modelWithThinking(undefined, 'high'), undefined);
});

test('headless terminal reconciliation observes a delayed native session projection', async () => {
  let reads = 0;
  const latest = await reconcileHeadlessResult({
    session: { id: 'ses_lagging' },
    messages: [{ type: 'assistant', finish: 'stop', parts: [{ type: 'text', text: 'answer' }] }],
  }, { timeoutMs: 500, client: { session: {
    get: async () => ({ id: 'ses_lagging', ...(++reads < 2 ? {} : { outcome: 'succeeded' }) }),
    context: async () => reads < 2
      ? [{ type: 'assistant', finish: 'stop' }]
      : [{ type: 'assistant', finish: 'stop' }, { type: 'idle', outcome: 'succeeded' }],
  } } });
  assert.ok(reads >= 2);
  assert.equal(headlessSucceeded(latest), true);
});

test('headless text output selects the completed assistant response for the latest user turn', () => {
  assert.deepEqual(textParts([
    { type: 'user', text: 'old question' },
    { type: 'assistant', finish: 'stop', parts: [{ type: 'text', text: 'stale answer' }] },
    { type: 'idle', outcome: 'succeeded' },
    { type: 'user', text: 'new question' },
    { type: 'assistant', finish: 'stop', parts: [{ type: 'text', text: 'current answer' }] },
    { type: 'idle', outcome: 'succeeded' },
  ]), ['current answer']);
});

test('native JSON event projection translates real tool lifecycle and filters unrelated sessions', () => {
  const events = nativeJsonEvents([
    { id: 'foreign', created: 1, type: 'session.tool.called', data: { sessionID: 'other', id: 'x', input: { name: 'bash' } } },
    { id: 'called', created: 2, type: 'session.tool.called', data: { sessionID: 'selected', id: 'call-1', input: { name: 'bash', arguments: { command: 'printf ok' } } } },
    { id: 'success', created: 3, type: 'session.tool.success', data: { sessionID: 'selected', id: 'call-1', content: [{ type: 'text', text: 'ok' }] } },
  ], 'selected', [
    { type: 'user', text: 'run' },
    { type: 'assistant', finish: 'tool-calls', parts: [] },
    { type: 'tool', state: { status: 'completed' } },
    { type: 'assistant', finish: 'stop', parts: [{ type: 'text', text: 'done' }] },
    { type: 'idle', outcome: 'succeeded' },
  ]);
  assert.deepEqual(events.map(event => event.type), ['tool_execution_start', 'tool_execution_end', 'message_end', 'message']);
  assert.equal(events[0].toolName, 'bash');
  assert.deepEqual(events[0].args, { command: 'printf ok' });
  assert.equal(events[1].isError, false);
  assert.deepEqual(events[2].message.content, [{ type: 'text', text: 'done' }]);
  assert.deepEqual(events[3].message, { type: 'idle', outcome: 'succeeded' });
});

test('native JSON failure projection preserves provider error and terminal outcome for the selected session', () => {
  const events = nativeJsonEvents([
    { id: 'stale-other-session', created: 1, type: 'session.execution.succeeded', data: { sessionID: 'another-session' } },
    { id: 'failed-execution', created: 2, type: 'session.execution.failed', data: { sessionID: 'failed-session', error: { message: 'provider unavailable' } } },
  ], 'failed-session', [
    { type: 'user', text: 'fail' },
    { type: 'assistant', finish: 'error', errorMessage: 'provider unavailable', content: [{ type: 'text', text: 'provider unavailable' }] },
    { type: 'idle', outcome: 'failed' },
  ]);
  assert.deepEqual(events.map(event => event.type), ['message_end', 'message', 'message']);
  assert.ok(events.every(event => event.sessionID === 'failed-session'));
  assert.equal(events[0].message.stopReason, 'error');
  assert.equal(events[0].message.error, 'provider unavailable');
  assert.deepEqual(events.at(-1).message, { type: 'idle', outcome: 'failed' });
});

test('headless continuation selects the newest session within the exact workspace', async () => {
  const selected = await latestSessionForWorkspace({ session: { list: async ({ directory }) => ({ data: [
    { id: 'wrong-workspace-newest', location: { directory: '/other' }, time: { updated: 999 } },
    { id: 'older-workspace-session', location: { directory }, time: { updated: 10 } },
    { id: 'newest-workspace-session', location: { directory }, time: { updated: 20 } },
  ] }) } }, '/project');
  assert.equal(selected, 'newest-workspace-session');
});

test('native runtime rejects budgets that the active delivery plugin cannot enforce', async () => {
  const runtime = await createOpenCodeCliRuntime({ cwd: process.cwd(), native: {
    runtime: {}, service: { ensureService: async () => { throw new Error('must not start service'); } },
    headless: {},
  } });
  for (const [key, value] of [['maxTools', '2'], ['maxSeconds', '20'], ['maxRepairs', '1']]) {
    await assert.rejects(runtime.run({ mode: 'headless', options: { prompt: 'task', [key]: value }, prompt: 'task' }), /not supported until the active native delivery plugin enforces session budgets/);
  }
});

test('concrete headless runtime returns failure for failed native session outcome', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const cwd = mkdtempSync(join(tmpdir(), 'ctg-opencode-failed-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const service = { url: 'http://127.0.0.1:1', headers: {}, binary: '/fixture/opencode', paths: { root: '/fixture/home' } };
  const runtime = await createOpenCodeCliRuntime({ cwd, io: ioCapture().io, stdout: { write() {} }, native: {
    runtime: {},
    service: { ensureService: async () => service },
    headless: { runHeadless: async () => ({
      session: { id: 'ses_failed' },
      messages: [
        { type: 'assistant', finish: 'error', error: { message: 'provider failure' }, parts: [{ type: 'text', text: 'provider failure' }] },
        { type: 'idle', outcome: 'failed' },
      ],
    }) },
    clientFactory: async () => ({ session: {
      get: async () => ({ id: 'ses_failed', outcome: 'failed' }),
      context: async () => [
        { type: 'assistant', finish: 'error', error: { message: 'provider failure' } },
        { type: 'idle', outcome: 'failed' },
      ],
    } }),
  } });
  assert.equal(await runtime.run({ mode: 'headless', options: { prompt: 'Run' }, prompt: 'Run' }), 1);
});

test('concrete native runtime uses OpenCode service/headless/model APIs and real delivery status', async t => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const cwd = mkdtempSync(join(tmpdir(), 'ctg-opencode-cli-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFileSync(join(cwd, 'source.mjs'), 'export default true;\n');
  const events = [];
  const service = { url: 'http://127.0.0.1:1', headers: {}, binary: '/fixture/opencode', paths: { root: '/fixture/home' } };
  const native = {
    runtime: {
      runtimeEnvironment: () => ({ CTG_FIXTURE: '1' }),
      readRuntimeCredentials: async () => ({ 'experiential-labs': { access: 'fixture-access' } }),
    },
    service: {
      ensureService: async options => { events.push(['service', options.pluginPath]); return service; },
      launchTui: (selectedService, workspace, options) => {
        events.push(['tui', selectedService === service, workspace, options.sessionID]);
        return { once(event, callback) { if (event === 'exit') queueMicrotask(() => callback(0, null)); } };
      },
    },
    headless: {
      runHeadless: async (selectedService, workspace, prompt, options) => {
        events.push(['headless', selectedService === service, workspace, prompt, options.sessionID]);
        return { session: { id: 'ses_fixture', outcome: 'succeeded' }, messages: [
          { type: 'assistant', finish: 'stop', parts: [{ type: 'text', text: 'native answer' }] },
          { type: 'idle', outcome: 'succeeded' },
        ] };
      },
    },
    clientFactory: async () => ({
      session: {
        get: async () => ({ id: 'ses_fixture', outcome: 'succeeded' }),
        context: async () => [
          { type: 'assistant', finish: 'stop', parts: [{ type: 'text', text: 'native answer' }] },
          { type: 'idle', outcome: 'succeeded' },
        ],
      },
      model: { list: async () => ({ data: [
        { providerID: 'anthropic', modelID: 'claude-fixture', name: 'Claude Fixture', limit: { context: 100, output: 10 }, cost: [{ input: 1, output: 2 }] },
      ] }) },
    }),
  };
  const output = [];
  const io = { log: text => output.push(String(text)), error: text => output.push(`ERR:${text}`) };
  const stdout = { write: text => output.push(String(text)) };
  const runtime = await createOpenCodeCliRuntime({ cwd, native, io, stdout });
  assert.equal(await runtime.run({ mode: 'headless', options: { prompt: 'Do a task' }, prompt: 'Do a task' }), 0);
  assert.equal(output.at(-1), 'native answer\n');
  assert.equal(await runtime.listModels({ query: 'claude' }), 1);
  assert.match(output.at(-1), /anthropic\s+claude-fixture\s+100\s+10/);
  assert.equal(await runtime.run({ mode: 'interactive', options: {}, prompt: undefined }), 0);
  assert.ok(events.some(entry => entry[0] === 'service'));
  assert.ok(events.some(entry => entry[0] === 'headless' && entry[3] === 'Do a task'));
  assert.ok(events.some(entry => entry[0] === 'tui' && entry[2] === cwd));
  assert.equal(resolve(cwd), cwd);
});
