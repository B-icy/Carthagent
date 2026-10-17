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
  assert.equal(await runOpenCodeCli({ argv: ['auth'], runtime, io, stdoutIsTTY: true }), 0);
  assert.equal(await runOpenCodeCli({ argv: ['account'], runtime, io }), 0);
  assert.equal(await runOpenCodeCli({ argv: ['cloud'], runtime, io }), 0);
  assert.equal(await runOpenCodeCli({ argv: ['billing'], runtime, io }), 0);
  assert.equal(await runOpenCodeCli({ argv: ['logout-cloud', 'session-1'], runtime, io }), 0);
  assert.equal(await runOpenCodeCli({ argv: ['check', 'unit'], runtime, io }), 0);
  assert.deepEqual(calls, [
    ['models', 'claude'], ['login'], ['login'], ['account'], ['account'], ['billing', 'checkout'],
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

test('headless terminal reconciliation preserves the bounded turn and observes missing terminal state', async () => {
  let reads = 0;
  const latest = await reconcileHeadlessResult({
    session: { id: 'ses_lagging' },
    accepted: { id: 'accepted-user' },
    messages: [{ type: 'user', id: 'accepted-user' }],
  }, { timeoutMs: 500, client: { session: {
    get: async () => ({ id: 'ses_lagging', ...(++reads < 2 ? {} : { outcome: 'succeeded' }) }),
    context: async () => {
      reads++;
      return [
        { type: 'user', id: 'older-user' }, { type: 'assistant', finish: 'stop', parts: [{ type: 'text', text: 'stale answer' }] },
        { type: 'user', id: 'accepted-user' },
        ...(reads < 2 ? [] : [{ type: 'assistant', finish: 'stop', parts: [{ type: 'text', text: 'answer' }] }, { type: 'idle', outcome: 'succeeded' }]),
      ];
    },
  } } });
  assert.ok(reads >= 2);
  assert.equal(headlessSucceeded(latest), true);
  assert.deepEqual(textParts(latest.messages), ['answer']);
});

test('accepted nonterminal headless result keeps current-turn JSON events and session identity without history lookup', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const cwd = mkdtempSync(join(tmpdir(), 'ctg-opencode-accepted-nonterminal-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const lines = [];
  let contextReads = 0;
  const runtime = await createOpenCodeCliRuntime({ cwd, stdout: { write: value => lines.push(value) }, io: ioCapture().io, native: {
    runtime: {}, service: { ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }) },
    headless: { runHeadless: async () => ({
      session: { id: 'ses_current' }, accepted: { id: 'user-current' }, outcome: 'timed-out', terminal: false,
      messages: [
        { type: 'user', id: 'user-current' }, { type: 'assistant', finish: 'tool-calls', parts: [] },
      ],
    }) },
    clientFactory: async () => ({
      event: { subscribe: () => ({ async *[Symbol.asyncIterator]() {
        yield { id: 'call', created: 1, type: 'session.tool.called', data: { sessionID: 'ses_current', id: 'tool-1', input: { name: 'read', arguments: { filePath: 'a.txt' } } } };
        yield { id: 'done', created: 2, type: 'session.tool.success', data: { sessionID: 'ses_current', id: 'tool-1', content: [{ type: 'text', text: 'contents' }] } };
      } }) },
      session: { context: async () => { contextReads++; throw new Error('must not reconcile nonterminal result'); } },
    }),
  } });
  assert.equal(await runtime.run({ mode: 'headless', options: { prompt: 'inspect', json: true }, prompt: 'inspect' }), 1);
  assert.equal(contextReads, 0);
  const events = lines.map(line => JSON.parse(line));
  assert.ok(events.some(event => event.type === 'tool_execution_start' && event.sessionID === 'ses_current'));
  assert.ok(events.some(event => event.type === 'tool_execution_end' && event.sessionID === 'ses_current'));
  assert.ok(!events.some(event => event.message?.type === 'idle' && event.message.outcome === 'succeeded'));
});

test('headless reconciliation stops on abort or timeout and never swaps in stale history', async () => {
  const result = { session: { id: 'ses_blocked' }, messages: [
    { type: 'user', id: 'accepted' }, { type: 'assistant', finish: 'error', errorMessage: 'provider failed', content: [] },
  ], accepted: { id: 'accepted' }, outcome: 'failed', terminal: true, error: 'provider failed' };
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  const aborted = await reconcileHeadlessResult(result, { signal: controller.signal, client: { session: {
    context: async () => { throw new Error('must not request after abort'); },
  } } });
  assert.equal(headlessSucceeded(aborted), false);
  assert.equal(aborted.error, 'provider failed');
  assert.deepEqual(textParts(aborted.messages), []);

  const started = Date.now();
  const bounded = await reconcileHeadlessResult({ ...result, terminal: false }, { timeoutMs: 30, client: { session: {
    context: async () => new Promise(() => {}),
  } } });
  assert.ok(Date.now() - started < 500);
  assert.equal(bounded.terminal, false);
  assert.equal(headlessSucceeded(bounded), false);
  assert.deepEqual(textParts(bounded.messages), []);
});

test('a provider failure after a previous successful assistant turn cannot print stale success', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const cwd = mkdtempSync(join(tmpdir(), 'ctg-opencode-stale-turn-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const output = [];
  const stdout = { write: text => output.push(String(text)) };
  const runtime = await createOpenCodeCliRuntime({ cwd, stdout, io: ioCapture().io, native: {
    runtime: {}, service: { ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }) },
    headless: { runHeadless: async () => ({
      session: { id: 'ses_old_success' }, accepted: { id: 'new-user' }, outcome: 'failed', terminal: true, error: 'provider unavailable',
      messages: [
        { type: 'user', id: 'old-user' }, { type: 'assistant', finish: 'stop', parts: [{ type: 'text', text: 'stale success answer' }] }, { type: 'idle', outcome: 'succeeded' },
        { type: 'user', id: 'new-user' }, { type: 'assistant', finish: 'error', errorMessage: 'provider unavailable', parts: [] },
      ],
    }) },
    clientFactory: async () => ({ session: {
      context: async () => [
        { type: 'user', id: 'old-user' }, { type: 'assistant', finish: 'stop', parts: [{ type: 'text', text: 'stale success answer' }] }, { type: 'idle', outcome: 'succeeded' },
      ],
    } }),
  } });
  assert.equal(await runtime.run({ mode: 'headless', options: { prompt: 'new turn' }, prompt: 'new turn' }), 1);
  assert.deepEqual(output, []);
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

test('native JSON projection uses authoritative headless outcome when admission failed before a new turn', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const cwd = mkdtempSync(join(tmpdir(), 'ctg-opencode-pre-admission-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const lines = [];
  let contextReads = 0;
  const runtime = await createOpenCodeCliRuntime({ cwd, stdout: { write: value => lines.push(value) }, io: ioCapture().io, native: {
    runtime: {}, service: { ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }) },
    headless: { runHeadless: async () => ({ session: { id: 'ses_existing' }, messages: [], outcome: 'interrupted', terminal: false, reason: 'aborted' }) },
    clientFactory: async () => ({ event: { subscribe: () => ({ async *[Symbol.asyncIterator]() { } }) }, session: {
      get: async () => { throw new Error('must not query existing session after pre-admission failure'); },
      context: async () => { contextReads++; throw new Error('must not query existing context after pre-admission failure'); },
    } }),
  } });
  assert.equal(await runtime.run({ mode: 'headless', options: { prompt: 'new prompt', session: 'ses_existing', json: true }, prompt: 'new prompt' }), 1);
  assert.equal(contextReads, 0);
  const events = lines.map(line => JSON.parse(line));
  assert.ok(!events.some(event => JSON.stringify(event).includes('old success')));
  assert.ok(events.some(event => event.type === 'message' && event.message.type === 'idle' && event.message.outcome === 'interrupted'));
});

test('pre-admission interruption without a session ID emits JSON terminal status without listing old sessions', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const cwd = mkdtempSync(join(tmpdir(), 'ctg-opencode-pre-admission-no-session-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const lines = [];
  let listed = false;
  const runtime = await createOpenCodeCliRuntime({ cwd, stdout: { write: value => lines.push(value) }, io: ioCapture().io, native: {
    runtime: {}, service: { ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }) },
    headless: { runHeadless: async () => ({ messages: [], outcome: 'interrupted', terminal: false, reason: 'aborted' }) },
    clientFactory: async () => ({
      event: { subscribe: () => ({ async *[Symbol.asyncIterator]() { } }) },
      session: { list: async () => { listed = true; return { data: [{ id: 'previous', location: { directory: cwd } }] }; } },
    }),
  } });
  assert.equal(await runtime.run({ mode: 'headless', options: { prompt: 'new prompt', json: true }, prompt: 'new prompt' }), 1);
  assert.equal(listed, false);
  const events = lines.map(line => JSON.parse(line));
  assert.deepEqual(events, [{ type: 'message', message: { type: 'idle', outcome: 'interrupted' } }]);
});

