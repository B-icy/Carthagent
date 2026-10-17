import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { nativeCommandConfig } from '../lib/opencode/compatibility.mjs';
import { provisionRuntime, resolveOpenCode, runtimeEnvironment, runtimePaths, workspaceEnvironment } from '../lib/opencode/runtime.mjs';
import { createSession, ensureService, promptSession, serviceRequest, setSessionEnvironment, stopService } from '../lib/opencode/service.mjs';
import { runHeadless } from '../lib/opencode/headless.mjs';

test('CTG runtime paths and env are isolated from host OpenCode roots', () => {
  const root = path.join(os.tmpdir(), 'ctg-test-profile');
  const paths = runtimePaths({ root });
  const env = runtimeEnvironment({ root, env: { ANTHROPIC_API_KEY: 'test' } });
  assert.equal(env.XDG_CONFIG_HOME, paths.config);
  assert.equal(env.XDG_DATA_HOME, paths.data);
  assert.equal(env.XDG_STATE_HOME, paths.state);
  assert.equal(env.XDG_CACHE_HOME, paths.cache);
  assert.equal(env.HOME, paths.home);
  assert.equal(env.OPENCODE_TEST_HOME, paths.home);
  assert.equal(env.OPENCODE_CONFIG_DIR, paths.configDir);
  assert.equal(env.OPENCODE_CONFIG_PROJECT_DISABLE, 'true');
  assert.equal(env.OPENCODE_DB, path.join(paths.data, 'opencode.db'));
  assert.equal(env.ANTHROPIC_API_KEY, 'test');
  assert.equal(env.OPENCODE_CUSTOM_CONFIG, undefined);
  assert.notEqual(paths.serviceFile, path.join(os.homedir(), '.local/state/opencode/service.json'));
});

test('runtime removes inherited OpenCode profile overrides', () => {
  const env = runtimeEnvironment({ root: '/tmp/ctg-isolated', env: {
    OPENCODE_CONFIG_DIR: '/user/config',
    OPENCODE_CONFIG: '/user/opencode.json',
    OPENCODE_CONFIG_PROJECT_DISABLE: 'false',
    OPENCODE_SERVER_PASSWORD: 'user-service-secret',
    OPENAI_API_KEY: 'preserved',
  } });
  assert.equal(env.OPENCODE_CONFIG_DIR, '/tmp/ctg-isolated/config/opencode');
  assert.equal(env.OPENCODE_CONFIG, '/tmp/ctg-isolated/config/opencode/opencode.json');
  assert.equal(env.OPENCODE_CONFIG_PROJECT_DISABLE, 'true');
  assert.equal(env.OPENCODE_SERVER_PASSWORD, undefined);
  assert.equal(env.OPENAI_API_KEY, 'preserved');
});

