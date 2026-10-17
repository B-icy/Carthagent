#!/usr/bin/env node
/** Offline real-host test. Uses a disposable HOME and never discovers the user's service. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { OpenCode } from '@opencode/client';

const root = resolve(import.meta.dirname, '..');
const plugin = resolve(process.argv[2] ?? join(root, 'plugins/carthagent'));
const temp = await mkdtemp('/tmp/opencode/ctg-host-smoke-');
const password = randomBytes(24).toString('hex');
let child;
let output = '';
let deviceAuthorizationBody;
const authServer = createServer((request, response) => {
  let body = '';
  request.setEncoding('utf8').on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
  if (request.url === '/v1/device/authorizations') {
    deviceAuthorizationBody = JSON.parse(body);
    response.writeHead(201, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ deviceCode: 'offline-device-code', userCode: 'OFFLINE', verificationUri: 'http://127.0.0.1/verify', expiresIn: 120, interval: 1 }));
  } else if (request.url === '/v1/device/token') {
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'authorization_pending' }));
  } else {
    response.writeHead(404).end();
  }
  });
});
await new Promise((resolveListen, reject) => authServer.listen(0, '127.0.0.1', resolveListen).once('error', reject));
const authAddress = authServer.address();
try {
  const cwd = join(temp, 'project');
  const config = join(temp, 'config/opencode');
  await Promise.all([mkdir(cwd), mkdir(config, { recursive: true }), mkdir(join(temp, 'home'))]);
  await writeFile(join(config, 'opencode.json'), JSON.stringify({
    plugins: [plugin], update: 'disable',
  }));
  const env = {
    PATH: process.env.PATH,
    HOME: join(temp, 'home'),
    XDG_CONFIG_HOME: join(temp, 'config'),
    XDG_DATA_HOME: join(temp, 'data'),
    XDG_STATE_HOME: join(temp, 'state'),
    XDG_CACHE_HOME: join(temp, 'cache'),
    OPENCODE_DB: join(temp, 'database.sqlite'),
    OPENCODE_SERVER_PASSWORD: password,
    CARTHAGENT_CLOUD_URL: `http://127.0.0.1:${authAddress.port}`,
  };
  child = spawn(process.env.CTG_OPENCODE_BIN ?? 'opencode', [
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
  const request = { signal: AbortSignal.timeout(30_000) };
  const info = await client.server.info(request);
  assert.equal(info.version, '2.0.32');
  const unauthorized = await fetch(`${endpoint}/api/info`, { signal: request.signal });
  assert.equal(unauthorized.status, 401);
  await client.session.create({ location: { directory: cwd }, title: 'CTG host smoke' }, request);
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
  const providers = await client.provider.list({ location: { directory: cwd } }, request);
  assert.ok(providers.data.some((provider) => provider.id === 'experiential-labs'),
    'plugin setup must register the Ship provider with the real host');
  const integrations = await client.integration.list({ location: { directory: cwd } }, request);
  const ship = integrations.data.find(({ id }) => id === 'experiential-labs');
  assert.ok(ship, 'the native provider catalog must supply a real Ship integration record');
  assert.ok(ship.methods.some(({ type, id }) => type === 'oauth' && id === 'carthagent-device'),
    'plugin integration transform must register the Ship device-OAuth method');
  assert.ok(ship.methods.some(({ type }) => type === 'key'),
    'plugin integration transform must register the Ship API-key method');
  console.log(JSON.stringify({ providers: providers.data.map((provider) => provider.id), shipMethods: ship.methods }));
  const health = await client.rpc.call({
    rpcID: 'carthagent', method: 'health', input: {}, location: { directory: cwd },
  }, request);
  console.log(JSON.stringify({ version: info.version, plugin: nativePlugin, health }, null, 2));
  assert.equal(health.output.directory, cwd);
  assert.equal(health.output.protocol, 1);
  const auth = await client.rpc.call({
    rpcID: 'carthagent', method: 'authStart', input: {}, location: { directory: cwd },
  }, request);
  assert.equal(auth.output.userCode, 'OFFLINE');
  assert.match(auth.output.flowId, /^[0-9a-f-]{36}$/);
  assert.match(deviceAuthorizationBody.installId, /^[0-9a-f-]{36}$/);
  assert.equal((await client.rpc.call({
    rpcID: 'carthagent', method: 'authCancel', input: { flowId: auth.output.flowId }, location: { directory: cwd },
  }, request)).output.cancelled, true);
  console.log('Device authorization start/cancel RPC passed against offline OpenCode host.');
  await assert.rejects(client.rpc.call({
    rpcID: 'carthagent', method: 'health', input: { unexpected: true }, location: { directory: cwd },
  }, request));
  console.log('Native plugin and validated RPC passed against OpenCode 2.0.32.');
} catch (error) {
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
  await rm(temp, { recursive: true, force: true });
  await new Promise((resolveClose) => authServer.close(resolveClose));
}
