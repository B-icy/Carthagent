import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basename, dirname, join } from 'node:path';
import { cliHelp, openCodeCliManifest, parseOpenCodeArgs, runOpenCodeCli } from '../lib/opencode/cli.mjs';
import { createOpenCodeCliRuntime as createRuntime, headlessSucceeded, latestSessionForWorkspace, modelWithThinking, nativeJsonEvents, reconcileHeadlessResult, textParts } from '../lib/opencode/cli-runtime.mjs';

// These are offline fixtures, including when they simulate an interactive TTY.
// Never let a fixture URL reach the user's operating-system browser launcher.
const createOpenCodeCliRuntime = options => createRuntime({ openBrowserImpl: async () => false, ...options });
import { runNativeUpdate } from '../lib/opencode/update.mjs';

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

test('native bash-cap requires session-option enforcement and is sent in per-session metadata', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const cwd = mkdtempSync(join(tmpdir(), 'ctg-bash-cap-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  let saved;
  const runtime = await createOpenCodeCliRuntime({ cwd, stdout: { write() {} }, native: {
    runtime: {}, service: { ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }) },
    rpcDefinitions: { Carthagent: {} },
    headless: { runHeadless: async (_service, _cwd, _prompt, options) => {
      saved = options.session.metadata['carthagent.options'];
      return { session: { id: 'ses_bash_cap' }, outcome: 'succeeded', terminal: true, accepted: { id: 'a' }, messages: [
        { type: 'user', id: 'a' }, { type: 'assistant', finish: 'stop', parts: [{ type: 'text', text: 'ok' }] }, { type: 'idle', outcome: 'succeeded' },
      ] };
    } },
    clientFactory: async () => ({ rpc: () => ({ health: async () => ({ capabilities: ['delivery.session-options.v1'] }) }), session: {
      get: async () => ({ id: 'ses_bash_cap', outcome: 'succeeded' }),
      context: async () => [{ type: 'user', id: 'a' }, { type: 'assistant', finish: 'stop' }, { type: 'idle', outcome: 'succeeded' }],
    } }),
  } });
  assert.equal(await runtime.run({ mode: 'headless', options: { prompt: 'task', bashCap: '12.5', protectExisting: true, rewriteCap: '2', toolOutputCap: '4000', turnDelayMs: '50', jev: false, jevProvider: 'ship' }, prompt: 'task' }), 0);
  assert.equal(saved.bashCap, 12.5);
  assert.deepEqual({ protectExisting: saved.protectExisting, rewriteCap: saved.rewriteCap, toolOutputCap: saved.toolOutputCap, turnDelayMs: saved.turnDelayMs, jev: saved.jev, jevProvider: saved.jevProvider }, { protectExisting: true, rewriteCap: 2, toolOutputCap: 4000, turnDelayMs: 50, jev: false, jevProvider: 'ship' });
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

test('no-prompt interactive launch persists review, bash cap, and budget options for new and resumed sessions', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const cwd = mkdtempSync(join(tmpdir(), 'ctg-interactive-options-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const expected = { maxTools: 7, bashCap: 2.5, review: 'yes' };
  const capabilities = ['delivery.session-options.v1', 'delivery.budgets.v1'];

  for (const resumed of [false, true]) {
    const calls = [];
    const sessionID = resumed ? 'ses_existing' : 'ses_created';
    const runtime = await createOpenCodeCliRuntime({ cwd, stdout: { write() {} }, native: {
      runtime: {},
      service: { ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }), launchTui: (_service, _cwd, options) => {
        calls.push(['launch', options.sessionID]);
        return { once(event, callback) { if (event === 'exit') queueMicrotask(() => callback(0)); return this; }, kill() {} };
      } },
      headless: { createSession: async (_service, _cwd, { body }) => {
        calls.push(['create', body.metadata['carthagent.options']]);
        return { id: sessionID };
      } },
      rpcDefinitions: { Carthagent: {} },
      clientFactory: async () => ({
        rpc: () => ({ health: async () => ({ capabilities }) }),
        session: {
          get: async () => ({ id: sessionID, location: { directory: cwd }, metadata: { keep: 'yes', 'carthagent.options': { workflow: 'strict' } } }),
          update: async input => calls.push(['update', input.metadata]),
        },
      }),
    } });
    const options = { ...(resumed ? { session: sessionID } : {}), review: 'yes', bashCap: '2.5', maxTools: '7' };
    assert.equal(await runtime.run({ mode: 'interactive', options, prompt: '' }), 0);
    if (resumed) {
      assert.deepEqual(calls[0], ['update', { keep: 'yes', 'carthagent.options': { workflow: 'strict', ...expected } }]);
      assert.deepEqual(calls[1], ['launch', sessionID]);
    } else {
      assert.deepEqual(calls[0], ['create', expected]);
      assert.deepEqual(calls[1], ['launch', sessionID]);
    }
  }
});