test('headless continuation selects the newest session within the exact workspace', async () => {
  const selected = await latestSessionForWorkspace({ session: { list: async ({ directory }) => ({ data: [
    { id: 'wrong-workspace-newest', location: { directory: '/other' }, time: { updated: 999 } },
    { id: 'older-workspace-session', location: { directory }, time: { updated: 10 } },
    { id: 'newest-workspace-session', location: { directory }, time: { updated: 20 } },
  ] }) } }, '/project');
  assert.equal(selected, 'newest-workspace-session');
});

test('native runtime fails closed when the active plugin does not advertise delivery budget enforcement', async () => {
  const runtime = await createOpenCodeCliRuntime({ cwd: process.cwd(), native: {
    runtime: {}, service: { ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }) },
    headless: {}, rpcDefinitions: { Carthagent: {} },
    clientFactory: async () => ({ rpc: () => ({ health: async () => ({ capabilities: [] }) }) }),
  } });
  for (const [key, value] of [['maxTools', '2'], ['maxSeconds', '20'], ['maxRepairs', '1']]) {
    await assert.rejects(runtime.run({ mode: 'headless', options: { prompt: 'task', [key]: value }, prompt: 'task' }), /does not advertise required enforcement capabilities/);
  }
});

test('native run rejects only options without an enforcement contract and persists framing metadata', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const cwd = mkdtempSync(join(tmpdir(), 'ctg-session-options-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const service = { url: 'http://127.0.0.1:1', headers: {} };
  const sessions = [];
  const runtime = await createOpenCodeCliRuntime({ cwd, native: {
    runtime: {}, service: { ensureService: async () => service },
    rpcDefinitions: { Carthagent: {}, SessionControls: {} },
    headless: { runHeadless: async (_service, _cwd, _prompt, options) => {
      sessions.push(options.session.metadata);
      return { session: { id: 'ses_options' }, outcome: 'succeeded', terminal: true, accepted: { id: 'a' }, messages: [
        { type: 'user', id: 'a' }, { type: 'assistant', finish: 'stop', parts: [{ type: 'text', text: 'ok' }] }, { type: 'idle', outcome: 'succeeded' },
      ] };
    } },
    clientFactory: async () => ({ rpc: () => ({ health: async () => ({ capabilities: ['delivery.session-options.v1'] }) }), session: { get: async () => ({ id: 'ses_options', outcome: 'succeeded' }), context: async () => [
      { type: 'user', id: 'a' }, { type: 'assistant', finish: 'stop', parts: [{ type: 'text', text: 'ok' }] }, { type: 'idle', outcome: 'succeeded' },
    ] } }),
  } });
  await assert.rejects(runtime.run({ mode: 'headless', options: { prompt: 'task', maxTools: '2' }, prompt: 'task' }), /does not advertise required enforcement capabilities/);
  await assert.rejects(runtime.run({ mode: 'headless', options: { prompt: 'task', delivery: false }, prompt: 'task' }), /does not advertise required enforcement capabilities/);
  await assert.rejects(runtime.run({ mode: 'headless', options: { prompt: 'task', strict: false }, prompt: 'task' }), /does not advertise required enforcement capabilities/);
  assert.equal(await runtime.run({ mode: 'headless', options: { prompt: 'task', autoFraming: false }, prompt: 'task' }), 0);
  assert.deepEqual(sessions[0]['carthagent.options'], { guide: false });
});

test('native run resolves and persists the enforced codegraph index cap per session', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const cwd = mkdtempSync(join(tmpdir(), 'ctg-codegraph-option-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  let settings;
  const runtime = await createOpenCodeCliRuntime({ cwd, stdout: { write() {} }, native: {
    runtime: {}, service: { ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }) },
    rpcDefinitions: { Carthagent: {}, SessionControls: {} },
    headless: { runHeadless: async (_service, _cwd, _prompt, options) => {
      settings = options.session.metadata['carthagent.options'];
      return { session: { id: 'ses_codegraph' }, outcome: 'succeeded', terminal: true, accepted: { id: 'a' }, messages: [
        { type: 'user', id: 'a' }, { type: 'assistant', finish: 'stop', parts: [{ type: 'text', text: 'ok' }] }, { type: 'idle', outcome: 'succeeded' },
      ] };
    } },
    clientFactory: async () => ({ rpc: () => ({ health: async () => ({ capabilities: ['delivery.session-options.v1'] }) }), session: { get: async () => ({ id: 'ses_codegraph', outcome: 'succeeded' }), context: async () => [
      { type: 'user', id: 'a' }, { type: 'assistant', finish: 'stop', parts: [{ type: 'text', text: 'ok' }] }, { type: 'idle', outcome: 'succeeded' },
    ] } }),
  } });
  assert.equal(await runtime.run({ mode: 'headless', options: { prompt: 'index', codegraphMaxFiles: '300' }, prompt: 'index' }), 0);
  assert.equal(settings.codegraphMaxFiles, 300);
});

