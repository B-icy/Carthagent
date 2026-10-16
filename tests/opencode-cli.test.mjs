import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cliHelp, openCodeCliManifest, parseOpenCodeArgs, runOpenCodeCli } from '../lib/opencode/cli.mjs';

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
