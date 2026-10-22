#!/usr/bin/env node
/** Behavioral session/restart, auto-compaction, clear, and shell-origin proof on the owned host. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { OpenCode } from '@opencode/client';
import { preflightNativeTestRuntimeArtifact } from './native-runtime-identity.mjs';
import { resolveOpenCode, runtimeIdentity, provisionRuntime, runtimeEnvironment } from '../lib/opencode/runtime.mjs';

if (process.platform !== 'linux') throw new Error('This native shell provenance probe currently targets Linux; it is not a cross-platform acceptance claim.');
const installedDefault = process.argv.includes('--installed-default');
if (process.env.CTG_OPENCODE_BIN) throw new Error('Do not set CTG_OPENCODE_BIN for owned acceptance.');
if (process.env.CTG_TEST_RUNTIME_SHA256) throw new Error('Do not override the trusted release-manifest executable hash.');
if (installedDefault && (process.env.CTG_OWNED_OPENCODE_RUNTIME || process.env.CTG_TEST_RUNTIME_RELEASE_MANIFEST)) {
  throw new Error('Installed acceptance must use the packaged manifest and default runtime resolver without test overrides.');
}
const ownedRoot = installedDefault ? undefined : process.env.CTG_OWNED_OPENCODE_RUNTIME;
const trustedManifestPath = installedDefault
  ? fileURLToPath(new URL('../lib/opencode/runtime-release.json', import.meta.url))
  : process.env.CTG_TEST_RUNTIME_RELEASE_MANIFEST;
if (!installedDefault && !ownedRoot) throw new Error('Set CTG_OWNED_OPENCODE_RUNTIME to the owned runtime artifact root under test.');
if (!trustedManifestPath) throw new Error('A trusted release manifest is required for owned acceptance.');
const preflight = ownedRoot ? await preflightNativeTestRuntimeArtifact({ ownedRoot, expectedManifestPath: trustedManifestPath }) : null;
const runtimeOptions = { ...(ownedRoot ? { ownedRuntime: ownedRoot } : {}), runtimeReleaseManifestPath: trustedManifestPath };
const binary = await resolveOpenCode(runtimeOptions);
const identity = await runtimeIdentity(binary, runtimeOptions);
assert.equal(identity.kind, 'ctg-owned');
if (preflight) {
  assert.equal(identity.binaryPath, preflight.identity.binary, 'product resolver selected the preflighted artifact');
  assert.equal(identity.binarySha256, preflight.identity.binarySha256, 'product identity matches trusted pre-execution byte verification');
  assert.equal(identity.version, preflight.identity.runtimeVersion);
} else {
  assert.equal(identity.kind, 'ctg-owned', 'installed acceptance requires the production default resolver to select CTG-owned runtime');
  const { loadNativeTestRuntime } = await import('./native-runtime-identity.mjs');
  const expectedManifest = JSON.parse(await readFile(trustedManifestPath, 'utf8'));
  const verified = await loadNativeTestRuntime({ binary, ownedRoot: dirname(dirname(dirname(binary))), expectedManifest });
  assert.equal(verified.binary, binary);
  assert.equal(verified.binarySha256, identity.binarySha256);
}

const temp = await mkdtemp(join(tmpdir(), 'ctg-owned-controls-'));
const cwd = join(temp, 'project');
const root = join(temp, 'runtime');
const captureFile = join(temp, 'shell-hooks.jsonl');
const requests = [];
let rejectOverflow = true;
const provider = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw || '{}');
  requests.push(body);
  const serialized = JSON.stringify(body.messages ?? []);
  if (serialized.includes('You MUST use this format for your response')) return stream(res, '## Objective\n- preserve the fixture context');
  if (serialized.includes('OWNED_OVERFLOW') && rejectOverflow) {
    rejectOverflow = false;
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Your input exceeds the context window', code: 'context_length_exceeded', type: 'invalid_request_error' } }));
    return;
  }
  const user = [...(body.messages ?? [])].reverse().find(message => message.role === 'user');
  if (serialized.includes('owned-identical-shell') && !body.messages.some(message => message.role === 'tool')) {
    const calls = (body.tools ?? []).filter(tool => tool.function?.name === 'shell');
    assert.ok(calls.length, 'owned runtime must advertise native shell in the two provenance sessions');
    const callID = `identical-${requests.length}`;
    const userText = String([...body.messages].reverse().find(message => message.role === 'user')?.content ?? '');
    const marker = userText.includes('OWNED_SHELL_SESSION_A') ? 'A' : userText.includes('OWNED_SHELL_SESSION_B') ? 'B' : null;
    assert.ok(marker, `shell tool call has no known originating prompt marker: ${userText}`);
    providerToolCalls.set(marker, callID);
    const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: `same-command-${requests.length}`, object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`${chunk({ role: 'assistant', tool_calls: [{ index: 0, id: callID, type: 'function', function: { name: 'shell', arguments: JSON.stringify({ command: 'printf owned-identical-shell' }) } }] })}${chunk({}, 'tool_calls')}data: [DONE]\n\n`);
    return;
  }
  stream(res, `reply:${String(user?.content ?? '').slice(0, 60)}`);
});

let child;
let client;
let providerListening = false;
const providerToolCalls = new Map();
const password = `owned-${process.pid}-${Date.now()}`;
const request = () => ({ signal: AbortSignal.timeout(30_000) });
const start = async () => {
  const env = runtimeEnvironment({ root });
  env.OPENCODE_SERVER_PASSWORD = password;
  env.CTG_OWNED_SHELL_CAPTURE = captureFile;
  child = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', '0'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const baseUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`owned server startup timeout: ${output}`)), 30_000);
    const collect = chunk => {
      output = (output + chunk.toString()).slice(-8000);
      const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (url) { clearTimeout(timer); resolve(url); }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(Error(`owned server exited ${code}: ${output}`)); });
  });
  client = OpenCode.make({ baseUrl, headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } });
  const info = await client.server.info(request());
  assert.equal(info.version, identity.version);
  assert.equal(info.capabilities?.shellOrigin, true);
  return client;
};
const stop = async () => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  let exited = once(child, 'exit');
  child.kill('SIGTERM');
  let timer;
  const graceful = await Promise.race([exited.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 5000); })]);
  clearTimeout(timer);
  if (graceful) return;
  child.kill('SIGKILL');
  let forceTimer;
  try {
    await Promise.race([exited, new Promise((_, reject) => { forceTimer = setTimeout(() => reject(new Error('Owned host did not exit after SIGKILL')), 5000); })]);
  } finally { clearTimeout(forceTimer); }
};

try {
  await mkdir(cwd, { recursive: true });
  await new Promise((resolve, reject) => {
    provider.once('error', reject);
    provider.listen(0, '127.0.0.1', resolve);
  });
  providerListening = true;
  const providerUrl = `http://127.0.0.1:${provider.address().port}/v1`;
  const profile = {
    plugins: [{ package: join(import.meta.dirname, 'owned-shell-observer'), options: { captureFile } }],
    update: 'disable',
    model: 'ctg-fixture/fixture',
    default_agent: 'build',
    providers: { 'ctg-fixture': {
      package: '@opencode/ai/providers/openai-compatible',
      settings: { baseURL: providerUrl, apiKey: 'offline-fixture' },
      models: { fixture: { limit: { context: 32_000, output: 1024 }, cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } } },
    } },
  };
  await provisionRuntime({ root, profile });
  client = await start();
  const location = { directory: cwd };
  const model = { providerID: 'ctg-fixture', id: 'fixture' };
  const first = await client.session.create({ location, model, title: 'Owned restart policy A' }, request());
  const second = await client.session.create({ location, model, title: 'Owned restart policy B' }, request());
  await client.session.update({ sessionID: first.id, metadata: { 'ctg.autoCompaction': false } }, request());
  await client.session.update({ sessionID: second.id, metadata: { 'ctg.autoCompaction': true } }, request());
  await client.session.prompt({ sessionID: first.id, text: 'OWNED_AUTOCOMPACT_OFF initial' }, request());
  await client.session.prompt({ sessionID: second.id, text: 'OWNED_AUTOCOMPACT_ON initial' }, request());
  await Promise.all([client.session.wait({ sessionID: first.id }, request()), client.session.wait({ sessionID: second.id }, request())]);
  const beforeRestartA = await client.message.list({ sessionID: first.id }, request());
  const beforeRestartB = await client.message.list({ sessionID: second.id }, request());
  assert.ok(beforeRestartA.data.some(message => JSON.stringify(message).includes('OWNED_AUTOCOMPACT_OFF')));
  assert.ok(beforeRestartB.data.some(message => JSON.stringify(message).includes('OWNED_AUTOCOMPACT_ON')));

  await stop();
  const restarted = await start();
  assert.equal((await restarted.session.get({ sessionID: first.id }, request())).metadata['ctg.autoCompaction'], false);
  assert.equal((await restarted.session.get({ sessionID: second.id }, request())).metadata['ctg.autoCompaction'], true);

  requests.length = 0;
  rejectOverflow = true;
  await restarted.session.prompt({ sessionID: first.id, text: 'OWNED_OVERFLOW sessionA' }, request());
  await restarted.session.wait({ sessionID: first.id }, request());
  assert.equal(requests.length, 1, 'auto-compaction-off overflow must produce no summary or retry request');
  assert.equal((await restarted.session.get({ sessionID: first.id }, request())).outcome, 'failed');

  requests.length = 0;
  rejectOverflow = true;
  await restarted.session.prompt({ sessionID: second.id, text: 'OWNED_OVERFLOW sessionB' }, request());
  await restarted.session.wait({ sessionID: second.id }, request());
  const summaryIndex = requests.findIndex(body => JSON.stringify(body.messages).includes('You MUST use this format for your response'));
  const initialOverflowIndex = requests.findIndex(body => JSON.stringify(body.messages).includes('OWNED_OVERFLOW sessionB'));
  const retryIndex = requests.findIndex((body, index) => index > summaryIndex && JSON.stringify(body.messages).includes('OWNED_OVERFLOW sessionB'));
  assert.ok(initialOverflowIndex >= 0 && summaryIndex > initialOverflowIndex && retryIndex > summaryIndex,
    `expected overflow → summary → retry provider requests, got ${JSON.stringify(requests.map(body => body.messages))}`);
  assert.equal((await restarted.session.get({ sessionID: second.id }, request())).outcome, 'succeeded');

  const same1 = await restarted.session.create({ location, model, title: 'Concurrent identical shell A', metadata: { 'ctg.autoCompaction': false } }, request());
  const same2 = await restarted.session.create({ location, model, title: 'Concurrent identical shell B', metadata: { 'ctg.autoCompaction': false } }, request());
  const prompts = [
    { session: same1, marker: 'A' },
    { session: same2, marker: 'B' },
  ];
  const pluginList = await restarted.plugin.list({ location }, request());
  assert.ok(pluginList.data.some(plugin => plugin.id === 'ctg.owned-shell-observer' && plugin.state.status === 'active'), JSON.stringify(pluginList.data));
  await Promise.all([
    restarted.session.prompt({ sessionID: same1.id, text: 'OWNED_SHELL_SESSION_A Run shell command: node -e "process.stdout.write(\'owned-identical-shell\')"' }, request()),
    restarted.session.prompt({ sessionID: same2.id, text: 'OWNED_SHELL_SESSION_B Run shell command: node -e "process.stdout.write(\'owned-identical-shell\')"' }, request()),
  ]);
  await Promise.all([restarted.session.wait({ sessionID: same1.id }, request()), restarted.session.wait({ sessionID: same2.id }, request())]);
  for (const { session } of prompts) assert.equal((await restarted.session.get({ sessionID: session.id }, request())).outcome, 'succeeded');
  let capturedText;
  try { capturedText = await readFile(captureFile, 'utf8'); }
  catch (error) { throw new Error(`shell observer did not record a hook event; provider requests=${JSON.stringify(requests.map(body => body.messages?.slice(-2)))}; session tools=${JSON.stringify(await Promise.all([same1, same2].map(session => restarted.message.list({ sessionID: session.id }, request()))))}`, { cause: error }); }
  const shellEvents = capturedText.trim().split('\n').filter(Boolean).map(JSON.parse);
  const attributed = shellEvents.filter(event => event.command.includes('owned-identical-shell'));
  assert.equal(attributed.length, 2, JSON.stringify(shellEvents));
  const observations = new Map(attributed.map(event => [event.sessionID, event]));
  for (const { session, marker } of prompts) {
    const observed = observations.get(session.id);
    assert.ok(observed, `missing shell hook event for ${session.id}: ${JSON.stringify(attributed)}`);
    assert.equal(observed.origin, 'tool');
    assert.equal(observed.callID, providerToolCalls.get(marker), `hook call ID matches the native provider call ID for marker ${marker}`);
    const history = await restarted.message.list({ sessionID: session.id }, request());
    const toolParts = history.data.flatMap(message => message.parts ?? message.content ?? []).filter(part => part.type === 'tool' && part.id === providerToolCalls.get(marker));
    assert.equal(toolParts.length, 1, `durable tool transcript correlates to provider call for session ${session.id}: ${JSON.stringify(history.data)}`);
    assert.equal(toolParts[0].state.status, 'completed', JSON.stringify(toolParts[0]));
    assert.equal(toolParts[0].state.input.command, observed.command);
    assert.ok(toolParts[0].state.content.some(part => part.type === 'text' && part.text.includes('owned-identical-shell')));
  }

  console.log(JSON.stringify({
    host: { compatibilityVersion: preflight?.identity.compatibilityVersion ?? identity.compatibilityVersion, runtimeVersion: identity.version, binarySha256: identity.binarySha256 },
    runtimeSelection: installedDefault ? 'installed package default resolver; trusted manifest verified' : 'explicit, trusted-preflighted CTG_OWNED_OPENCODE_RUNTIME staging artifact',
    sameDatabaseServiceRestart: 'passed',
    autoCompaction: { off: 'overflow failed with one provider attempt and no compaction', on: 'compaction request and successful retry observed' },
    concurrentIdenticalShell: 'real runtime events correlated to distinct sessionID/origin/callID',
    loopbackProviderRequests: requests.length,
  }));
} finally {
  await stop();
  provider.closeAllConnections();
  if (providerListening) await new Promise(resolve => provider.close(resolve));
  await rm(temp, { recursive: true, force: true });
}

function stream(res, text) {
  const chunk = (delta, finish_reason = null, usage) => `data: ${JSON.stringify({ id: `owned-${requests.length}`, object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) })}\n\n`;
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(`${chunk({ role: 'assistant', content: text })}${chunk({}, 'stop', { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 })}data: [DONE]\n\n`);
}