test('no-prompt interactive explicit model and thinking selection applies to fresh and resumed sessions before TUI launch', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const cwd = mkdtempSync(join(tmpdir(), 'ctg-interactive-model-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const expectedModel = { providerID: 'fixture', id: 'explicit-model', variant: 'high' };

  for (const resumed of [false, true]) {
    const calls = [];
    const sessionID = resumed ? 'ses_model_existing' : 'ses_model_created';
    const runtime = await createOpenCodeCliRuntime({ cwd, stdout: { write() {} }, native: {
      runtime: {},
      service: {
        ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }),
        launchTui: (_service, _cwd, options) => {
          calls.push(['launch', options.sessionID]);
          return { once(event, callback) { if (event === 'exit') queueMicrotask(() => callback(0)); return this; }, kill() {} };
        },
      },
      headless: { createSession: async (_service, _cwd, { body }) => {
        calls.push(['create', body.model]);
        return { id: sessionID };
      } },
      clientFactory: async () => ({ rpc: () => ({ health: async () => ({ capabilities: ['delivery.session-options.v1', 'delivery.budgets.v1'] }) }), session: {
        switchModel: async input => calls.push(['switchModel', input]),
        get: async () => ({ id: sessionID, location: { directory: cwd }, metadata: {} }),
      } }),
    } });

    assert.equal(await runtime.run({
      mode: 'interactive',
      options: { ...(resumed ? { session: sessionID } : {}), provider: 'fixture', model: 'explicit-model', thinking: 'high' },
      prompt: '',
    }), 0);
    if (resumed) {
      assert.deepEqual(calls, [['switchModel', { sessionID, model: expectedModel }], ['launch', sessionID]]);
    } else {
      assert.deepEqual(calls, [['create', expectedModel], ['launch', sessionID]]);
    }
  }
});

test('resumed interactive model selection verifies workspace ownership before any session mutation or launch', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const cwd = mkdtempSync(join(tmpdir(), 'ctg-foreign-model-session-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const calls = [];
  const runtime = await createOpenCodeCliRuntime({ cwd, stdout: { write() {} }, native: {
    runtime: {},
    service: {
      ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }),
      launchTui: () => { calls.push('launch'); return { once() { return this; }, kill() {} }; },
    },
    headless: {},
    clientFactory: async () => ({ rpc: () => ({ health: async () => ({ capabilities: ['delivery.session-options.v1', 'delivery.budgets.v1'] }) }), session: {
      get: async input => { calls.push(['get', input.sessionID]); return { id: input.sessionID, location: { directory: join(cwd, 'another-workspace') }, metadata: {} }; },
      switchModel: async () => calls.push('switchModel'),
      update: async () => calls.push('update'),
    } }),
  } });
  await assert.rejects(runtime.run({
    mode: 'interactive', options: { session: 'ses_foreign', model: 'fixture/explicit-model', maxTools: '3' }, prompt: '',
  }), /another workspace/);
  assert.deepEqual(calls, [['get', 'ses_foreign']], 'ownership is checked before switching models, updating metadata, or launching TUI');
});

test('interactive provider or thinking flags without a model fail instead of being silently ignored', async () => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'ctg-model-flags-no-default-'));
  try {
    const config = join(root, 'config.json');
    writeFileSync(config, '{}');
    const previousConfig = process.env.CARTHAGENT_CONFIG;
    process.env.CARTHAGENT_CONFIG = config;
    try {
      for (const options of [{ provider: 'fixture' }, { thinking: 'high' }]) {
        let touched = false;
        const runtime = await createOpenCodeCliRuntime({ cwd: '/work/project', native: {
          runtime: {}, service: { ensureService: async () => { touched = true; return {}; } }, headless: {},
        } });
        await assert.rejects(runtime.run({ mode: 'interactive', options, prompt: '' }), /require --model/);
        assert.equal(touched, false);
      }
    } finally {
      if (previousConfig === undefined) delete process.env.CARTHAGENT_CONFIG;
      else process.env.CARTHAGENT_CONFIG = previousConfig;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('interactive thinking-only selection resolves the configured default model and applies its variant', async t => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const cwd = mkdtempSync(join(tmpdir(), 'ctg-thinking-default-model-'));
  const config = join(cwd, 'config.json');
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFileSync(config, JSON.stringify({ model: 'configured-provider/configured-model' }));
  const previousConfig = process.env.CARTHAGENT_CONFIG;
  process.env.CARTHAGENT_CONFIG = config;
  let createdModel;
  try {
    const runtime = await createOpenCodeCliRuntime({ cwd, stdout: { write() {} }, native: {
      runtime: {},
      service: {
        ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }),
        launchTui: (_service, _cwd, options) => { assert.equal(options.sessionID, 'ses_default_thinking'); return { once(event, callback) { if (event === 'exit') queueMicrotask(() => callback(0)); return this; }, kill() {} }; },
      },
      headless: { createSession: async (_service, _cwd, { body }) => { createdModel = body.model; return { id: 'ses_default_thinking' }; } },
      clientFactory: async () => ({ session: {} }),
    } });
    assert.equal(await runtime.run({ mode: 'interactive', options: { thinking: 'high' }, prompt: '' }), 0);
    assert.deepEqual(createdModel, { providerID: 'configured-provider', id: 'configured-model', variant: 'high' });
  } finally {
    if (previousConfig === undefined) delete process.env.CARTHAGENT_CONFIG;
    else process.env.CARTHAGENT_CONFIG = previousConfig;
  }
});

