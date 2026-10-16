import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { nativeCommandConfig } from '../lib/opencode/compatibility.mjs';
import { provisionRuntime, runtimeEnvironment, runtimePaths, workspaceEnvironment } from '../lib/opencode/runtime.mjs';
import { createSession, promptSession, serviceRequest } from '../lib/opencode/service.mjs';

test('CTG runtime paths and env are isolated from host OpenCode roots', () => {
  const root = path.join(os.tmpdir(), 'ctg-test-profile');
  const paths = runtimePaths({ root });
  const env = runtimeEnvironment({ root, env: { ANTHROPIC_API_KEY: 'test' } });
  assert.equal(env.XDG_CONFIG_HOME, paths.config);
  assert.equal(env.XDG_DATA_HOME, paths.data);
  assert.equal(env.XDG_STATE_HOME, paths.state);
  assert.equal(env.XDG_CACHE_HOME, paths.cache);
  assert.equal(env.OPENCODE_DB, path.join(paths.data, 'opencode.db'));
  assert.equal(env.ANTHROPIC_API_KEY, 'test');
  assert.notEqual(paths.serviceFile, path.join(os.homedir(), '.local/state/opencode/service.json'));
});

test('profile provisioning creates private isolated profile and absolute plugin reference', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctg-runtime-'));
  try {
    const paths = await provisionRuntime({ root, pluginPath: path.join(root, 'plugins/carthagent'), profile: { model: 'fake/test' } });
    const config = JSON.parse(await readFile(paths.configFile, 'utf8'));
    assert.equal(config.model, 'fake/test');
    assert.deepEqual(config.plugins, [path.join(root, 'plugins/carthagent')]);
    assert.equal((await stat(paths.configFile)).mode & 0o777, 0o600);
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
  } finally { globalThis.fetch = original; }
});
