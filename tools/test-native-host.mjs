#!/usr/bin/env node
/** Offline real-host test. Uses a disposable HOME and never discovers the user's service. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { OpenCode } from '@opencode/client';
import { resolveOpenCode } from '../lib/opencode/runtime.mjs';
import { loadNativeTestRuntime } from './native-runtime-identity.mjs';
import { cancelSession } from '../lib/opencode/service.mjs';
import { runHeadless } from '../lib/opencode/headless.mjs';

const root = resolve(import.meta.dirname, '..');
const plugin = resolve(process.argv[2] ?? join(root, 'plugins/carthagent'));
const ownedRoot = process.env.CTG_OWNED_OPENCODE_RUNTIME;
const binary = ownedRoot ? ownedRuntimeBinary(ownedRoot) : await resolveOpenCode();
const expectedManifest = ownedRoot ? JSON.parse(await readFile(process.env.CTG_TEST_RUNTIME_RELEASE_MANIFEST ?? join(root, 'lib/opencode/runtime-release.json'), 'utf8')) : undefined;
const runtimeIdentity = await loadNativeTestRuntime({ binary, ownedRoot, expectedManifest });
const execFileAsync = promisify(execFile);
const temp = await mkdtemp(join(tmpdir(), 'ctg-host-smoke-'));
const password = randomBytes(24).toString('hex');
const providerKey = `sentinel-${randomBytes(24).toString('hex')}`;
let child;
let childClosed = false;
let output = '';
let fixtureRequests = 0;
const fixture = createServer(async (req, res) => {
  fixtureRequests += 1;
  let raw = '';
  for await (const chunk of req) raw += chunk;
  let body;
  try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
  const currentUser = [...(body.messages ?? [])].reverse().find((message) => message.role === 'user');
  const promptText = JSON.stringify(currentUser);
  if (promptText.includes('WRAPPER_TOOL') && body.tools?.some((tool) => tool.function?.name === 'read') && !(body.messages ?? []).some((message) => message.role === 'tool')) {
    const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
      id: 'chatcmpl-ctg-tool', object: 'chat.completion.chunk', created: 1, model: 'fixture',
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`${chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'wrapper-read', type: 'function',
      function: { name: 'read', arguments: JSON.stringify({ path: join(temp, 'project/wrapper-tool.txt') }) } }] })}${chunk({}, 'tool_calls')}data: [DONE]\n\n`);
    return;
  }
  if (promptText.includes('WRAPPER_FAILURE')) {
    res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'Offline wrapper rejection', type: 'invalid_request_error' } }));
    return;
  }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
    id: 'chatcmpl-ctg-fixture', object: 'chat.completion.chunk', created, model: 'fixture',
    choices: [{ index: 0, delta, finish_reason }],
  })}\n\n`;
  const reply = promptText.includes('WRAPPER_TOOL') ? 'FINAL_AFTER_TOOL' : promptText.includes('WRAPPER_SECOND') ? 'SECOND_TURN' : 'CTG_FIXTURE_OK';
  res.write(chunk({ role: 'assistant', content: reply }));
  res.write(chunk({}, 'stop'));
  res.end('data: [DONE]\n\n');
});
await new Promise((resolveListen, reject) => fixture.once('error', reject).listen(0, '127.0.0.1', resolveListen));
let deviceAuthorizationBody;
const gatewayAuth = [];
const gatewayServer = createServer((request, response) => {
  gatewayAuth.push({ authorization: request.headers.authorization, url: request.url });
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(request.url?.endsWith('/models')
    ? { data: [{ id: 'sentinel-model' }] }
    : { id: 'chatcmpl-sentinel', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
});
await new Promise((resolveListen, reject) => gatewayServer.listen(0, '127.0.0.1', resolveListen).once('error', reject));
const gatewayAddress = gatewayServer.address();
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
  const legacy = join(temp, 'home/.carthagent/agent/sessions');
  const homeConfig = join(temp, 'home/.config/opencode');
  const ancestorConfig = join(temp, '.opencode');
  await Promise.all([
    mkdir(cwd),
    mkdir(config, { recursive: true }),
    mkdir(legacy, { recursive: true }),
    mkdir(join(temp, 'appdata'), { recursive: true }),
    mkdir(join(temp, 'localappdata'), { recursive: true }),
    mkdir(homeConfig, { recursive: true }),
    mkdir(ancestorConfig, { recursive: true }),
  ]);
  await writeFile(join(legacy, 'legacy.jsonl'), '{"type":"session","id":"legacy-fixture"}\n{"type":"message","message":{"role":"user","content":"fixture needle"}}\nmalformed\n');
  await writeFile(join(homeConfig, 'opencode.json'), JSON.stringify({ model: 'home-poison/model', plugins: ['home-poison-plugin'] }));
  await writeFile(join(cwd, 'opencode.json'), JSON.stringify({ model: 'project-poison/model', plugins: ['project-poison-plugin'] }));
  await writeFile(join(temp, 'opencode.json'), JSON.stringify({ model: 'ancestor-poison/model', plugins: ['ancestor-poison-plugin'] }));
  await writeFile(join(ancestorConfig, 'opencode.json'), JSON.stringify({ model: 'hidden-ancestor-poison/model', plugins: ['hidden-ancestor-poison-plugin'] }));
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
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'USERPROFILE']
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]]));
  Object.assign(env, {
    HOME: join(temp, 'home'),
    USERPROFILE: join(temp, 'home'),
    APPDATA: join(temp, 'appdata'),
    LOCALAPPDATA: join(temp, 'localappdata'),
    XDG_CONFIG_HOME: join(temp, 'config'),
    XDG_DATA_HOME: join(temp, 'data'),
    XDG_STATE_HOME: join(temp, 'state'),
    XDG_CACHE_HOME: join(temp, 'cache'),
    OPENCODE_CONFIG_DIR: config,
    OPENCODE_CONFIG: join(config, 'opencode.json'),
    OPENCODE_CONFIG_PROJECT_DISABLE: 'true',
    OPENCODE_DB: join(temp, 'database.sqlite'),
    OPENCODE_SERVER_PASSWORD: password,
    CARTHAGENT_CLOUD_URL: `http://127.0.0.1:${authAddress.port}`,
    EXPLABS_API_KEY: providerKey,
    EXP_GATEWAY_URL: `http://127.0.0.1:${gatewayAddress.port}`,
  });
  child = spawn(binary, [
    'serve', '--hostname', '127.0.0.1', '--port', '0', '--print-logs', '--log-level', 'debug',
  ], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.once('close', () => { childClosed = true; });
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
  assert.equal(info.version, runtimeIdentity.runtimeVersion);
  const isolationFetch = async (url, init) => {
    const response = await fetch(url, init);
    if (new URL(url).pathname === '/api/config') {
      const entries = await response.clone().json();
      assert.ok(!entries.some((entry) => entry.type === 'document' && [homeConfig, cwd, temp, ancestorConfig].map(directory => join(directory, 'opencode.json')).includes(entry.path)), `home, workspace and ancestor config must not be discovered: ${JSON.stringify(entries)}`);
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
    const current = plugins.data.find((entry) => entry.id === 'carthagent');
    if (current?.state.status === 'active') break;
    if (current?.state.status === 'error') throw new Error(`Carthagent plugin setup failed: ${JSON.stringify(current)}`);
    await new Promise((done) => setTimeout(done, 200));
  } while (Date.now() < deadline);
  const nativePlugin = plugins.data.find((entry) => entry.id === 'carthagent');
  assert.ok(nativePlugin, `Carthagent plugin must become visible: ${JSON.stringify(plugins.data)}`);
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
  assert.ok(ship.methods.some(({ type, names }) => type === 'env' && names?.includes('EXPLABS_API_KEY')),
    'the native integration catalog resolves BYOK from the named environment credential');
  const models = await client.model.list({ location: { directory: cwd } }, request);
  const serializedInventory = JSON.stringify({ providers: providers.data, models: models.data, integrations: integrations.data });
  assert.equal(serializedInventory.includes(providerKey), false, 'provider and integration inventories must not expose the environment secret');
  assert.equal(output.includes(providerKey), false, 'OpenCode/plugin logs must not expose the environment secret');
  assert.ok(models.data.some(model => model.providerID === 'experiential-labs' && model.id === 'sentinel-model'),
    'environment-backed Ship model must be available through native model inventory');
  const inferenceSession = await client.session.create({
    location: { directory: cwd },
    title: 'CTG BYOK auth fixture',
    model: { id: 'sentinel-model', providerID: 'experiential-labs' },
  }, request);
  await client.session.prompt({ sessionID: inferenceSession.id, text: 'Reply with ok.' }, request);
  const inferenceDeadline = Date.now() + 10_000;
  while (!gatewayAuth.some(({ authorization, url }) => authorization === `Bearer ${providerKey}` && url.endsWith('/chat/completions')) && Date.now() < inferenceDeadline) {
    await new Promise(done => setTimeout(done, 50));
  }
  assert.ok(gatewayAuth.some(({ authorization, url }) => authorization === `Bearer ${providerKey}` && url.endsWith('/chat/completions')),
    'the native-resolved key must authenticate an actual provider inference request');
  console.log(JSON.stringify({ providers: providers.data.map((provider) => provider.id), shipMethods: ship.methods.map(({ id, type, names }) => ({ id, type, names })) }));
  const health = await client.rpc.call({
    rpcID: 'carthagent', method: 'health', input: {}, location: { directory: cwd },
  }, request);
  assert.equal(health.output.hostVersion, runtimeIdentity.runtimeVersion);
  console.log(JSON.stringify({ version: info.version, compatibilityVersion: runtimeIdentity.compatibilityVersion, plugin: nativePlugin, health }, null, 2));
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
  assert.equal(wrappedRun.outcome, 'succeeded');
  assert.equal(wrappedRun.terminal, true, 'native wrapper must return a projected terminal session outcome');
  assert.equal(wrappedRun.budgetReason, undefined, 'a successful terminal turn must not carry a budget failure reason');
  assert.ok(assistant, 'headless prompt must produce an assistant response');
  assert.equal(assistant.finish, 'stop');
  assert.equal(assistant.content.filter((part) => part.type === 'text').map((part) => part.text).join(''), 'CTG_FIXTURE_OK');
  assert.equal(wrappedRun.accepted.type, 'user');
  assert.ok(wrappedRun.messages.length >= 2);
  assert.ok(fixtureRequests > 0, 'assistant prompt must reach the local fixture endpoint');
  const secondRun = await runHeadless(ensuredService, cwd, 'WRAPPER_SECOND', { sessionID: session.id, timeout: 90_000 });
  assert.equal(secondRun.outcome, 'succeeded');
  assert.equal(secondRun.result.text, 'SECOND_TURN', 'resumed wrapper calls must select the current turn output');
  assert.equal(secondRun.budgetReason, undefined, 'a successful resumed turn must not carry a budget failure reason');
  let failedRun;
  try { failedRun = await runHeadless(ensuredService, cwd, 'WRAPPER_FAILURE', { sessionID: session.id, timeout: 90_000 }); }
  catch (error) { failedRun = { error }; }
  assert.ok(failedRun.error || failedRun.outcome === 'failed' || failedRun.session?.outcome === 'failed', `provider failure should be exposed, not hidden by prior output: ${JSON.stringify(failedRun)}`);
  const recoveredRun = await runHeadless(ensuredService, cwd, 'WRAPPER_SECOND', { sessionID: session.id, timeout: 90_000 });
  assert.equal(recoveredRun.outcome, 'succeeded');
  assert.equal(recoveredRun.result.text, 'SECOND_TURN');
  await writeFile(join(cwd, 'wrapper-tool.txt'), 'Read this through the native tool.\n');
  const toolRun = await runHeadless(ensuredService, cwd, 'WRAPPER_TOOL', { timeout: 90_000 });
  assert.equal(toolRun.outcome, 'succeeded');
  assert.equal(toolRun.result.text, 'FINAL_AFTER_TOOL', 'must return the final assistant response after the read tool, not its tool-call message');
  const unavailableRun = await runHeadless(ensuredService, cwd, 'UNAVAILABLE_MODEL', {
    timeout: 30_000,
    session: { model: { providerID: 'absent-fixture', id: 'missing' } },
  });
  assert.equal(unavailableRun.outcome, 'failed', `missing provider must be exposed as a terminal failure: ${JSON.stringify(unavailableRun)}`);
  assert.equal(unavailableRun.terminal, true);
  assert.ok(unavailableRun.error || unavailableRun.session.error, 'missing provider failure should preserve a useful error');
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
    attached.once('close', (code, signal) => {
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
  const archiveCall = (method, input) => client.rpc.call({
    rpcID: 'carthagent.archive', method, input, location: { directory: cwd },
  }, request);
  const listed = await archiveCall('list', {});
  assert.equal(listed.output.total, 1);
  const archiveID = listed.output.items[0].id;
  assert.match(archiveID, /^[a-f0-9]{64}$/);
  assert.equal('path' in listed.output.items[0], false);
  const searched = await archiveCall('search', { query: 'needle' });
  assert.equal(searched.output.items[0].id, archiveID);
  const transcript = await archiveCall('read', { id: archiveID });
  assert.equal(transcript.output.archiveOnly, true);
  assert.equal(transcript.output.records.length, 2);
  assert.deepEqual(transcript.output.malformedLines, [{ line: 3 }]);
  const exported = await archiveCall('export', { id: archiveID, format: 'jsonl' });
  assert.match(exported.output.content, /legacy-fixture/);
  await assert.rejects(archiveCall('read', { id: join(temp, 'outside.jsonl') }), (error) => error.type === 'archive_error');
  await assert.rejects(archiveCall('search', { query: '   ' }), (error) => error.type === 'archive_error');
  await assert.rejects(archiveCall('list', { limit: 101 }), (error) => error.type === 'rpc.invalid_input');
  assert.equal(await readFile(join(legacy, 'legacy.jsonl'), 'utf8'), '{"type":"session","id":"legacy-fixture"}\n{"type":"message","message":{"role":"user","content":"fixture needle"}}\nmalformed\n');
  console.log(`Native plugin, archive RPC methods, output schemas, and declared failures passed against OpenCode ${runtimeIdentity.runtimeVersion} (compatibility ${runtimeIdentity.compatibilityVersion}).`);
} catch (error) {
  console.error(JSON.stringify({ fixtureRequests }));
  console.error(output.replaceAll(password, '[redacted]'));
  throw error;
} finally {
  if (child) {
    const closed = childClosed ? Promise.resolve() : once(child, 'close');
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform === 'win32') {
        // This PID is the exact host process spawned above; /T is needed to
        // close any descendants that can keep the temporary workspace locked.
        await execFileAsync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F']).catch(() => {});
      } else {
        child.kill('SIGTERM');
        const timer = setTimeout(() => {
          if (!childClosed && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        }, 5_000);
        await closed;
        clearTimeout(timer);
      }
      if (!childClosed) await closed;
    } else {
      await closed;
    }
  }
  await new Promise((resolveClose) => fixture.close(resolveClose));
  await new Promise((resolveClose) => authServer.close(resolveClose));
  await new Promise((resolveClose) => gatewayServer.close(resolveClose));
  await rm(temp, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
}

function ownedRuntimeBinary(directory) {
  const key = process.platform === 'win32' ? `windows-${process.arch}` : `${process.platform}-${process.arch}`;
  return join(resolve(directory), `cli-${key}`, 'bin', process.platform === 'win32' ? 'opencode.exe' : 'opencode');
}