test('qualified model with explicit provider uses the provider override and unqualified model ID', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const cwd = mkdtempSync(join(tmpdir(), 'ctg-provider-model-override-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  let createdModel;
  const runtime = await createOpenCodeCliRuntime({ cwd, stdout: { write() {} }, native: {
    runtime: {},
    service: {
      ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }),
      launchTui: (_service, _cwd, options) => { assert.equal(options.sessionID, 'ses_provider_override'); return { once(event, callback) { if (event === 'exit') queueMicrotask(() => callback(0)); return this; }, kill() {} }; },
    },
    headless: { createSession: async (_service, _cwd, { body }) => { createdModel = body.model; return { id: 'ses_provider_override' }; } },
    clientFactory: async () => ({ session: {} }),
  } });
  assert.equal(await runtime.run({ mode: 'interactive', options: { provider: 'override-provider', model: 'original-provider/model-id' }, prompt: '' }), 0);
  assert.deepEqual(createdModel, { providerID: 'override-provider', id: 'model-id' });
});

test('resumed interactive validator launch merges required checks with existing session metadata before prompting', async t => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const cwd = mkdtempSync(join(tmpdir(), 'ctg-resumed-validators-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const manifest = join(cwd, 'validators.json');
  writeFileSync(manifest, JSON.stringify({ version: 1, checks: [{ id: 'unit', kind: 'test', argv: ['node', '--test'], timeoutSeconds: 20 }] }));
  const originalMetadata = {
    external: { owner: 'fixture', preserve: true },
    'carthagent.options': { guide: false, maxTools: 9 },
    'carthagent.other': { retained: true },
  };
  const updates = [];
  const calls = [];
  const sessionID = 'ses_validator_resume';
  const runtime = await createOpenCodeCliRuntime({ cwd, stdout: { write() {} }, native: {
    runtime: {},
    service: {
      ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }),
      launchTui: (_service, _cwd, options) => {
        calls.push(['launch', options.sessionID]);
        return { once(event, callback) { if (event === 'exit') queueMicrotask(() => callback(0)); return this; }, kill() {} };
      },
    },
    headless: { promptSession: async (_service, id, text, options) => calls.push(['prompt', id, text, options?.body]) },
    rpcDefinitions: { Carthagent: {}, SessionControls: {} },
    clientFactory: async () => ({
      rpc: () => ({ health: async () => ({ capabilities: ['delivery.session-options.v1'] }), framing: async input => calls.push(['framing', input]) }),
      session: {
        get: async () => ({ id: sessionID, location: { directory: cwd }, metadata: originalMetadata }),
        update: async input => updates.push(input),
      },
    }),
  } });
  assert.equal(await runtime.run({
    mode: 'interactive', options: { session: sessionID, validators: 'validators.json' }, prompt: 'continue with the required checks',
  }), 0);

  assert.equal(updates.length, 1, 'persist required checks and launcher options in one merge update');
  assert.equal(updates[0].sessionID, sessionID);
  assert.deepEqual(updates[0].metadata.external, originalMetadata.external);
  assert.deepEqual(updates[0].metadata['carthagent.other'], originalMetadata['carthagent.other']);
  assert.deepEqual(updates[0].metadata['carthagent.options'], { guide: false, maxTools: 9, validators: manifest });
  assert.deepEqual(updates[0].metadata['carthagent.requiredChecks'], [{ id: 'required_unit', kind: 'test', argv: ['node', '--test'], timeoutSeconds: 20 }]);
  assert.deepEqual(calls.map(call => call[0]), ['prompt', 'prompt', 'launch']);
  assert.match(calls[0][2], /Required user-owned validators/);
  assert.equal(calls[2][1], sessionID);
});