test('interactive native session persists an explicit no-guide setting before launching the TUI', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const cwd = mkdtempSync(join(tmpdir(), 'ctg-interactive-no-guide-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const calls = [];
  const runtime = await createOpenCodeCliRuntime({ cwd, stdout: { write() {} }, native: {
    runtime: {}, service: { ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }), launchTui: (_service, _cwd, options) => { calls.push(['launch', options.sessionID]); return { once(event, callback) { if (event === 'exit') queueMicrotask(() => callback(0)); return this; }, kill() {} }; } },
    rpcDefinitions: { Carthagent: {}, SessionControls: {} },
    headless: { createSession: async (_service, _cwd, { body }) => { calls.push(['create', body.metadata['carthagent.options']]); return { id: 'ses_no_guide' }; } },
    clientFactory: async () => ({ rpc: () => ({ health: async () => ({ capabilities: ['delivery.session-options.v1'] }), framing: async input => { calls.push(['framing', input.sessionID, input.enabled]); return { enabled: input.enabled }; } }) }),
  } });
  assert.equal(await runtime.run({ mode: 'interactive', options: { autoFraming: false }, prompt: '' }), 0);
  assert.deepEqual(calls, [
    ['create', { guide: false }],
    ['framing', 'ses_no_guide', false],
    ['launch', 'ses_no_guide'],
  ]);
});