test('profile provisioning creates private isolated profile and absolute plugin reference', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctg-runtime-'));
  try {
    const paths = await provisionRuntime({ root, pluginPath: path.join(root, 'plugins/carthagent'), profile: { model: 'fake/test' } });
    const config = JSON.parse(await readFile(paths.configFile, 'utf8'));
    assert.equal(config.model, 'fake/test');
    assert.deepEqual(config.plugins, [path.join(root, 'plugins/carthagent')]);
    assert.equal((await stat(paths.configFile)).mode & 0o777, 0o600);
    await writeFile(paths.configFile, JSON.stringify({ model: 'kept/model', plugins: ['kept-plugin'], commands: { keep: 'hello' } }));
    await provisionRuntime({ root, pluginPath: path.join(root, 'plugins/carthagent'), profile: { theme: 'kept-theme' } });
    const updated = JSON.parse(await readFile(paths.configFile, 'utf8'));
    assert.equal(updated.model, 'kept/model');
    assert.equal(updated.theme, 'kept-theme');
    assert.deepEqual(updated.commands, { keep: 'hello' });
    assert.deepEqual(updated.plugins, ['kept-plugin', path.join(root, 'plugins/carthagent')]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('workspace environment records workspace without leaking CTG XDG overrides', () => {
  const env = workspaceEnvironment('/tmp/workspace', { XDG_CONFIG_HOME: '/host/config', OPENAI_API_KEY: 'secret' });
  assert.equal(env.XDG_CONFIG_HOME, '/host/config');
  assert.equal(env.CTG_WORKSPACE, '/tmp/workspace');
  assert.equal(env.OPENAI_API_KEY, 'secret');
});

test('native slash command conversion validates and preserves template', () => {
  assert.deepEqual(nativeCommandConfig({ review: { description: 'Review', template: 'Inspect $ARGUMENTS', agent: 'build' } }), {
    review: { description: 'Review', template: 'Inspect $ARGUMENTS', agent: 'build' },
  });
  assert.throws(() => nativeCommandConfig({ 'Bad Name': 'no' }), /Invalid slash command/);
});

test('native API requests preserve structured responses and reject status failures', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('{"ok":true}', { status: 200 });
    assert.deepEqual(await serviceRequest({ url: 'http://127.0.0.1:1', headers: {} }, 'GET', '/api/info'), { ok: true });
    globalThis.fetch = async () => new Response('{"message":"bad"}', { status: 500 });
    await assert.rejects(serviceRequest({ url: 'http://127.0.0.1:1', headers: {} }, 'GET', '/api/info'), /failed \(500\)/);
  } finally { globalThis.fetch = original; }
});

test('session API helpers use the v2 envelope, prompt payload, and endpoint contracts', async () => {
  const original = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response('{"data":{"id":"ses_example"}}', { status: 200 });
    };
    const service = { url: 'http://127.0.0.1:1234', headers: {} };
    assert.deepEqual(await createSession(service, '/work'), { id: 'ses_example' });
    assert.equal(JSON.parse(calls[0].init.body).location.directory, '/work');
    await promptSession(service, 'ses_example', 'hello');
    assert.equal(new URL(calls[1].url).pathname, '/api/session/ses_example/prompt');
    assert.equal(JSON.parse(calls[1].init.body).text, 'hello');
    await setSessionEnvironment(service, 'ses_example', { API_KEY: 'fixture' }, { location: '/workspace' });
    assert.equal(calls[2].init.method, 'PUT');
    assert.equal(new URL(calls[2].url).pathname, '/api/session/ses_example/environment');
    assert.equal(JSON.parse(calls[2].init.body).variables.API_KEY, 'fixture');
    assert.equal(JSON.parse(calls[2].init.body).variables.CTG_WORKSPACE, '/workspace');
    assert.deepEqual(JSON.parse(new URL(calls[0].url).searchParams.get('location[directory]')), { directory: '/work' });
  } finally { globalThis.fetch = original; }
});

test('a live registered process is retained when health inspection fails', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctg-live-unhealthy-'));
  const paths = runtimePaths({ root });
  const original = globalThis.fetch;
  try {
    await provisionRuntime({ root });
    const record = { id: 'ctg-live', pid: process.pid, url: 'http://127.0.0.1:1', password: 'test', version: '2.0.32' };
    await writeFile(paths.serviceFile, JSON.stringify(record));
    globalThis.fetch = async () => { throw new Error('temporary outage'); };
    const options = { root, binary: '/missing/binary' };
    // stopService does not need to resolve an executable and must not discard ownership.
    await assert.rejects(stopService(options), /alive but its service identity cannot be verified/);
    assert.deepEqual(JSON.parse(await readFile(paths.serviceFile, 'utf8')), record);
  } finally { globalThis.fetch = original; await rm(root, { recursive: true, force: true }); }
});