test('native --isolate starts a clean CTG profile without inheriting the regular profile or creating a worktree', async () => {
  const calls = [];
  const runtime = await createOpenCodeCliRuntime({ cwd: '/work/project', stdout: { write() {} }, native: {
    runtime: {
      runtimePaths: options => ({ root: options.root ?? '/private/profile' }),
    },
    service: {
      ensureService: async options => { calls.push(options); return { url: 'http://127.0.0.1:1', headers: {}, paths: { root: options.root } }; },
      stopService: async options => { calls.push({ stopRoot: options.root }); return true; },
      launchTui: (_service, workspace, options) => {
        calls.push({ workspace, options });
        return { once(event, callback) { if (event === 'exit') queueMicrotask(() => callback(0)); return this; }, kill() {} };
      },
    },
    headless: {},
    clientFactory: async () => ({ session: { create: async () => ({ id: 'ses_isolated' }) } }),
  } });
  assert.equal(await runtime.run({ mode: 'interactive', options: { isolate: true }, prompt: '' }), 0);
  assert.equal(dirname(calls[0].root), join('/private/profile', 'isolated'));
  assert.match(basename(calls[0].root), /^[0-9a-f-]+$/);
  assert.equal(calls[0].isolate, true);
  assert.match(calls[0].pluginPath, /plugins[\\/]carthagent$/);
  assert.equal(calls[1].workspace, '/work/project');
  assert.deepEqual(calls[2], { stopRoot: calls[0].root });
});

test('headless review modes are transported without inventing an unsupported interactive-only error', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const cwd = mkdtempSync(join(tmpdir(), 'ctg-review-headless-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  for (const review of ['ask', 'yes', 'no']) {
    let captured;
    const runtime = await createOpenCodeCliRuntime({ cwd, stdout: { write() {} }, io: { error() {}, log() {} }, native: {
      runtime: {}, service: { ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }) },
      headless: { runHeadless: async (_service, _cwd, _prompt, options) => {
        captured = options.session.metadata['carthagent.options'];
        return { session: { id: `ses_${review}`, outcome: 'succeeded' }, messages: [{ role: 'assistant', content: [{ type: 'text', text: 'done' }], finish: 'stop' }], outcome: 'succeeded', terminal: true };
      } },
      rpcDefinitions: { Carthagent: {} },
      clientFactory: async () => ({
        rpc: () => ({ health: async () => ({ capabilities: ['delivery.session-options.v1'] }) }),
      }),
    } });
    assert.equal(await runtime.run({ mode: 'headless', options: { review, prompt: 'task' }, prompt: 'task' }), 0);
    assert.equal(captured.review, review);
  }
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
  const opened = [];
  const service = { url: 'http://127.0.0.1:1', headers: {} };
  const integration = {
    id: 'experiential-labs', name: 'Carthagent Ship',
    methods: [{ id: 'carthagent-device', type: 'oauth', label: 'Sign in with Carthagent Ship' }],
  };
  const runtime = await createOpenCodeCliRuntime({ cwd: '/project', io: ioCapture().io, stdin: { isTTY: true }, stdout: { isTTY: true }, openBrowserImpl: async url => { opened.push(url); return true; }, native: {
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
  assert.deepEqual(opened, ['https://auth.example/device']);
  assert.deepEqual(calls.map(([name]) => name), ['list', 'connect', 'status']);
  assert.equal(calls[1][1].methodID, 'carthagent-device');
  assert.deepEqual(calls[1][1].location, { directory: '/project' });
});

test('native login cancellation maps to 130 and attempts to cancel the pending host flow', async () => {
  const calls = [];
  const lines = [];
  let statusReady;
  const ready = new Promise(resolve => { statusReady = resolve; });
  const runtime = await createOpenCodeCliRuntime({ cwd: '/project', io: { log: text => lines.push(text), error: text => lines.push(text) }, stdin: { isTTY: true }, stdout: { isTTY: true }, native: {
    runtime: {}, service: { ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }) }, headless: {},
    clientFactory: async () => ({ integration: {
      list: async () => ({ data: [{ id: 'anthropic', name: 'Provider', methods: [{ id: 'device', type: 'oauth', label: 'Device' }] }] }),
      oauth: {
        connect: async () => ({ data: { attemptID: 'attempt-cancel', url: 'https://auth.example', instructions: 'Approve', mode: 'auto', time: { expires: Date.now() + 60_000 } } }),
        status: async (_input, { signal }) => new Promise((_resolve, reject) => {
          const onAbort = () => reject(signal.reason);
          signal.addEventListener('abort', onAbort, { once: true });
          calls.push('status-listener-ready');
          statusReady();
        }),
        cancel: async input => { calls.push(input.attemptID); },
      },
    } }),
  } });
  const running = runOpenCodeCli({ argv: ['login'], runtime, io: { log: text => lines.push(text), error: text => lines.push(text) }, stdoutIsTTY: true });
  await ready;
  process.emit('SIGINT');
  assert.equal(await running, 130, lines.join('\n'));
  assert.deepEqual(calls, ['status-listener-ready', 'attempt-cancel']);
});