test('resumed native sessions merge explicit launcher options into their own workspace metadata', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const cwd = mkdtempSync(join(tmpdir(), 'ctg-session-options-resume-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const updates = [];
  const framingOverrides = [];
  const runtime = await createOpenCodeCliRuntime({ cwd, stdout: { write() {} }, native: {
    runtime: {}, service: { ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }) },
    rpcDefinitions: { Carthagent: {}, SessionControls: {} },
    headless: { runHeadless: async (_service, _cwd, _prompt, options) => {
      assert.equal(options.sessionID, 'ses_existing');
      return { session: { id: 'ses_existing' }, outcome: 'succeeded', terminal: true, accepted: { id: 'accepted' }, messages: [
        { type: 'user', id: 'accepted' }, { type: 'assistant', finish: 'stop', parts: [{ type: 'text', text: 'done' }] }, { type: 'idle', outcome: 'succeeded' },
      ] };
    } },
    clientFactory: async () => ({ rpc: () => ({ health: async () => ({ capabilities: ['delivery.session-options.v1'] }), framing: async input => { framingOverrides.push(input); return { enabled: input.enabled }; } }), session: {
      get: async () => ({ id: 'ses_existing', location: { directory: cwd }, metadata: { keep: 'yes', 'carthagent.options': { maxTools: 12, workflow: 'strict' } } }),
      update: async input => updates.push(input),
      context: async () => [
        { type: 'user', id: 'accepted' }, { type: 'assistant', finish: 'stop', parts: [{ type: 'text', text: 'done' }] }, { type: 'idle', outcome: 'succeeded' },
      ],
    } }),
  } });
  assert.equal(await runtime.run({ mode: 'headless', options: { prompt: 'continue', session: 'ses_existing', autoFraming: false }, prompt: 'continue' }), 0);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].metadata, { keep: 'yes', 'carthagent.options': { maxTools: 12, workflow: 'strict', guide: false } });
  assert.deepEqual(framingOverrides, [{ sessionID: 'ses_existing', enabled: false }]);
});

