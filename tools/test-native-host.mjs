#!/usr/bin/env node
/** Offline real-host test. Uses a disposable HOME and never discovers the user's service. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { OpenCode } from '@opencode/client';
import { resolveOpenCode } from '../lib/opencode/runtime.mjs';
import { cancelSession } from '../lib/opencode/service.mjs';
import { runHeadless } from '../lib/opencode/headless.mjs';

const root = resolve(import.meta.dirname, '..');
const plugin = resolve(process.argv[2] ?? join(root, 'plugins/carthagent'));
const binary = await resolveOpenCode();
const temp = await mkdtemp(join(tmpdir(), 'ctg-host-smoke-'));
const password = randomBytes(24).toString('hex');
let child;
let output = '';
let fixtureRequests = 0;
const fixture = createServer(async (req, res) => {
  fixtureRequests += 1;
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404).end();
    return;
  }
  for await (const _chunk of req) { /* Consume request body. */ }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
    id: 'chatcmpl-ctg-fixture', object: 'chat.completion.chunk', created, model: 'fixture',
    choices: [{ index: 0, delta, finish_reason }],
  })}\n\n`;
  res.write(chunk({ role: 'assistant', content: 'CTG_FIXTURE_OK' }));
  res.write(chunk({}, 'stop'));
  res.end('data: [DONE]\n\n');
});
await new Promise((resolveListen, reject) => fixture.once('error', reject).listen(0, '127.0.0.1', resolveListen));
try {
  const cwd = join(temp, 'project');
  const config = join(temp, 'config/opencode');
  const homeConfig = join(temp, 'home/.config/opencode');
  await Promise.all([mkdir(cwd), mkdir(config, { recursive: true }), mkdir(homeConfig, { recursive: true })]);
  await writeFile(join(homeConfig, 'opencode.json'), JSON.stringify({ model: 'home-poison/model', plugins: ['home-poison-plugin'] }));
  await writeFile(join(cwd, 'opencode.json'), JSON.stringify({ model: 'project-poison/model', plugins: ['project-poison-plugin'] }));
  await writeFile(join(config, 'opencode.json'), JSON.stringify({
    plugins: [plugin], update: 'disable',
    model: 'ctgfixture/fixture',
    providers: {
      ctgfixture: {
        name: 'CTG local prompt fixture',
        package: '@opencode/ai/providers/openai-compatible',
        settings: { baseURL: `http://127.0.0.1:${fixture.address().port}/v1` },
        models: { fixture: { name: 'Fixture', limit: { context: 8192, output: 1024 } } },
      },
    },
  }));
  const env = {
    PATH: process.env.PATH,
    HOME: join(temp, 'home'),
    XDG_CONFIG_HOME: join(temp, 'config'),
    XDG_DATA_HOME: join(temp, 'data'),
    XDG_STATE_HOME: join(temp, 'state'),
    XDG_CACHE_HOME: join(temp, 'cache'),
    OPENCODE_CONFIG_DIR: config,
    OPENCODE_CONFIG: join(config, 'opencode.json'),
    OPENCODE_CONFIG_PROJECT_DISABLE: 'true',
    OPENCODE_DB: join(temp, 'database.sqlite'),
    OPENCODE_SERVER_PASSWORD: password,
  };
  child = spawn(binary, [
    'serve', '--hostname', '127.0.0.1', '--port', '0', '--print-logs', '--log-level', 'debug',
  ], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    const timer = setTimeout(() => reject(new Error(`Host startup timed out: ${output}`)), 30_000);
    const collect = (chunk) => {
      output = (output + chunk.toString()).slice(-16_384);
      const address = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (address) { clearTimeout(timer); resolveEndpoint(address); }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Host exited ${code}: ${output}`)); });
  });
  const client = OpenCode.make({
    baseUrl: endpoint,
    headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` },
  });
  const request = { signal: AbortSignal.timeout(90_000) };
  const info = await client.server.info(request);
  assert.equal(info.version, '2.0.32');
  const isolationFetch = async (url, init) => {
    const response = await fetch(url, init);
    if (new URL(url).pathname === '/api/config') {
      const entries = await response.clone().json();
      assert.ok(!entries.some((entry) => entry.type === 'document' && [join(homeConfig, 'opencode.json'), join(cwd, 'opencode.json')].includes(entry.path)), `home and workspace config must not be discovered: ${JSON.stringify(entries)}`);
      assert.ok(!JSON.stringify(entries).includes('poison'), `foreign config/plugin discovery must not leak into the CTG profile: ${JSON.stringify(entries)}`);
    }
    return response;
  };
  const isolatedClient = OpenCode.make({
    baseUrl: endpoint,
    headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` },
    fetch: isolationFetch,
  });
  const configEntries = await isolatedClient.config.get({ location: { directory: cwd } }, request);
  const merged = configEntries.find((entry) => entry.type === 'document')?.info;
  assert.deepEqual(merged.model, { providerID: 'ctgfixture', model: 'fixture' }, 'local model config must be loaded');
  assert.ok(merged.providers?.ctgfixture, 'custom fixture provider config must be loaded');
  const unauthorized = await fetch(`${endpoint}/api/info`, { signal: request.signal });
  assert.equal(unauthorized.status, 401);
  const session = await client.session.create({
    location: { directory: cwd }, title: 'CTG host smoke',
    model: { providerID: 'ctgfixture', id: 'fixture' },
  }, request);
  let plugins;
  const deadline = Date.now() + 15_000;
  do {
    plugins = await client.plugin.list({ location: { directory: cwd } }, request);
    if (plugins.data.some((entry) => entry.id === 'carthagent')) break;
    await new Promise((done) => setTimeout(done, 200));
  } while (Date.now() < deadline);
  const nativePlugin = plugins.data.find((entry) => entry.id === 'carthagent');
  assert.ok(nativePlugin, 'Carthagent plugin must become visible');
  assert.equal(nativePlugin.state.status, 'active');
  const health = await client.rpc.call({
    rpcID: 'carthagent', method: 'health', input: {}, location: { directory: cwd },
  }, request);
  console.log(JSON.stringify({ version: info.version, plugin: nativePlugin, health }, null, 2));
  assert.equal(health.output.directory, cwd);
  assert.equal(health.output.protocol, 1);
  const echo = await client.rpc.call({
    rpcID: 'carthagent', method: 'echo', input: { text: 'native RPC fixture' }, location: { directory: cwd },
  }, request);
  assert.deepEqual(echo.output, { text: 'native RPC fixture' });
  const ensuredService = {
    url: endpoint,
    headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` },
    info: { password },
  };
  const wrappedRun = await runHeadless(ensuredService, cwd, 'Reply with the fixture response.', { sessionID: session.id, timeout: 90_000 });
  const assistant = wrappedRun.result?.message;
  assert.ok(assistant, 'headless prompt must produce an assistant response');
  assert.equal(assistant.finish, 'stop');
  assert.equal(assistant.content.filter((part) => part.type === 'text').map((part) => part.text).join(''), 'CTG_FIXTURE_OK');
  assert.equal(wrappedRun.accepted.type, 'user');
  assert.ok(wrappedRun.messages.length >= 2);
  assert.ok(fixtureRequests > 0, 'assistant prompt must reach the local fixture endpoint');
  const idleInterrupt = await cancelSession(ensuredService, session.id, { location: { directory: cwd }, timeout: 5000 });
  assert.equal(idleInterrupt.interrupted, false, 'wrapper cancellation should use the v2 bounded interrupt API and report idle state');
  const requestsBeforeAttach = fixtureRequests;
  const attachedRun = await new Promise((resolveRun, reject) => {
    const attached = spawn(binary, [
      'run', '--server', endpoint, '--session', session.id, '--format', 'json',
      'Reply with the fixture response.',
    ], { cwd, env: { ...env, OPENCODE_PASSWORD: password }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => attached.kill('SIGKILL'), 90_000);
    attached.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    attached.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    attached.once('error', (error) => { clearTimeout(timer); reject(error); });
    attached.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolveRun(stdout);
      else reject(new Error(`Attached native CLI exited ${code ?? signal}: ${stderr}`));
    });
  });
  assert.match(attachedRun, /CTG_FIXTURE_OK/, 'the packaged CLI should attach to and prompt the ensured service');
  assert.ok(fixtureRequests > requestsBeforeAttach, 'the attached CLI request must be handled by the already-running fixture-backed service');
  const pty = await client.pty.create({
    location: { directory: cwd },
    command: binary,
    args: ['--server', endpoint, cwd],
    cwd,
    title: 'CTG native TUI attach smoke',
    env: { ...env, OPENCODE_PASSWORD: password },
  }, request);
  const ptyID = pty.data.id;
  assert.ok(ptyID, 'the attached service should create a native PTY');
  let ptyState;
  const ptyDeadline = Date.now() + 10_000;
  do {
    ptyState = await client.pty.get({ ptyID, location: { directory: cwd } }, request);
    if (ptyState.data.status === 'running') break;
    await new Promise((done) => setTimeout(done, 100));
  } while (Date.now() < ptyDeadline);
  assert.equal(ptyState.data.status, 'running', 'native TUI should attach and remain active in the service-owned PTY');
  await client.pty.remove({ ptyID, location: { directory: cwd } }, request);
  await assert.rejects(client.rpc.call({
    rpcID: 'carthagent', method: 'health', input: { unexpected: true }, location: { directory: cwd },
  }, request));
  console.log('Native plugin activation, health, echo result, and input validation passed against OpenCode 2.0.32.');
} catch (error) {
  console.error(JSON.stringify({ fixtureRequests }));
  console.error(output.replaceAll(password, '[redacted]'));
  throw error;
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    await exited;
    clearTimeout(timer);
  }
  await new Promise((resolveClose) => fixture.close(resolveClose));
  await rm(temp, { recursive: true, force: true });
}