test('native login honors an already-delivered SIGINT without starting an authentication RPC', async () => {
  const calls = [];
  const runtime = await createOpenCodeCliRuntime({ cwd: '/project', io: ioCapture().io, stdin: { isTTY: true }, stdout: { isTTY: true }, native: {
    runtime: {}, service: { ensureService: async () => { process.emit('SIGINT'); return { url: 'http://127.0.0.1:1', headers: {} }; } }, headless: {},
    clientFactory: async () => ({ integration: {
      list: async () => ({ data: [{ id: 'anthropic', name: 'Provider', methods: [{ id: 'device', type: 'oauth', label: 'Device' }] }] }),
      oauth: {
        connect: async () => { calls.push('connect'); throw new Error('must not connect'); },
        status: async () => { calls.push('status'); },
        cancel: async () => { calls.push('cancel'); },
      },
    } }),
  } });
  assert.equal(await runOpenCodeCli({ argv: ['login'], runtime, io: ioCapture().io, stdoutIsTTY: true }), 130);
  assert.deepEqual(calls, []);
});

test('native login cancels an OAuth attempt returned after SIGINT during connect', async () => {
  const calls = [];
  let connectReady;
  let finishConnect;
  const connectEntered = new Promise(resolve => { connectReady = resolve; });
  const connectResponse = new Promise(resolve => { finishConnect = resolve; });
  const runtime = await createOpenCodeCliRuntime({ cwd: '/project', io: ioCapture().io, stdin: { isTTY: true }, stdout: { isTTY: true }, native: {
    runtime: {}, service: { ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }) }, headless: {},
    clientFactory: async () => ({ integration: {
      list: async () => ({ data: [{ id: 'anthropic', name: 'Provider', methods: [{ id: 'oauth', type: 'oauth', label: 'OAuth' }] }] }),
      oauth: {
        connect: async () => { calls.push('connect'); connectReady(); return connectResponse; },
        status: async () => { calls.push('status'); return { data: { status: 'pending' } }; },
        cancel: async input => { calls.push(['cancel', input.attemptID]); },
      },
    } }),
  } });
  const running = runOpenCodeCli({ argv: ['login'], runtime, io: ioCapture().io, stdoutIsTTY: true });
  await connectEntered;
  process.emit('SIGINT');
  finishConnect({ data: { attemptID: 'attempt-connect-race', url: 'https://auth.example', instructions: 'Approve', mode: 'auto', time: { expires: Date.now() + 60_000 } } });
  assert.equal(await running, 130);
  assert.deepEqual(calls, ['connect', ['cancel', 'attempt-connect-race']]);
});

test('native login abort closes an in-flight ordinary OAuth form prompt', async () => {
  const { EventEmitter } = await import('node:events');
  const input = Object.assign(new EventEmitter(), { isTTY: true });
  let promptClosed = false;
  let promptReady;
  const ready = new Promise(resolve => { promptReady = resolve; });
  const runtime = await createOpenCodeCliRuntime({ cwd: '/project', io: ioCapture().io, stdin: input, stdout: { isTTY: true }, readlineFactory: () => ({
    question: () => { promptReady(); return new Promise(() => {}); },
    close: () => { promptClosed = true; },
  }), native: {
    runtime: {}, service: { ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }) }, headless: {},
    clientFactory: async () => ({ integration: {
      list: async () => ({ data: [{ id: 'anthropic', name: 'Provider', methods: [{ id: 'oauth', type: 'oauth', label: 'OAuth', form: [{ key: 'tenant', type: 'string', title: 'Tenant', required: true }] }] }] }),
      oauth: {
        connect: async () => { throw Error('connect must not run'); },
        status: async () => ({ data: { status: 'pending' } }),
        cancel: async () => {},
      },
    } }),
  } });
  const running = runOpenCodeCli({ argv: ['login'], runtime, io: ioCapture().io, stdoutIsTTY: true });
  await ready;
  process.emit('SIGINT');
  assert.equal(await running, 130);
  assert.equal(promptClosed, true);
});

test('native CLI resolves glyph mode for the host transport while preserving --ascii precedence', async () => {
  const calls = [];
  const runtime = await createOpenCodeCliRuntime({ cwd: '/project', io: ioCapture().io, native: {
    runtime: {}, service: { ensureService: async () => { calls.push('ensure'); return {}; }, launchTui: (_service, _cwd, options) => { calls.push(options.glyphs); return { once(event, callback) { if (event === 'exit') queueMicrotask(() => callback(0)); return this; }, kill() {} }; } }, headless: {},
    clientFactory: async () => ({ integration: {} }),
  } });
  const capture = ioCapture();
  assert.equal(await runOpenCodeCli({ argv: ['--ascii'], runtime, io: capture.io, stdoutIsTTY: true }), 0);
  assert.deepEqual(calls, ['ensure', 'ascii']);
});