test('native login uses OpenCode integration OAuth status and completion lifecycle', async () => {
  const calls = [];
  const service = { url: 'http://127.0.0.1:1', headers: {} };
  const integration = {
    id: 'experiential-labs', name: 'Carthagent Ship',
    methods: [{ id: 'carthagent-device', type: 'oauth', label: 'Sign in with Carthagent Ship' }],
  };
  const runtime = await createOpenCodeCliRuntime({ cwd: '/project', io: ioCapture().io, stdin: { isTTY: true }, stdout: { isTTY: true }, native: {
    runtime: {}, service: { ensureService: async () => service }, headless: {},
    clientFactory: async () => ({ integration: {
      list: async input => { calls.push(['list', input]); return { data: [integration] }; },
      oauth: {
        connect: async input => { calls.push(['connect', input]); return { data: {
          attemptID: 'attempt-1', url: 'https://auth.example/device', instructions: 'Approve access', mode: 'auto',
          time: { expires: Date.now() + 10_000 },
        } }; },
        status: async input => { calls.push(['status', input]); return { data: { status: 'complete', time: { created: 1, expires: 2 } } }; },
        cancel: async input => { calls.push(['cancel', input]); },
      },
    } }),
  } });
  assert.equal(await runtime.login(), 0);
  assert.deepEqual(calls.map(([name]) => name), ['list', 'connect', 'status']);
  assert.equal(calls[1][1].methodID, 'carthagent-device');
  assert.deepEqual(calls[1][1].location, { directory: '/project' });
});

test('native login cancellation maps to 130 and attempts to cancel the pending host flow', async () => {
  const calls = [];
  const runtime = await createOpenCodeCliRuntime({ cwd: '/project', io: ioCapture().io, stdin: { isTTY: true }, stdout: { isTTY: true }, native: {
    runtime: {}, service: { ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }) }, headless: {},
    clientFactory: async () => ({ integration: {
      list: async () => ({ data: [{ id: 'provider', name: 'Provider', methods: [{ id: 'device', type: 'oauth', label: 'Device' }] }] }),
      oauth: {
        connect: async () => ({ data: { attemptID: 'attempt-cancel', url: 'https://auth.example', instructions: 'Approve', mode: 'auto', time: { expires: Date.now() + 60_000 } } }),
        status: async (_input, { signal }) => new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
        cancel: async input => { calls.push(input.attemptID); },
      },
    } }),
  } });
  const timer = setTimeout(() => process.emit('SIGINT'), 40);
  timer.unref?.();
  try {
    assert.equal(await runOpenCodeCli({ argv: ['login'], runtime, io: ioCapture().io, stdoutIsTTY: true }), 130);
  } finally { clearTimeout(timer); }
  assert.deepEqual(calls, ['attempt-cancel']);
});

test('native key login rejects before prompting; secret OAuth form input is masked and hidden fields retain defaults', async () => {
  const calls = [];
  const keyRuntime = await createOpenCodeCliRuntime({ cwd: '/project', io: ioCapture().io, stdin: { isTTY: true }, stdout: { isTTY: true }, native: {
    runtime: {}, service: { ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }) }, headless: {},
    clientFactory: async () => ({ integration: { list: async () => ({ data: [{ id: 'key-provider', name: 'Key Provider', methods: [{ id: 'api-key', type: 'key', label: 'API key' }] }] }) } }),
  } });
  await assert.rejects(keyRuntime.login({ args: ['key-provider', 'key'] }), /not supported/);

  const displayed = [];
  const fakeInput = Object.assign(new (await import('node:events')).EventEmitter(), { isTTY: true, isRaw: false, setRawMode(value) { this.isRaw = value; }, resume() {} });
  const fakeOutput = { isTTY: true, write: value => displayed.push(String(value)) };
  const oauthRuntime = await createOpenCodeCliRuntime({ cwd: '/project', io: ioCapture().io, stdin: fakeInput, stdout: fakeOutput, native: {
    runtime: {}, service: { ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }) }, headless: {},
    clientFactory: async () => ({ integration: {
      list: async () => ({ data: [{ id: 'oauth-provider', name: 'OAuth Provider', methods: [{
        id: 'oauth', type: 'oauth', label: 'OAuth', form: [
          { key: 'client_secret', type: 'string', title: 'Client secret', required: true },
          { key: 'scope', type: 'string', title: 'Scope', default: 'default-scope', hidden: true },
        ],
      }] }] }),
      oauth: {
        connect: async input => {
          calls.push(input.answer);
          return { data: { attemptID: 'a', mode: 'auto', url: 'https://example.test', instructions: 'auth', time: { expires: Date.now() + 1000 } } };
        },
        status: async () => ({ data: { status: 'complete' } }),
      },
    } }),
  } });
  const login = oauthRuntime.login({ args: ['oauth-provider'] });
  await new Promise(resolve => setTimeout(resolve, 0));
  fakeInput.emit('data', 'sensitive-value\r');
  await login;
  assert.deepEqual(calls[0], { client_secret: 'sensitive-value', scope: 'default-scope' });
  assert.ok(displayed.join('').includes('**************'));
  assert.ok(!displayed.join('').includes('sensitive-value'));
});

