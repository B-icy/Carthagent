#!/usr/bin/env node
/** Real CLI-adapter print/JSON smoke against a disposable OpenCode host/provider. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { runOpenCodeCli } from '../lib/opencode/cli.mjs';
import { createOpenCodeCliRuntime } from '../lib/opencode/cli-runtime.mjs';

const binary = process.env.CTG_OPENCODE_BIN || '/tmp/opencode/ctg-packaging/node_modules/@opencode/cli/bin/opencode.exe';
const runtimeRoot = process.env.CTG_NATIVE_RUNTIME_ROOT || '/tmp/opencode/ctg-runtime';
const pluginPath = process.env.CTG_NATIVE_PLUGIN_PATH || join(runtimeRoot, 'plugins/carthagent');
const modules = await Promise.all(['runtime.mjs', 'service.mjs', 'headless.mjs']
  .map(name => import(pathToFileURL(join(runtimeRoot, 'lib/opencode', name)).href)));
const [runtimeApi, serviceApi, headlessApi] = modules;
const temp = await mkdtemp(join(tmpdir(), 'ctg-cli-host-smoke-'));
const cwd = join(temp, 'project');
const profileRoot = join(temp, 'profile');
const configPath = join(profileRoot, 'config/opencode/opencode.json');
const requests = [];
const sessionIDs = [];
const nativeEventsCaptured = [];
const provider = createServer((req, res) => {
  void (async () => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    requests.push(body);
    const lastUser = [...(body.messages || [])].reverse().find(message => message.role === 'user');
    const responseText = `CLI fixture response for ${lastUser?.content ?? 'unknown prompt'}`;
    const needsTool = lastUser?.content?.includes('Smoke JSON') && !body.messages.some(message => message.role === 'tool');
    const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
      id: 'ctg-cli-smoke', object: 'chat.completion.chunk', created: 1, model: 'fixture',
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (needsTool) {
      res.end(`${chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'fixture-tool-call', type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: join(cwd, 'tool-fixture.txt') }) } }] })}${chunk({}, 'tool_calls')}data: [DONE]\n\n`);
    } else {
      res.write(chunk({ role: 'assistant', content: responseText }));
      res.end(`${chunk({}, 'stop')}data: [DONE]\n\n`);
    }
  })().catch(error => { res.writeHead(500); res.end(error.message); });
});
let child;
let hostOutput = '';

async function stopHost() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try { await exited; } finally { clearTimeout(timer); }
}

try {
  await Promise.all(['project', 'profile/home', 'profile/config/opencode', 'profile/data', 'profile/state', 'profile/cache']
    .map(path => mkdir(join(temp, path), { recursive: true })));
  await writeFile(join(cwd, 'tool-fixture.txt'), 'native fixture tool succeeded\n');
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  await writeFile(configPath, JSON.stringify({
    plugins: [resolve(pluginPath)], update: 'disable', model: 'ctg-fixture/fixture',
    providers: { 'ctg-fixture': {
      package: '@opencode/ai/providers/openai-compatible',
      settings: { baseURL: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: 'offline-fixture' },
      models: { fixture: { limit: { context: 32000, output: 1024 } } },
    } },
  }));
  const password = randomBytes(24).toString('hex');
  const env = {
    PATH: process.env.PATH,
    HOME: join(profileRoot, 'home'), USERPROFILE: join(profileRoot, 'home'),
    XDG_CONFIG_HOME: join(profileRoot, 'config'), XDG_DATA_HOME: join(profileRoot, 'data'),
    XDG_STATE_HOME: join(profileRoot, 'state'), XDG_CACHE_HOME: join(profileRoot, 'cache'),
    OPENCODE_DB: join(profileRoot, 'data/opencode.db'), OPENCODE_SERVER_PASSWORD: password,
  };
  child = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', '0'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((resolveUrl, reject) => {
    const timer = setTimeout(() => reject(Error(`OpenCode startup timed out: ${hostOutput}`)), 30_000);
    const collect = data => {
      hostOutput = (hostOutput + data).slice(-12000);
      const match = hostOutput.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolveUrl(match[0]); }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(Error(`OpenCode exited ${code}: ${hostOutput}`)); });
  });
  const service = {
    url,
    headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` },
    binary,
    paths: { root: profileRoot },
  };
  const native = {
    runtime: runtimeApi,
    service: { ...serviceApi, ensureService: async () => service },
    headless: { ...headlessApi, runHeadless: async (...args) => {
      const result = await headlessApi.runHeadless(...args);
      sessionIDs.push(result.session.id);
      return result;
    } },
    clientFactory: async selectedService => {
      const { OpenCode } = await import('@opencode/client');
      const client = OpenCode.make({ baseUrl: selectedService.url, headers: selectedService.headers });
      const subscribe = client.event.subscribe.bind(client.event);
      client.event.subscribe = options => ({
        async *[Symbol.asyncIterator]() {
          for await (const event of subscribe(options)) {
            nativeEventsCaptured.push(event);
            yield event;
          }
        },
      });
      return client;
    },
  };
  const capture = () => {
    const lines = [];
    return { lines, stdout: { write: text => lines.push(String(text)) }, io: { log: text => lines.push(String(text)), error: text => lines.push(`ERR:${text}`) } };
  };
  const print = capture();
  const printRuntime = await createOpenCodeCliRuntime({ cwd, native, stdout: print.stdout, io: print.io });
  const printCode = await runOpenCodeCli({ argv: ['-p', '--no-guide', '--model', 'ctg-fixture/fixture', 'Smoke print'], runtime: printRuntime, io: print.io, stdoutIsTTY: false });
  assert.equal(printCode, 0, `print run failed: ${print.lines.join('\n')}\n${hostOutput}`);
  assert.match(print.lines.join('\n'), /CLI fixture response for Smoke print/);

  const secondTurn = capture();
  const secondRuntime = await createOpenCodeCliRuntime({ cwd, native, stdout: secondTurn.stdout, io: secondTurn.io });
  const secondCode = await runOpenCodeCli({ argv: ['-p', '--no-guide', '--session', sessionIDs[0], '--model', 'ctg-fixture/fixture', 'Smoke second turn'], runtime: secondRuntime, io: secondTurn.io, stdoutIsTTY: false });
  assert.equal(secondCode, 0, `second print run failed: ${secondTurn.lines.join('\n')}\n${hostOutput}`);
  assert.match(secondTurn.lines.join('\n'), /CLI fixture response for Smoke second turn/);
  assert.doesNotMatch(secondTurn.lines.join('\n'), /CLI fixture response for Smoke print/);

  const foreignDir = join(temp, 'foreign');
  await mkdir(foreignDir);
  const { OpenCode } = await import('@opencode/client');
  const fixtureClient = OpenCode.make({ baseUrl: service.url, headers: service.headers });
  const foreign = await fixtureClient.session.create({ location: { directory: foreignDir }, title: 'Foreign workspace session', model: { providerID: 'ctg-fixture', id: 'fixture' } });
  const continued = capture();
  const continueRuntime = await createOpenCodeCliRuntime({ cwd, native, stdout: continued.stdout, io: continued.io });
  const continueCode = await runOpenCodeCli({ argv: ['-p', '-c', '--no-guide', '--model', 'ctg-fixture/fixture', 'Smoke continue in workspace'], runtime: continueRuntime, io: continued.io, stdoutIsTTY: false });
  assert.equal(continueCode, 0, `continue run failed: ${continued.lines.join('\n')}\n${hostOutput}`);
  assert.notEqual(sessionIDs.at(-1), foreign.id, 'continue must not select a session from another workspace');
  assert.equal(sessionIDs.at(-1), sessionIDs[0], 'continue must select the newest existing session in this workspace');

  const budget = capture();
  const budgetRuntime = await createOpenCodeCliRuntime({ cwd, native, stdout: budget.stdout, io: budget.io });
  const budgetCode = await runOpenCodeCli({ argv: ['-p', '--max-tools', '2', '--no-guide', 'Must reject unenforced budget'], runtime: budgetRuntime, io: budget.io, stdoutIsTTY: false });
  assert.equal(budgetCode, 1);
  assert.match(budget.lines.join('\n'), /active native delivery plugin enforces session budgets/);

  const json = capture();
  const jsonRuntime = await createOpenCodeCliRuntime({ cwd, native, stdout: json.stdout, io: json.io });
  const jsonCode = await runOpenCodeCli({ argv: ['--json', '--no-guide', '--model', 'ctg-fixture/fixture', 'Smoke JSON'], runtime: jsonRuntime, io: json.io, stdoutIsTTY: false });
  assert.equal(jsonCode, 0, `JSON run failed: ${json.lines.join('\n')}\n${hostOutput}`);
  const events = json.lines.filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  assert.ok(events.some(event => event.type === 'message_end' && event.message.role === 'assistant'));
  assert.equal(requests.length, 5, 'all admitted CLI invocations and the post-tool model turn reached the local provider');
  assert.ok(events.some(event => event.type === 'tool_execution_start' && event.toolName === 'read'));
  assert.ok(events.some(event => event.type === 'tool_execution_end' && event.toolName === 'read' && event.isError === false), JSON.stringify({ projected: events, native: nativeEventsCaptured }));
  console.log(JSON.stringify({ binary, host: '2.0.32', providerRequests: requests.length, print: 'passed', repeatedTurn: 'passed', continueWorkspaceIsolation: 'passed', jsonToolEvents: 'passed', profile: 'disposable fixture; existing service injected' }));
} catch (error) {
  console.error(hostOutput);
  throw error;
} finally {
  await stopHost();
  provider.closeAllConnections();
  if (provider.listening) await new Promise(done => provider.close(done));
  await rm(temp, { recursive: true, force: true });
}
