/** Disposable real native host and loopback provider for acceptance probes. */
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { OpenCode } from '@opencode/client';
import { resolveOpenCode } from '../lib/opencode/runtime.mjs';
import { assertCompletePluginSource, assertPluginCondition, resolveFixtureSourceRoot, verifySnapshotIdentity } from './native-paired-guards.mjs';

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

export async function nativeFixture({ plugin = join(root, 'plugins/carthagent'), pluginOptions, plugins: additionalPlugins = [], pluginExpected = plugin ? 'active' : 'absent', verifyInventory = false, provenance, respond = (_body, res) => streamText(res), env: extraEnv = {}, preserveTemp = false } = {}) {
  const pluginEntries = [
    ...(plugin ? [pluginOptions ? { package: resolve(plugin), options: pluginOptions } : resolve(plugin)] : []),
    ...additionalPlugins.map(plugin => typeof plugin === 'string' ? resolve(plugin) : {
      ...plugin,
      package: resolve(plugin.package),
    }),
  ];
  const temp = await mkdtemp(join(tmpdir(), 'ctg-native-fixture-'));
  const cwd = join(temp, 'project');
  const pluginProbeCwd = verifyInventory ? join(temp, 'project-alpha') : cwd;
  const config = join(temp, 'config/opencode');
  const requests = [];
  const providerErrors = [];
  const hostErrors = [];
  let child;
  let childDetached = false;
  let client;
  let baseUrl;
  let password;
  let pluginObservation;
  let pluginInventory;
  let pluginHealth;
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
  password = randomBytes(24).toString('hex');
  const stop = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    try {
      if (childDetached) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch { child.kill('SIGTERM'); }
    const timer = setTimeout(() => {
      try {
        if (childDetached) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch { child.kill('SIGKILL'); }
    }, 5000);
    try { await exited; } finally { clearTimeout(timer); }
  };
  const close = async ({ preserveTemp: keepTemp = preserveTemp } = {}) => {
    await stop();
    provider.closeAllConnections();
    if (provider.listening) await new Promise(done => provider.close(done));
    if (!keepTemp) await rm(temp, { recursive: true, force: true });
  };
  const request = (milliseconds = 30_000) => ({ signal: AbortSignal.timeout(milliseconds) });
  const start = async () => {
    if (child && child.exitCode === null && child.signalCode === null) throw Error('Fixture host already running');
    output = '';
    const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL']
      .filter(key => process.env[key]).map(key => [key, process.env[key]]));
    if (process.env.NODE_OPTIONS) env.NODE_OPTIONS = process.env.NODE_OPTIONS;
    Object.assign(env, {
      ...extraEnv,
      HOME: join(temp, 'home'), USERPROFILE: join(temp, 'home'),
      CARTHAGENT_CODING_AGENT_DIR: join(temp, 'home/.carthagent/agent'),
      PI_CODING_AGENT_DIR: join(temp, 'home/.carthagent/agent'),
      APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata'),
      XDG_CONFIG_HOME: join(temp, 'config'), XDG_DATA_HOME: join(temp, 'data'),
      XDG_CACHE_HOME: join(temp, 'cache'), XDG_STATE_HOME: join(temp, 'state'),
      OPENCODE_DB: join(temp, 'database.sqlite'), OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_CONFIG_PROJECT_DISABLE: 'true',
    });
    if (verifyInventory) {
      env.NODE_PATH = join(root, 'node_modules');
    }
    const binary = await resolveOpenCode();
    childDetached = !verifyInventory;
    child = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', '0', ...(extraEnv.CTG_NATIVE_DEBUG === '1' ? ['--print-logs', '--log-level', 'debug'] : [])],
      { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: childDetached });
    baseUrl = await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(Error(`Host startup timeout: ${output}`)), 30_000);
      const collect = chunk => {
        output = (output + chunk).slice(-16384);
        const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
        if (url) { clearTimeout(timer); done(url); }
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', (code, signal) => {
        if (code !== 0) hostErrors.push({ code, signal, output });
        clearTimeout(timer);
        reject(Error(`Host exited ${code ?? signal}: ${output}`));
      });
    });
    client = OpenCode.make({ baseUrl, headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } });
    const version = (await client.server.info(request())).version;
    if (version !== '2.0.32') throw Error(`Expected pinned host 2.0.32, got ${version}`);
    const location = { directory: pluginProbeCwd };
    if (verifyInventory) {
      await client.session.create({ location, model: { providerID: 'ctg-fixture', id: 'fixture' }, title: 'native plugin activation probe' }, request());
      if (pluginExpected === 'active') {
        assertCompletePluginSource(root);
        const { assertWorkspacePluginResolution } = await import('./native-paired-guards.mjs');
        assertWorkspacePluginResolution(root);
      }
      const deadline = Date.now() + 15_000;
      let inventory;
      while (Date.now() < deadline) {
        inventory = await client.plugin.list({ location }, request());
        pluginInventory = inventory.data;
        try {
          pluginObservation = assertPluginCondition(inventory.data, pluginExpected === 'active');
          break;
        } catch (error) {
          if (inventory.data.some(item => (item?.id === 'carthagent' ||
              (typeof item?.id === 'string' && item.id.startsWith('carthagent.'))) && item.state?.status === 'error') ||
              pluginExpected === 'absent' || Date.now() + 100 >= deadline) throw error;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      if (!pluginObservation) throw new Error('Timed out waiting for native plugin inventory condition');
      if (pluginExpected === 'active') {
        const probe = await client.rpc.call({ rpcID: 'carthagent', method: 'health', input: {}, location }, request());
        if (probe.output?.hostVersion !== '2.0.32' || probe.output?.protocol !== 1) {
          throw Error(`Native Carthagent health probe failed: ${JSON.stringify(probe.output)}`);
        }
        pluginHealth = { protocol: probe.output.protocol, hostVersion: probe.output.hostVersion, directoryMatches: probe.output.directory === pluginProbeCwd };
        if (!pluginHealth.directoryMatches) throw Error('Native Carthagent health RPC reported an unexpected fixture directory');
      }
      if (provenance) {
        const { assertDependencyPackageIdentity, hashDependencyInstall, hashDependencyPackages } = await import('./native-paired-guards.mjs');
        verifySnapshotIdentity(provenance, provenance, { verifyArtifactFiles: false });
        const binary = process.env.CTG_OPENCODE_BIN ?? join(root, 'node_modules/@opencode/cli/bin/opencode.exe');
        if (provenance.binarySha256 !== createHash('sha256').update(await readFile(binary)).digest('hex')) {
          throw new Error('Native fixture binary hash does not match selected executable');
        }
        // Baseline fixtures intentionally pass plugin=null; resolve dependency
        // provenance from this immutable execution snapshot in that condition.
        const sourceRoot = resolveFixtureSourceRoot(plugin, root);
        const dependencyRoot = provenance.dependencyNodeModulesRealpath;
        const dependencies = hashDependencyPackages(dependencyRoot, join(sourceRoot, 'package.json'), sourceRoot);
        if (JSON.stringify(dependencies) !== JSON.stringify(provenance.dependencyPackages)) throw new Error('Native fixture dependency package identity mismatch');
        const installIdentity = hashDependencyInstall(dependencyRoot);
        assertDependencyPackageIdentity({ realpath: provenance.dependencyInstallRealpath, treeSha256: provenance.dependencyInstallSha256 }, installIdentity);
      }
    }
    return client;
  };
  try {
    await Promise.all(['project', 'project-alpha', 'home', 'config/opencode', 'data', 'state', 'cache', 'appdata', 'localappdata']
      .map(directory => mkdir(join(temp, directory), { recursive: true })));
    provider.listen(0, '127.0.0.1');
    await once(provider, 'listening');
    await writeFile(join(config, 'opencode.json'), JSON.stringify({
      plugins: pluginEntries, update: 'disable', model: 'ctg-fixture/fixture',
      default_agent: 'build',
      providers: { 'ctg-fixture': {
        package: '@opencode/ai/providers/openai-compatible',
        settings: { baseURL: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: 'offline-fixture' },
        models: { fixture: { limit: { context: 32000, output: 1024 }, cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } } },
      } },
    }));
    await start();
  } catch (error) {
    await close({ preserveTemp: false });
    throw error;
  }
  return {
    temp, cwd, baseUrl, password, requests, providerErrors, hostErrors, request, start, stop, close,
    serverPid: () => child?.pid ?? null,
    pluginObservation, pluginInventory, pluginHealth, provenance,
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
    async active(pluginOrLocation = { directory: cwd }, at = { directory: cwd }) {
      const pluginID = typeof pluginOrLocation === 'string' ? pluginOrLocation : 'carthagent';
      const location = typeof pluginOrLocation === 'string' ? at : pluginOrLocation;
      if (pluginID !== 'carthagent') await client.session.create({ location, model:{providerID:'ctg-fixture',id:'fixture'}, title:`${pluginID} activation probe` }, request());
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