test('OAuth forms honor conditional fields, defaults, validation, and typed selections', async () => {
  const calls = [];
  const input = Object.assign(new (await import('node:events')).EventEmitter(), {
    isTTY: true, isRaw: false,
    setRawMode(value) { this.isRaw = value; },
    resume() {},
  });
  const replies = ['standard\r', '4\r', 'true\r', 'alpha,beta\r'];
  let promptIndex = 0;
  const fakeStdout = { isTTY: true, write() {}, on() {}, removeListener() {}, end() {} };
  const readlineFactory = options => {
    return { close() {}, question: async label => {
      assert.ok(label.includes(['Mode', 'Count', 'Enabled', 'Features'][promptIndex]));
      return replies[promptIndex++].trimEnd();
    } };
  };
  const injectedRuntime = await createOpenCodeCliRuntime({ cwd: '/project', io: ioCapture().io, stdin: input, stdout: fakeStdout, readlineFactory, native: {
    runtime: {}, service: { ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }) }, headless: {},
    clientFactory: async () => ({ integration: {
      list: async () => ({ data: [{ id: 'forms', name: 'Forms', methods: [{ id: 'oauth', type: 'oauth', label: 'OAuth', form: [
        { key: 'mode', type: 'string', title: 'Mode', required: true, options: [{ value: 'standard', label: 'Standard' }, { value: 'advanced', label: 'Advanced' }] },
        { key: 'count', type: 'integer', title: 'Count', required: true, minimum: 1, maximum: 5, default: 4, when: [{ key: 'mode', op: 'eq', value: 'standard' }] },
        { key: 'enabled', type: 'boolean', title: 'Enabled', default: true },
        { key: 'features', type: 'multiselect', title: 'Features', options: [{ value: 'alpha', label: 'Alpha' }, { value: 'beta', label: 'Beta' }], minItems: 1, maxItems: 2 },
      ] }] }] }),
      oauth: {
        connect: async value => { calls.push(value.answer); return { data: { attemptID: 'form', mode: 'auto', url: 'https://auth.example', instructions: 'approve', time: { expires: Date.now() + 1000 } } }; },
        status: async () => ({ data: { status: 'complete' } }),
      },
    } }),
  } });
  await injectedRuntime.login({ args: ['forms'] });
  assert.deepEqual(calls[0], { mode: 'standard', count: 4, enabled: true, features: ['alpha', 'beta'] });
  assert.equal(promptIndex, 4);
});

test('OAuth optional boolean fields keep their native default when left blank', async () => {
  const calls = [];
  const output = ioCapture();
  const runtime = await createOpenCodeCliRuntime({ cwd: '/project', io: output.io, stdin: { isTTY: true }, stdout: { isTTY: true, write() {} }, readlineFactory: () => ({ close() {}, question: async () => '' }), native: {
    runtime: {}, service: { ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }) }, headless: {},
    clientFactory: async () => ({ integration: {
      list: async () => ({ data: [{ id: 'bool', name: 'Boolean', methods: [{ id: 'oauth', type: 'oauth', label: 'OAuth', form: [{ key: 'enabled', type: 'boolean', default: true }] }] }] }),
      oauth: {
        connect: async input => { calls.push(input.answer); return { data: { attemptID: 'bool', mode: 'auto', url: 'https://auth.example', instructions: 'approve', time: { expires: Date.now() + 1000 } } }; },
        status: async () => ({ data: { status: 'complete' } }),
      },
    } }),
  } });
  await runtime.login({ args: ['bool'] });
  assert.deepEqual(calls, [{ enabled: true }]);
});

