/** Offline OpenAI-compatible SSE fixture used by the real OpenCode host test. */
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { OpenCode } from '@opencode/client';
import { resolveOpenCode } from '../lib/opencode/runtime.mjs';

const root = resolve(import.meta.dirname, '..');

export function createNativeFixture({ respond, inspect } = {}) {
  let calls = 0;
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    calls++;
    const parsed = body ? JSON.parse(body) : {};
    inspect?.({ request, body: parsed, call: calls });
    if (!parsed.stream) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'stream=true required' } }));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' });
    response.flushHeaders();
    await respond?.({ request, body: parsed, call: calls, response });
    response.end('data: [DONE]\n\n');
  });
  return {
    server,
    get calls() { return calls; },
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve(`http://127.0.0.1:${server.address().port}/v1`);
      });
    }),
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

export function toolCall(response, { id = 'fixture-call', name, arguments: input }) {
  response.write(`data: ${JSON.stringify({
    id: 'fixture-response', object: 'chat.completion.chunk', created: 1, model: 'fixture',
    choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{
      index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(input) },
    }] }, finish_reason: 'tool_calls' }],
  })}\n\n`);
}

export function assistantText(response, text) {
  response.write(`data: ${JSON.stringify({
    id: 'fixture-response', object: 'chat.completion.chunk', created: 1, model: 'fixture',
    choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: 'stop' }],
  })}\n\n`);
}

/** Disposable native OpenCode host and loopback provider for acceptance probes. */
export async function nativeFixture({ plugin = join(root, 'plugins/carthagent'), plugins: additionalPlugins = [], extraPlugins = [], respond = (_body, res) => streamText(res), env: extraEnv = {} } = {}) {
  const pluginPaths = [plugin, ...additionalPlugins, ...extraPlugins].filter(Boolean).map(path => resolve(path));
  const temp = await mkdtemp(join(tmpdir(), 'ctg-native-fixture-'));
  const cwd = join(temp, 'project');
  const config = join(temp, 'config/opencode');
  const requests = [];
  const providerErrors = [];
  let child;
  let client;
  let output = '';
  const provider = createServer((req, res) => {
    void (async () => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw || '{}');
      requests.push(body);
      await respond(body, res, req);
    })().catch(error => {
      providerErrors.push(error);
      if (!res.headersSent) res.writeHead(500);
      res.end('Fixture provider failed');
    });
  });
  const password = randomBytes(24).toString('hex');
  const stop = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { await exited; } finally { clearTimeout(timer); }
  };
  const close = async () => {
    await stop();
    provider.closeAllConnections();
    if (provider.listening) await new Promise(done => provider.close(done));
    await rm(temp, { recursive: true, force: true });
  };
  const request = (milliseconds = 30_000) => ({ signal: AbortSignal.timeout(milliseconds) });
  const start = async () => {
    if (child && child.exitCode === null && child.signalCode === null) throw Error('Fixture host already running');
    output = '';
    const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL']
      .filter(key => process.env[key]).map(key => [key, process.env[key]]));
    Object.assign(env, {
      HOME: join(temp, 'home'), USERPROFILE: join(temp, 'home'), APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata'),
      XDG_CONFIG_HOME: join(temp, 'config'), XDG_DATA_HOME: join(temp, 'data'),
      XDG_CACHE_HOME: join(temp, 'cache'), XDG_STATE_HOME: join(temp, 'state'),
      OPENCODE_DB: join(temp, 'database.sqlite'), OPENCODE_SERVER_PASSWORD: password,
      ...extraEnv,
    });
    child = spawn(await resolveOpenCode(),
      ['serve', '--hostname', '127.0.0.1', '--port', '0', '--print-logs', '--log-level', 'debug'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const baseUrl = await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(Error(`Host startup timeout: ${output}`)), 30_000);
      const collect = chunk => {
        output = (output + chunk).slice(-16384);
        const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
        if (url) { clearTimeout(timer); done(url); }
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(Error(`Host exited ${code}: ${output}`)); });
    });
    client = OpenCode.make({ baseUrl, headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } });
    const version = (await client.server.info(request())).version;
    if (version !== '2.0.32') throw Error(`Expected pinned host 2.0.32, got ${version}`);
    return client;
  };
  try {
    await Promise.all(['project', 'home', 'config/opencode', 'data', 'state', 'cache', 'appdata', 'localappdata']
      .map(directory => mkdir(join(temp, directory), { recursive: true })));
    provider.listen(0, '127.0.0.1');
    await once(provider, 'listening');
    await writeFile(join(config, 'opencode.json'), JSON.stringify({
      ...(pluginPaths.length ? { plugins: pluginPaths } : {}), update: 'disable', model: 'ctg-fixture/fixture', default_agent: 'build',
      providers: { 'ctg-fixture': {
        package: '@opencode/ai/providers/openai-compatible',
        settings: { baseURL: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: 'offline-fixture' },
        models: { fixture: { limit: { context: 32000, output: 1024 }, cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } } },
      } },
    }));
    await start();
  } catch (error) {
    await close();
    throw error;
  }
  return {
    temp, cwd, requests, providerErrors, request, start, stop, close,
    model: { providerID: 'ctg-fixture', id: 'fixture' },
    location: { directory: cwd },
    get client() { return client; },
    get output() { return output; },
    async outcome(sessionID) {
      await client.session.wait({ sessionID }, request());
      const deadline = Date.now() + 5000;
      while (true) {
        const session = await client.session.get({ sessionID }, request());
        if (session.outcome) return session.outcome;
        if (Date.now() >= deadline) throw Error(`Missing terminal outcome for ${sessionID}`);
        await new Promise(done => setTimeout(done, 20));
      }
    },
    async active(pluginID = 'carthagent', location = { directory: cwd }) {
      if (pluginID && typeof pluginID === 'object') {
        location = pluginID;
        pluginID = 'carthagent';
      }
      await client.session.create({ location, model:{providerID:'ctg-fixture',id:'fixture'}, title:`${pluginID} activation probe` }, request());
      const deadline = Date.now() + 15_000;
      while (true) {
        const inventory = await client.plugin.list({ location }, request());
        const plugin = inventory.data.find(item => item.id === pluginID);
        if (plugin?.state.status === 'active') return;
        if (plugin?.state.status === 'failed') throw Error(`Native fixture plugin failed: ${JSON.stringify(plugin)}\n${output}`);
        if (Date.now() >= deadline) throw Error(`Native plugin ${pluginID} activation timed out: ${JSON.stringify(plugin)}\n${output}`);
        await new Promise(done => setTimeout(done, 50));
      }
    },
  };
}

export function streamText(response, text = 'Fixture response complete.') {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
    id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture',
    choices: [{ index: 0, delta, finish_reason }],
    ...(finish_reason ? { usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } } : {}),
  })}\n\n`;
  response.write(chunk({ role: 'assistant', content: text }));
  response.end(`${chunk({}, 'stop')}data: [DONE]\n\n`);
}
