#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, toNamespacedPath } from 'node:path';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { OpenCode } from '@opencode/client';
import { resolveOpenCode, runtimePaths } from '../lib/opencode/runtime.mjs';
import { preflightNativeTestRuntimeArtifact } from './native-runtime-identity.mjs';

const root = resolve(import.meta.dirname, '..');
const runtimeOptions = { runtimeCacheRoot: process.env.CTG_RUNTIME_TEST_CACHE };
if (process.env.CTG_TEST_RUNTIME_RELEASE_MANIFEST) runtimeOptions.runtimeReleaseManifestPath = process.env.CTG_TEST_RUNTIME_RELEASE_MANIFEST;
if (process.env.CTG_TEST_RUNTIME_ARTIFACT_ROOT) {
  await preflightNativeTestRuntimeArtifact({ ownedRoot: process.env.CTG_TEST_RUNTIME_ARTIFACT_ROOT, expectedManifestPath: process.env.CTG_TEST_RUNTIME_RELEASE_MANIFEST });
  runtimeOptions.acquireOwnedRuntime = async () => process.env.CTG_TEST_RUNTIME_ARTIFACT_ROOT;
}
const binary = await resolveOpenCode(runtimeOptions);
const temp = await mkdtemp(join(tmpdir(), 'ctg-ship-models-'));
const cwd = join(temp, 'project');
const config = join(temp, 'config/opencode');
const password = randomBytes(24).toString('hex');
const token = `fixture.${Buffer.from(JSON.stringify({ sub: 'offline-user', sid: 'offline-session', scope: 'gateway:invoke', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`;
let modelRequests = 0;
const cloud = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    let status = 200, body;
    if (req.url === '/v1/device/authorizations') {
      body = { deviceCode: 'offline-device', userCode: 'OFFLINE', verificationUri: 'http://127.0.0.1/verify', expiresIn: 120, interval: 1 };
    } else if (req.url === '/v1/device/token') {
      body = { accessToken: token, refreshToken: 'offline-refresh', expiresIn: 3600 };
    } else if (req.url === '/v1/models' && req.headers.authorization === `Bearer ${token}`) {
      modelRequests++;
      body = { data: [{ id: 'ctg-ship-fixture' }] };
    } else { status = 404; body = {}; }
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
});
let child;
let output = '';
try {
  cloud.listen(0, '127.0.0.1');
  await once(cloud, 'listening');
  await mkdir(cwd);
  await mkdir(config, { recursive: true });
  await writeFile(join(config, 'opencode.json'), JSON.stringify({ plugins: [join(root, 'plugins/carthagent')], update: 'disable' }));
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, {
    HOME: join(temp, 'home'), USERPROFILE: join(temp, 'home'),
    APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata'),
    XDG_CONFIG_HOME: join(temp, 'config'), XDG_DATA_HOME: join(temp, 'data'),
    XDG_STATE_HOME: join(temp, 'state'), XDG_CACHE_HOME: join(temp, 'cache'),
    OPENCODE_CONFIG_DIR: config, OPENCODE_CONFIG: join(config, 'opencode.json'),
    OPENCODE_CONFIG_PROJECT_DISABLE: 'true', OPENCODE_DB: join(temp, 'database.sqlite'),
    OPENCODE_SERVER_PASSWORD: password, CARTHAGENT_CLOUD_URL: `http://127.0.0.1:${cloud.address().port}`,
  });
  async function startHost() {
    output = '';
    child = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', '0', '--print-logs'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const endpoint = await new Promise((resolveEndpoint, reject) => {
      const timer = setTimeout(() => reject(Error('Native Ship fixture host startup timed out')), 30_000);
      const collect = chunk => {
        output = (output + String(chunk)).slice(-16384);
        const found = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
        if (found) { clearTimeout(timer); resolveEndpoint(found); }
      };
      child.stdout.on('data', collect); child.stderr.on('data', collect);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(Error(`Native Ship fixture exited ${code}`)); });
    });
    const client = OpenCode.make({ baseUrl: endpoint, headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } });
    return { client, endpoint };
  }
  const { client, endpoint } = await startHost();
  const location = { directory: cwd };
  const request = { signal: AbortSignal.timeout(30_000) };
  const startedAt = Date.now();
  while (true) {
    const plugins = await client.plugin.list({ location }, request);
    const plugin = plugins.data.find(item => item.id === 'carthagent');
    if (plugin?.state.status === 'active') break;
    assert.notEqual(plugin?.state.status, 'error', 'Carthagent plugin setup failed');
    assert.ok(Date.now() - startedAt < 15000, 'Carthagent plugin did not become active');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const integrations = await client.integration.list({ location }, request);
  console.log(JSON.stringify({ supportedIntegrations: integrations.data.filter(item => /anthropic|openai|codex|chatgpt|xai|google|gemini|experiential/.test(item.id)).map(item => ({ id: item.id, name: item.name, methods: item.methods.map(method => ({ type: method.type, id: method.id, label: method.label })) })) }));
  const ship = integrations.data.find(item => item.id === 'experiential-labs');
  assert.ok(ship, 'Ship must be connectable without a preexisting credential or EXPLABS_API_KEY');
  console.log(JSON.stringify({ integrationName: ship.name, methods: ship.methods.map(method => ({ type: method.type, id: method.id })) }));
  const started = await client.integration.oauth.connect({ integrationID: ship.id, methodID: 'carthagent-device', answer: {}, location }, request);
  const deadline = Date.now() + 15000;
  while (true) {
    const status = (await client.integration.oauth.status({ integrationID: ship.id, attemptID: started.data.attemptID, location }, request)).data;
    if (status.status === 'complete') break;
    assert.ok(['pending', 'waiting'].includes(status.status), `OAuth completion failed: ${status.status}`);
    assert.ok(Date.now() < deadline, 'OAuth completion timed out');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  let models;
  do {
    models = (await client.model.list({ location }, request)).data.filter(model => model.providerID === ship.id);
    if (models.some(model => model.id === 'ctg-ship-fixture')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  console.log(JSON.stringify({ modelRequests, models: models.map(model => ({ id: model.id, providerID: model.providerID, connected: model.connected, status: model.status })) }));
  assert.ok(models.some(model => model.id === 'ctg-ship-fixture'), 'Successful Ship OAuth must publish discovered models in the real native model inventory without EXPLABS_API_KEY');
  assert.equal(ship.name, 'Carthagent Ship', 'The connect picker must show the Ship name');
  assert.deepEqual(integrations.data.map(item => item.id).sort(), ['anthropic', 'experiential-labs', 'google', 'openai', 'xai'], 'Login must contain only the curated major integrations');
  const providers = (await client.provider.list({ location }, request)).data;
  assert.ok(!providers.some(provider => /^opencode(?:-|$)/.test(provider.id)), 'The upstream provider must not be available');
  const paths = runtimePaths({ root: temp });
  const credentialBeforeStop = (await client.credential.list(request)).find(entry => entry.integrationID === ship.id);
  assert.ok(credentialBeforeStop?.active, 'Ship must have a persisted active credential');
  const info = await client.server.info(request);
  assert.equal(info.pid, child.pid);
  await mkdir(join(temp, 'state/opencode'), { recursive: true });
  await writeFile(paths.serviceFile, JSON.stringify({ id: 'ship-model-regression', pid: child.pid, url: endpoint, password, runtimeIdentity: { version: info.version } }), { mode: 0o600 });
  const closed = once(child, 'close');
  const stopped = await promisify(execFile)(process.execPath, [join(root, 'bin/ctg.mjs'), 'native', 'service', 'stop'], { cwd, env: { ...env, CTG_OPENCODE_HOME: temp }, timeout: 15000 });
  assert.match(stopped.stdout, /Stopped the registered native service/);
  await closed;
  const restarted = await startHost();
  const credentialAfterStop = (await restarted.client.credential.list(request)).find(entry => entry.id === credentialBeforeStop.id);
  assert.deepEqual(credentialAfterStop, credentialBeforeStop, 'Explicit service stop must preserve the active authenticated credential across restart');
  assert.ok((await readFile(join(temp, 'database.sqlite'))).length > 0, 'Explicit service stop must preserve the native database');
  console.log('Explicit native service stop preserved credentials and database.');

} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const closed = once(child, 'close', { signal: AbortSignal.timeout(10_000) });
    // No PTYs are spawned here; stop this exact server like the service-stop command does.
    child.kill('SIGTERM');
    const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 5000);
    try { await closed; }
    finally { clearTimeout(timer); }
  }
  cloud.closeAllConnections();
  await new Promise(resolve => cloud.close(resolve));
  if (process.platform === 'win32') {
    // fs.rm can stall on the runtime-created Windows cache tree after the host exits.
    const removed = await promisify(execFile)(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'rmdir /s /q "%CTG_NATIVE_FIXTURE_TEMP%"'], {
      env: { ...process.env, CTG_NATIVE_FIXTURE_TEMP: toNamespacedPath(temp) },
      windowsVerbatimArguments: true, windowsHide: true, timeout: 30_000,
    });
    await assert.rejects(access(temp), { code: 'ENOENT' }, JSON.stringify(removed));
  } else {
    await rm(temp, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
  }
  console.log('Native Ship fixture shutdown and temporary-directory cleanup completed.');
}