test('native account and logout use the active profile RPC and remove only its credential after revoke', async () => {
  const calls = [];
  const service = { url: 'http://127.0.0.1:1', headers: {} };
  const rpcDefinition = {};
  const account = { accountId: 'acct-profile', balance: { availableNanoUsd: 100 }, subscription: { status: 'none' }, grants: [], sessions: [] };
  const runtime = await createOpenCodeCliRuntime({ cwd: '/project', io: ioCapture().io, native: {
    runtime: {}, service: { ensureService: async () => service }, headless: {},
    rpcDefinitions: { Carthagent: rpcDefinition },
    clientFactory: async () => ({
      rpc: definition => {
        assert.equal(definition, rpcDefinition);
        return {
          shipAccount: async input => { calls.push(['account', input]); return { account }; },
          shipBilling: async input => { calls.push(['billing', input]); return { url: 'https://billing.test/portal' }; },
          shipLogout: async input => { calls.push(['logout', input]); return { revoked: true, credentialID: 'profile-credential-id' }; },
        };
      },
      credential: { remove: async input => { calls.push(['remove', input]); } },
    }),
  } });
  assert.equal(await runtime.account({ args: ['--json'] }), 0);
  assert.equal(await runtime.logout({}), 0);
  assert.deepEqual(calls, [
    ['account', {}], ['logout', {}], ['remove', { credentialID: 'profile-credential-id' }],
  ]);
});

test('native named-session logout revokes only that session and leaves the current profile credential intact', async () => {
  const calls = [];
  const runtime = await createOpenCodeCliRuntime({ cwd: '/project', native: {
    runtime: {}, service: { ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }) }, headless: {},
    rpcDefinitions: { Carthagent: {} },
    clientFactory: async () => ({ rpc: () => ({ shipLogout: async input => { calls.push(['revoke', input]); return { revoked: true }; } }), credential: { remove: async input => calls.push(['remove', input]) } }),
  } });
  assert.equal(await runtime.logout({ session: 'ship-session-2' }), 0);
  assert.deepEqual(calls, [['revoke', { session: 'ship-session-2' }]]);
});