test('native API-key login masks secrets; OAuth form input is masked and hidden fields retain defaults', async () => {
  const calls = [];
  const keyCalls = [];
  const keyInput = Object.assign(new (await import('node:events')).EventEmitter(), { isTTY: true, isRaw: false, setRawMode(value) { this.isRaw = value; }, resume() {} });
  const keyDisplayed = [];
  const keyRuntime = await createOpenCodeCliRuntime({ cwd: '/project', io: ioCapture().io, stdin: keyInput, stdout: { isTTY: true, write: value => keyDisplayed.push(String(value)) }, native: {
    runtime: {}, service: { ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }) }, headless: {},
    clientFactory: async () => ({ integration: {
      list: async () => ({ data: [{ id: 'anthropic', name: 'Key Provider', methods: [{ id: 'api-key', type: 'key', label: 'API key' }] }] }),
      connect: { key: async input => keyCalls.push(input) },
    } }),
  } });
  const keyLogin = keyRuntime.login({ args: ['anthropic', 'key'] });
  await new Promise(resolve => setTimeout(resolve, 0));
  keyInput.emit('data', 'fake-test-api-key\r');
  assert.equal(await keyLogin, 0);
  assert.equal(keyCalls[0].key, 'fake-test-api-key');
  assert.ok(keyDisplayed.join('').includes('*'));
  assert.ok(!keyDisplayed.join('').includes('fake-test-api-key'));

  const displayed = [];
  const fakeInput = Object.assign(new (await import('node:events')).EventEmitter(), { isTTY: true, isRaw: false, setRawMode(value) { this.isRaw = value; }, resume() {} });
  const fakeOutput = { isTTY: true, write: value => displayed.push(String(value)) };
  const oauthRuntime = await createOpenCodeCliRuntime({ cwd: '/project', io: ioCapture().io, stdin: fakeInput, stdout: fakeOutput, native: {
    runtime: {}, service: { ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }) }, headless: {},
    clientFactory: async () => ({ integration: {
      list: async () => ({ data: [{ id: 'anthropic', name: 'OAuth Provider', methods: [{
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
  const login = oauthRuntime.login({ args: ['anthropic'] });
  await new Promise(resolve => setTimeout(resolve, 0));
  fakeInput.emit('data', 'sensitive-value\r');
  await login;
  assert.deepEqual(calls[0], { client_secret: 'sensitive-value', scope: 'default-scope' });
  assert.ok(displayed.join('').includes('**************'));
  assert.ok(!displayed.join('').includes('sensitive-value'));
});

test('invalid native review arguments fail with usage before touching workspace files or OpenCode', async () => {
  let touched = false;
  const runtime = await createOpenCodeCliRuntime({ cwd: '/definitely/not/a/workspace', io: ioCapture().io, native: {
    runtime: {}, service: { ensureService: async () => { touched = true; throw new Error('service must not start'); } }, headless: {},
    runCommand: async () => { touched = true; throw new Error('commands must not run'); },
  } });
  for (const args of [['bogus'], ['0'], ['-1'], ['123extra'], ['https://example.com/pull/3'], ['workspace', 'extra'], ['--timeout', '0', '12']]) {
    const capture = ioCapture();
    const code = await runtime.review({ args }).catch(error => { capture.io.error(error.message); return error.exitCode ?? 1; });
    assert.equal(code, 2, `args=${args.join(' ')}`);
    assert.match(capture.output.stderr.join('\n'), /review|Review|Invalid|Use/);
  }
  assert.equal(touched, false);
});

test('native workspace review preserves raw metadata and returns usage exit codes for invalid structured outcomes', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const cwd = mkdtempSync(join(tmpdir(), 'ctg-cli-review-contract-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd });
  execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd });
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(cwd, 'source.txt'), 'base\n');
  writeFileSync(join(cwd, 'task.txt'), 'Make the requested change safely.\n');
  execFileSync('git', ['add', '.'], { cwd });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd });
  writeFileSync(join(cwd, 'source.txt'), 'changed\n');
  let mode = 'missing';
  const runtime = await createOpenCodeCliRuntime({ cwd, native: {
    runtime: {}, service: { ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }) }, headless: {},
    clientFactory: async () => ({
      location: { get: async () => ({}) },
      model: { list: async () => ({ data: [] }) },
      agent: { list: async () => ({ data: [{ id: 'build' }] }) },
      session: {
        create: async input => { globalThis.fixtureReviewer = { permissions: input.permissions }; return { id: 'reviewer' }; },
        prompt: async input => { globalThis.fixtureReviewer = { ...globalThis.fixtureReviewer, prompt: input }; },
        wait: async () => {},
        get: async () => ({ outcome: 'succeeded' }),
        context: async () => {
          const prompt = globalThis.fixtureReviewer.prompt.text;
          const head = prompt.match(/HEAD: ([a-f0-9]+)/)?.[1];
          const snapshot = prompt.match(/Snapshot SHA-256: ([a-f0-9]+)/)?.[1];
          if (mode === 'missing') return [{ type: 'assistant', finish: 'stop', content: [{ type: 'text', text: 'VERDICT: APPROVE' }] }, { type: 'idle', outcome: 'succeeded' }];
          return [{ type: 'assistant', finish: 'stop', content: [{ type: 'text', text: `REVIEW_JSON: ${JSON.stringify({ version: 1, snapshot, head, findings: [] })}\nVERDICT: APPROVE` }] }, { type: 'idle', outcome: 'succeeded' }];
        },
      },
    }),
  } });
  await assert.rejects(runtime.review({ args: ['bogus'] }), { exitCode: 2 });
  const reviewArgs = ['workspace', '--request-file', 'task.txt'];
  const error = await runtime.review({ args: reviewArgs }).then(() => null, value => value);
  assert.equal(error.exitCode, 2);
  mode = 'valid';
  assert.deepEqual(globalThis.fixtureReviewer.prompt.metadata, { 'ctg.raw': true });
  const result = await runtime.review({ args: reviewArgs });
  assert.equal(result, 0);
  delete globalThis.fixtureReviewer;
});

test('native Ship billing and logout explain how to connect when the typed auth error is returned', async () => {
  const runtime = await createOpenCodeCliRuntime({ cwd: '/project', io: ioCapture().io, native: {
    runtime: {}, service: { ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }) }, headless: {},
    clientFactory: async () => ({ rpc: () => ({
      shipBilling: async () => { throw Object.assign(new Error('Not authenticated'), { type: 'ship.unauthenticated' }); },
      shipLogout: async () => { throw Object.assign(new Error('Not authenticated'), { type: 'ship.unauthenticated' }); },
    }) }),
  } });
  await assert.rejects(runtime.billing({ action: 'checkout' }), /not connected.*ctg login.*Carthagent Ship/i);
  await assert.rejects(runtime.logout({}), /not connected.*ctg login.*Carthagent Ship/i);
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
      list: async () => ({ data: [{ id: 'anthropic', name: 'Forms', methods: [{ id: 'oauth', type: 'oauth', label: 'OAuth', form: [
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
  await injectedRuntime.login({ args: ['anthropic'] });
  assert.deepEqual(calls[0], { mode: 'standard', count: 4, enabled: true, features: ['alpha', 'beta'] });
  assert.equal(promptIndex, 4);
});

test('OAuth optional boolean fields keep their native default when left blank', async () => {
  const calls = [];
  const output = ioCapture();
  const runtime = await createOpenCodeCliRuntime({ cwd: '/project', io: output.io, stdin: { isTTY: true }, stdout: { isTTY: true, write() {} }, readlineFactory: () => ({ close() {}, question: async () => '' }), native: {
    runtime: {}, service: { ensureService: async () => ({ url: 'http://127.0.0.1:1', headers: {} }) }, headless: {},
    clientFactory: async () => ({ integration: {
      list: async () => ({ data: [{ id: 'anthropic', name: 'Boolean', methods: [{ id: 'oauth', type: 'oauth', label: 'OAuth', form: [{ key: 'enabled', type: 'boolean', default: true }] }] }] }),
      oauth: {
        connect: async input => { calls.push(input.answer); return { data: { attemptID: 'anthropic', mode: 'auto', url: 'https://auth.example', instructions: 'approve', time: { expires: Date.now() + 1000 } } }; },
        status: async () => ({ data: { status: 'complete' } }),
      },
    } }),
  } });
  await runtime.login({ args: ['anthropic'] });
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

test('native update prefers the exact published registry package', async () => {
  const calls = [];
  const runtime = await createOpenCodeCliRuntime({ cwd: '/demo/workspace', native: {
    runtime: {}, service: { ensureService: async () => { throw new Error('demo must not launch the native service'); } }, headless: {},
    updateApi: {
      fetchLatestRelease: async () => ({ release: { version: '1.0.4', tag: 'v1.0.4', minNode: '18.0.0', installSpec: 'github:B-icy/Carthagent#v1.0.4' } }),
      packageVersion: () => '1.0.3',
      detectInstallMethod: () => 'npm',
    },
    packageRoot: '/package/root',
    updateModule: { runNativeUpdate },
    runCommand: async (argv, options) => { calls.push({ argv, options }); return { code: 0, timedOut: false, cancelled: false, output: '' }; },
  } });
  assert.equal(await runtime.command({ command: 'update', args: [] }), 0);
  const npmPrefix = process.platform === 'win32' ? ['cmd.exe', '/d', '/s', '/c', 'npm'] : ['npm'];
  assert.deepEqual(calls, [{
    argv: [...npmPrefix, 'view', 'carthagent@1.0.4', 'version', '--json'],
    options: { cwd: '/package/root', timeoutSeconds: 10 },
  }, {
    argv: [...npmPrefix, 'install', '-g', '--install-links=true', 'carthagent@1.0.4'],
    options: { cwd: '/package/root', timeoutSeconds: 600 },
  }]);
});
test('native update check reports an available release without invoking the installer', async () => {
  const calls = [];
  const output = ioCapture();
  const runtime = await createOpenCodeCliRuntime({ cwd: '/package/root', io: output.io, native: {
    runtime: {}, service: {}, headless: {},
    updateApi: {
      fetchLatestRelease: async () => ({ release: { version: '1.0.4', tag: 'v1.0.4', minNode: '18.0.0', installSpec: 'github:B-icy/Carthagent#v1.0.4' } }),
      packageVersion: () => '1.0.3', detectInstallMethod: () => 'npm',
    },
    updateModule: { runNativeUpdate },
    runCommand: async (...args) => { calls.push(args); return { code: 0 }; },
  } });
  assert.equal(await runtime.command({ command: 'update', args: ['--check'] }), 0);
  assert.match(output.output.stdout[0], /1\.0\.4 is available/);
  assert.deepEqual(calls, []);
});

test('native updater force-reinstalls only the canonical validated release tag once', async () => {
  const installs = [];
  const runtime = await createOpenCodeCliRuntime({ cwd: '/package/root', native: {
    runtime: {}, service: {}, headless: {}, packageRoot: '/package/root',
    updateApi: {
      fetchLatestRelease: async () => ({ release: { version: '1.0.4', tag: 'v1.0.4', installSpec: 'github:B-icy/Carthagent#v1.0.4' } }),
      packageVersion: () => '1.0.4',
      detectInstallMethod: () => 'npm',
    },
    updateModule: { runNativeUpdate },
    runCommand: async (argv, options) => { installs.push({ argv, options }); return { code: 0, timedOut: false, cancelled: false, output: '' }; },
  } });
  assert.equal(await runtime.command({ command: 'update', args: ['--force'] }), 0);
  const npmPrefix = process.platform === 'win32' ? ['cmd.exe', '/d', '/s', '/c', 'npm'] : ['npm'];
  assert.deepEqual(installs, [{
    argv: [...npmPrefix, 'view', 'carthagent@1.0.4', 'version', '--json'],
    options: { cwd: '/package/root', timeoutSeconds: 10 },
  }, {
    argv: [...npmPrefix, 'install', '-g', '--install-links=true', 'carthagent@1.0.4'],
    options: { cwd: '/package/root', timeoutSeconds: 600 },
  }]);
});

test('native serve child does not inherit runtime download tokens', async t => {
  const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const runtimeRoot = mkdtempSync(join(tmpdir(), 'ctg-serve-env-'));
  t.after(() => rmSync(runtimeRoot, { recursive: true, force: true }));
  const resultFile = join(runtimeRoot, 'result.json');
  writeFileSync(join(runtimeRoot, 'server.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({ workspace: process.env.CARTHAGENT_WORKSPACE, other: process.env.CTG_RUNTIME_OTHER, tokens: Object.keys(process.env).filter(key => key.toUpperCase() === 'CTG_RUNTIME_GITHUB_TOKEN') }));`);
  const previous = Object.fromEntries(['CTG_RUNTIME_GITHUB_TOKEN', 'ctg_runtime_github_token', 'Ctg_Runtime_Github_Token', 'CTG_RUNTIME_OTHER'].map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    CTG_RUNTIME_GITHUB_TOKEN: 'fake-uppercase-token',
    ctg_runtime_github_token: 'fake-lowercase-token',
    Ctg_Runtime_Github_Token: 'fake-mixedcase-token',
    CTG_RUNTIME_OTHER: 'preserve-this-value',
  });
  try {
    const runtime = await createOpenCodeCliRuntime({ cwd: '/workspace/fixture', native: { runtime: {}, service: {}, headless: {}, runtimeRoot } });
    assert.equal(await runtime.command({ command: 'serve', args: [] }), 0);
    assert.deepEqual(JSON.parse(readFileSync(resultFile, 'utf8')), {
      workspace: '/workspace/fixture', other: 'preserve-this-value', tokens: [],
    });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
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
  assert.match(output.at(-1), /Claude \/ Anthropic\s+claude-fixture\s+100\s+10/);
  assert.equal(await runtime.run({ mode: 'interactive', options: {}, prompt: undefined }), 0);
  assert.ok(events.some(entry => entry[0] === 'service'));
  assert.ok(events.some(entry => entry[0] === 'headless' && entry[3] === 'Do a task'));
  assert.ok(events.some(entry => entry[0] === 'tui' && entry[2] === cwd));
  assert.equal(resolve(cwd), cwd);
});
