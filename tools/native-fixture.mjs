/** Disposable real native host and loopback provider for acceptance probes. */
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { OpenCode } from '@opencode/client';

const root = resolve(import.meta.dirname, '..');

export function streamText(res, text = 'Fixture response complete.') {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
    id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture',
    choices: [{ index: 0, delta, finish_reason }],
    ...(finish_reason ? { usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } } : {}),
  })}\n\n`;
  res.write(chunk({ role: 'assistant', content: text }));
  res.end(`${chunk({}, 'stop')}data: [DONE]\n\n`);
}

export async function nativeFixture({ plugin = join(root, 'plugins/carthagent'), respond = (_body, res) => streamText(res), env: extraEnv = {} } = {}) {
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
      HOME: join(temp, 'home'), USERPROFILE: join(temp, 'home'),
      XDG_CONFIG_HOME: join(temp, 'config'), XDG_DATA_HOME: join(temp, 'data'),
      XDG_CACHE_HOME: join(temp, 'cache'), XDG_STATE_HOME: join(temp, 'state'),
      OPENCODE_DB: join(temp, 'database.sqlite'), OPENCODE_SERVER_PASSWORD: password,
      ...extraEnv,
    });
    child = spawn(process.env.CTG_OPENCODE_BIN ?? 'opencode',
      ['serve', '--hostname', '127.0.0.1', '--port', '0'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
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
    await Promise.all(['project', 'home', 'config/opencode', 'data', 'state', 'cache']
      .map(directory => mkdir(join(temp, directory), { recursive: true })));
    provider.listen(0, '127.0.0.1');
    await once(provider, 'listening');
    await writeFile(join(config, 'opencode.json'), JSON.stringify({
      ...(plugin ? { plugins: [resolve(plugin)] } : {}), update: 'disable', model: 'ctg-fixture/fixture', default_agent: 'build',
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
      // wait resolves before the durable session projection always catches up.
      while (true) {
        const session = await client.session.get({ sessionID }, request());
        if (session.outcome) return session.outcome;
        if (Date.now() >= deadline) throw Error(`Missing terminal outcome for ${sessionID}`);
        await new Promise(done => setTimeout(done, 20));
      }
    },
    async active(pluginID = 'carthagent', location = { directory: cwd }) {
      if (pluginID !== 'carthagent') await client.session.create({ location, model:{providerID:'ctg-fixture',id:'fixture'}, title:'plugin activation probe' }, request());
      const deadline = Date.now() + 15_000;
      while (true) {
        const inventory = await client.plugin.list({ location }, request());
        const plugin = inventory.data.find(item => item.id === pluginID);
        if (plugin?.state.status === 'active') return;
        if (plugin?.state.status === 'error') throw Error(`Native fixture plugin failed: ${JSON.stringify(plugin)}\n${output}`);
        if (Date.now() >= deadline) throw Error(`Native plugin ${pluginID} activation timed out: ${JSON.stringify(plugin)}\n${output}`);
        await new Promise(done => setTimeout(done, 50));
      }
    },
  };
}