test('native demo runs a clearly labeled offline fixture without starting OpenCode or touching the project', async t => {
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const cwd = mkdtempSync(join(tmpdir(), 'ctg-demo-project-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const calls = [];
  const output = ioCapture();
  const runtime = await createOpenCodeCliRuntime({ cwd, io: output.io, native: {
    runtime: {}, service: { ensureService: async () => { throw new Error('offline demo must not start OpenCode'); } }, headless: {},
    demoExecute: async (argv, options) => {
      calls.push({ argv, options, app: readFileSync(join(options.cwd, 'app.mjs'), 'utf8') });
      return { code: 0, output: '2 tests passed', timedOut: false, cancelled: false };
    },
  } });
  assert.equal(await runtime.command({ command: 'demo', args: [] }), 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].argv.at(-1), 'test/app.test.mjs');
  assert.notEqual(calls[0].options.cwd, cwd);
  assert.match(calls[0].app, /export function summarize/);
  assert.match(output.output.stdout.join('\n'), /offline demo/i);
  assert.match(output.output.stdout.join('\n'), /no provider\/API calls/);
  assert.match(output.output.stdout.join('\n'), /disposable demo fixture/);
});

test('native update installs the validated package spec, and fails closed for source clones', async () => {
  const calls = [];
  const runtime = await createOpenCodeCliRuntime({ cwd: '/demo/workspace', native: {
    runtime: {}, service: { ensureService: async () => { throw new Error('demo must not launch the native service'); } }, headless: {},
    updateApi: {
      fetchLatestRelease: async () => ({ release: { version: '1.0.4', minNode: '18.0.0', installSpec: 'github:B-icy/Carthagent#v1.0.4' } }),
      packageVersion: () => '1.0.3', compareVersions: (left, right) => left.localeCompare(right, undefined, { numeric: true }),
      detectInstallMethod: () => 'npm',
    },
    packageRoot: '/package/root',
    runCommand: async (argv, options) => { calls.push({ argv, options }); return { code: 0, timedOut: false, cancelled: false, output: '' }; },
  } });
  assert.equal(await runtime.command({ command: 'update', args: [] }), 0);
  assert.deepEqual(calls, [{
    argv: ['npm', 'install', '-g', '--install-links=true', 'github:B-icy/Carthagent#v1.0.4'],
    options: { cwd: '/package/root', timeoutSeconds: 600 },
  }]);
  const cloneCalls = [];
  const cloneRuntime = await createOpenCodeCliRuntime({ cwd: '/package/root', native: {
    runtime: {}, service: {}, headless: {}, packageRoot: '/package/root',
    updateApi: {
      fetchLatestRelease: async () => ({ release: { version: '1.0.4', minNode: '18.0.0', installSpec: 'github:B-icy/Carthagent#v1.0.4' } }),
      packageVersion: () => '1.0.3', compareVersions: (left, right) => left.localeCompare(right, undefined, { numeric: true }), detectInstallMethod: () => 'clone',
    },
    runCommand: async (...args) => { cloneCalls.push(args); return { code: 0, output: '', timedOut: false, cancelled: false }; },
  } });
  await assert.rejects(cloneRuntime.command({ command: 'update', args: [] }), /refuses to checkout a release/);
  assert.deepEqual(cloneCalls, [[['git', 'status', '--porcelain'], { cwd: '/package/root', timeoutSeconds: 30 }]]);
});

test('native update check reports an available release without invoking the installer', async () => {
  const calls = [];
  const output = ioCapture();
  const runtime = await createOpenCodeCliRuntime({ cwd: '/package/root', io: output.io, native: {
    runtime: {}, service: {}, headless: {},
    updateApi: {
      fetchLatestRelease: async () => ({ release: { version: '1.0.4', minNode: '18.0.0', installSpec: 'github:B-icy/Carthagent#v1.0.4' } }),
      packageVersion: () => '1.0.3', compareVersions: (left, right) => left.localeCompare(right, undefined, { numeric: true }), detectInstallMethod: () => 'npm',
    },
    runCommand: async (...args) => { calls.push(args); return { code: 0 }; },
  } });
  assert.equal(await runtime.command({ command: 'update', args: ['--check'] }), 0);
  assert.match(output.output.stdout[0], /1\.0\.4 is available/);
  assert.deepEqual(calls, []);
});

test('native updater rejects an independently supplied release ref even with --force', async () => {
  for (const release of [
    { version: '1.0.4', tag: 'main', installSpec: 'github:B-icy/Carthagent#main' },
    { version: '1.0.4', tag: 'v1.0.3', installSpec: 'github:B-icy/Carthagent#v1.0.3' },
    { version: '1.0.4', tag: 'v1.0.4%2Fmain', installSpec: 'github:B-icy/Carthagent#v1.0.4%2Fmain' },
  ]) {
    const installs = [];
    const runtime = await createOpenCodeCliRuntime({ cwd: '/package/root', native: {
      runtime: {}, service: {}, headless: {}, packageRoot: '/package/root',
      updateApi: {
        fetchLatestRelease: async () => ({ release }),
        packageVersion: () => '1.0.4',
        compareVersions: (left, right) => left.localeCompare(right, undefined, { numeric: true }),
        detectInstallMethod: () => 'npm',
      },
      runCommand: async (...args) => { installs.push(args); return { code: 0 }; },
    } });
    await assert.rejects(runtime.command({ command: 'update', args: ['--force'] }), /does not identify a valid, version-matched/);
    assert.deepEqual(installs, []);
  }
});

test('native updater force-reinstalls only the canonical validated release tag once', async () => {
  const installs = [];
  const runtime = await createOpenCodeCliRuntime({ cwd: '/package/root', native: {
    runtime: {}, service: {}, headless: {}, packageRoot: '/package/root',
    updateApi: {
      fetchLatestRelease: async () => ({ release: { version: '1.0.4', tag: 'v1.0.4', installSpec: 'github:B-icy/Carthagent#v1.0.4' } }),
      packageVersion: () => '1.0.4',
      compareVersions: (left, right) => left.localeCompare(right, undefined, { numeric: true }),
      detectInstallMethod: () => 'npm',
    },
    runCommand: async (argv, options) => { installs.push({ argv, options }); return { code: 0, timedOut: false, cancelled: false, output: '' }; },
  } });
  assert.equal(await runtime.command({ command: 'update', args: ['--force'] }), 0);
  assert.deepEqual(installs, [{
    argv: ['npm', 'install', '-g', '--install-links=true', 'github:B-icy/Carthagent#v1.0.4'],
    options: { cwd: '/package/root', timeoutSeconds: 600 },
  }]);
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
        return { session: { id: 'ses_fixture' }, outcome: 'succeeded', terminal: true, accepted: { id: 'accepted-fixture' }, messages: [
          { type: 'user', id: 'accepted-fixture' },
          { type: 'assistant', finish: 'stop', parts: [{ type: 'text', text: 'native answer' }] },
          { type: 'idle', outcome: 'succeeded' },
        ] };
      },
    },
    clientFactory: async () => ({
      session: {
        get: async () => ({ id: 'ses_fixture', outcome: 'succeeded' }),
        context: async () => [
          { type: 'user', id: 'accepted-fixture' },
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