test('ensure and stop serialize on the same lifecycle lock', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctg-lifecycle-race-'));
  const binary = path.join(root, 'fake-opencode');
  const script = `#!/usr/bin/env node\nif (process.argv[2] === '--version') { console.log('2.0.32'); process.exit(0); }\nconst http = require('node:http'); const server = http.createServer((req,res) => { if (req.url === '/api/info') { res.setHeader('content-type','application/json'); res.end(JSON.stringify({version:'2.0.32',pid:process.pid})); } else { res.statusCode=404; res.end(); } }); server.listen(Number(process.argv[process.argv.indexOf('--port')+1]), '127.0.0.1', () => console.log('server listening on http://127.0.0.1:'+server.address().port));\n`;
  try {
    await writeFile(binary, script, { mode: 0o700 });
    const options = { root, binary, startupTimeout: 5000, stopTimeout: 3000 };
    const [ensured, stopped] = await Promise.all([ensureService(options), stopService(options)]);
    assert.equal(typeof stopped, 'boolean');
    if (ensured?.pid) {
      // It either remains the correctly registered live service or stop removed it.
      const current = await readFile(runtimePaths({ root }).serviceFile, 'utf8').then(JSON.parse).catch(() => undefined);
      if (current) assert.equal(current.pid, ensured.pid);
    }
    await stopService(options).catch(() => {});
    assert.equal(await readFile(runtimePaths({ root }).serviceFile, 'utf8').then(JSON.parse).catch(() => undefined), undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('an explicitly selected unusable OpenCode binary does not fall back', async () => {
  await assert.rejects(resolveOpenCode({ binary: '/missing/ctg-opencode' }), /ENOENT|not found/i);
});

test('headless runner passes workspace environment and returns assistant content and status', async () => {
  const original = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, init = {}) => {
      const pathname = new URL(url).pathname;
      calls.push({ pathname, init });
      if (pathname === '/api/session') return new Response('{"data":{"id":"ses_headless"}}');
      if (pathname.endsWith('/environment')) return new Response(null, { status: 204 });
      if (pathname.endsWith('/prompt')) return new Response('{"data":{"id":"inbox_1"}}');
      if (pathname.endsWith('/wait')) return new Response(null, { status: 204 });
      if (pathname.endsWith('/message')) return new Response(JSON.stringify({ data: [{ type: 'assistant', finish: 'stop', content: [{ type: 'text', text: 'fixture result' }] }] }));
      throw new Error(`Unexpected endpoint ${pathname}`);
    };
    const result = await runHeadless({ url: 'http://127.0.0.1:3333', headers: {} }, '/workspace', 'say the fixture', { env: { FIXTURE_KEY: 'injected' } });
    assert.deepEqual(result.result, {
      status: 'stop',
      text: 'fixture result',
      error: undefined,
      message: { type: 'assistant', finish: 'stop', content: [{ type: 'text', text: 'fixture result' }] },
    });
    assert.equal(calls.find((call) => call.pathname.endsWith('/environment')).init.method, 'PUT');
    assert.equal(JSON.parse(calls.find((call) => call.pathname.endsWith('/environment')).init.body).variables.FIXTURE_KEY, 'injected');
    assert.equal(JSON.parse(calls.find((call) => call.pathname.endsWith('/prompt')).init.body).text, 'say the fixture');
  } finally { globalThis.fetch = original; }
});

test('aborting headless execution sends a native interrupt for that session', async () => {
  const original = globalThis.fetch;
  const paths = [];
  try {
    globalThis.fetch = async (url, init = {}) => {
      const pathname = new URL(url).pathname;
      paths.push(pathname);
      if (pathname === '/api/session') return new Response('{"data":{"id":"ses_cancel"}}');
      if (pathname.endsWith('/environment')) return new Response(null, { status: 204 });
      if (pathname.endsWith('/prompt')) return new Response('{"data":{"id":"inbox_cancel"}}');
      if (pathname.endsWith('/wait')) return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
      if (pathname.endsWith('/interrupt')) return new Response(null, { status: 204 });
      throw new Error(`Unexpected endpoint ${pathname}`);
    };
    const controller = new AbortController();
    const result = runHeadless({ url: 'http://127.0.0.1:3333', headers: {} }, '/workspace', 'wait', { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort(new Error('test cancellation'));
    await assert.rejects(result, /aborted|canceled|cancelled/i);
    assert.ok(paths.includes('/api/session/ses_cancel/interrupt'));
  } finally { globalThis.fetch = original; }
});
