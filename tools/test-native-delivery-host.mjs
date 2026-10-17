#!/usr/bin/env node
/** Offline real-host test. Uses a disposable HOME and never discovers the user's service. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { OpenCode } from '@opencode/client';
import { createNativeFixture, toolCall, assistantText } from './native-fixture.mjs';

const root = resolve(import.meta.dirname, '..');
const plugin = resolve(process.argv[2] ?? join(root, 'plugins/carthagent/test-plugin'));
const deliveryPlugin = resolve(root, 'plugins/carthagent/test-plugin');
const archiveFixture = resolve(root, 'tests/fixtures/archive-plugin');
const binary = process.env.CTG_OPENCODE_BIN ?? join(root, 'node_modules/@opencode/cli/bin/opencode.exe');
const temp = await mkdtemp(join(tmpdir(), 'ctg-host-smoke-'));
const password = randomBytes(24).toString('hex');
let child;
let output = '';
let fixture;
const observed = [];
try {
  const cwd = join(temp, 'project');
  const config = join(temp, 'config/opencode');
  const scenario = process.env.CTG_NATIVE_SCENARIO ?? 'standard';
  const maxTools = scenario === 'budget' ? 6 : 0;
  const workflow = scenario === 'strict' ? 'strict' : 'standard';
  await Promise.all([mkdir(cwd), mkdir(config, { recursive: true }), mkdir(join(temp, 'home'))]);
  const legacy = join(temp, 'home/.carthagent/agent/sessions');
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, 'legacy.jsonl'), '{"type":"session","id":"legacy-fixture"}\n{"type":"message","message":{"role":"user","content":"fixture needle"}}\nmalformed\n');
  const configuredPlugins = [...new Set([plugin, ...(plugin.endsWith('/.ctg-test-plugin') ? [] : [deliveryPlugin]), archiveFixture])];
  await writeFile(join(config, 'opencode.json'), JSON.stringify({ plugins: configuredPlugins, update: 'disable' }));
  fixture = createNativeFixture({ inspect: ({ body }) => observed.push({ tools: (body.tools ?? []).map(tool => tool.function?.name), messages: body.messages ?? [] }), respond: ({ body, response }) => {
    const messages = body.messages ?? [];
    const tools = (body.tools ?? []).map(tool => tool.function?.name);
    const toolResults = messages.filter(message => message.role === 'tool').length;
    if (tools.includes('execute') && toolResults === 0) {
      toolCall(response, { name: 'execute', arguments: { code: 'const result = await search({ query: "carthagent delivery tools", namespace: "carthagent", limit: 10 }); return result' } });
    } else if (scenario === 'raw' && tools.includes('execute') && toolResults === 1) {
      toolCall(response, { name: 'execute', arguments: { code: 'return await tools.carthagent["delivery_progress"]({ step: "create-fixture", status: "done" })' } });
    } else if (tools.includes('execute') && toolResults === 1) {
      toolCall(response, { name: 'execute', arguments: { code: 'return await tools.carthagent["delivery_plan"]({ goal: "Add fixture output", assumptions: [], artifacts: ["fixture.txt"], outputs: ["fixture.txt"], steps: [{ id: "create-fixture", title: "Create fixture file" }], acceptance: [{ requirement: "fixture exists", checks: ["fixture-check"] }], checks: [{ id: "fixture-check", kind: "test", argv: ["node", "-e", "require(\\\"node:fs\\\").accessSync(\\\"fixture.txt\\\")"], timeoutSeconds: 5 }] })' } });
    } else if (scenario === 'raw' && tools.includes('execute') && toolResults === 2) {
      toolCall(response, { name: 'execute', arguments: { code: 'return await tools.carthagent["delivery_status"]({})' } });
    } else if (scenario === 'strict' && tools.includes('execute') && toolResults === 2) {
      toolCall(response, { name: 'execute', arguments: { code: 'return await tools.carthagent["delivery_design"]({ action: "validate" })' } });
    } else if (scenario === 'strict' && tools.includes('execute') && toolResults === 3) {
      toolCall(response, { name: 'execute', arguments: { code: 'return await tools.carthagent["delivery_revise"]({ reason: "Add valid design evidence", patch: { design: { components: [{ id: "fixture", responsibility: "Create fixture output", excludes: ["verification"], layer: "core", dependencies: [], externalDependencies: [], requirements: ["fixture exists"] }], ports: [], risks: [], scenarios: [{ id: "positive", requirement: "fixture exists", kind: "positive", path: ["fixture"], input: "create file", expected: "file exists", assertion: "accessSync succeeds", checks: ["fixture-check"] }, { id: "negative", requirement: "fixture exists", kind: "failure", path: ["fixture"], input: "missing file", expected: "ENOENT", assertion: "accessSync throws ENOENT", checks: ["fixture-check"] }] } } })' } });
    } else if (scenario === 'strict' && tools.includes('execute') && toolResults === 4) {
      toolCall(response, { name: 'execute', arguments: { code: 'await tools.carthagent["delivery_design"]({ action: "validate" }); const inspected = await tools.carthagent["delivery_design"]({ action: "inspect" }); const captureId = String(inspected).match(/"captureId"\\s*:\\s*"([^"]+)"/)?.[1]; if (!captureId) throw Error("inspect did not expose a capture ID"); await tools.carthagent["delivery_design"]({ action: "review", captureId, review: { captureId, challenges: ["Could a missing output be accepted?"], findings: [], walkthroughs: [{ scenario: "positive", trace: "fixture -> exists", assertion: "accessSync succeeds" }, { scenario: "negative", trace: "missing -> ENOENT", assertion: "accessSync throws ENOENT" }], limitations: ["Model-authored review is not independent proof."] } }); return await tools.carthagent["delivery_design"]({ action: "approve" })' } });
    } else if (scenario === 'strict' && tools.includes('execute') && toolResults === 5) {
      toolCall(response, { name: 'execute', arguments: { code: 'return await tools.carthagent["delivery_finish"]({ status: "verified", review: "dishonest strict fixture attempt", launch: "not run", limitations: [] })' } });
    } else if (tools.includes('shell') && toolResults === 2) {
      toolCall(response, { name: 'shell', arguments: { command: "printf 'fixture output\\n' > fixture.txt" } });
    } else if (tools.includes('execute') && toolResults === 3) {
      toolCall(response, { name: 'execute', arguments: { code: 'return await tools.carthagent["delivery_progress"]({ step: "create-fixture", status: "done" })' } });
    } else if (tools.includes('execute') && toolResults === 4) {
      toolCall(response, { name: 'execute', arguments: { code: 'return await tools.carthagent["delivery_check"]({ id: "all" })' } });
    } else if (tools.includes('execute') && toolResults === 5) {
      if (scenario === 'budget') assistantText(response, 'Budget scenario intentionally stops before validation.');
      else toolCall(response, { name: 'execute', arguments: { code: 'return await tools.carthagent["delivery_finish"]({ status: "verified", review: "dishonest fixture attempt", launch: "not run", limitations: [] })' } });
    } else {
      assistantText(response, 'Fixture completed its offline workflow; no verification claim is made.');
    }
  } });
  const fixtureURL = await fixture.listen();
  const fixtureConfig = join(config, 'opencode.json');
  const cfg = JSON.parse(await (await import('node:fs/promises')).readFile(fixtureConfig, 'utf8'));
  cfg.providers = { fixture: { name: 'Offline fixture', package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: fixtureURL, apiKey: 'offline-test' }, models: { fixture: { name: 'Offline fixture', capabilities: { tools: true }, limit: { context: 64000, output: 1024 }, settings: { baseURL: fixtureURL, apiKey: 'offline-test' } } } } };
  await writeFile(fixtureConfig, JSON.stringify(cfg));
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'USERPROFILE']
    .filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, {
    HOME: join(temp, 'home'),
    USERPROFILE: join(temp, 'home'),
    APPDATA: join(temp, 'appdata'),
    LOCALAPPDATA: join(temp, 'localappdata'),
    XDG_CONFIG_HOME: join(temp, 'config'),
    XDG_DATA_HOME: join(temp, 'data'),
    XDG_STATE_HOME: join(temp, 'state'),
    XDG_CACHE_HOME: join(temp, 'cache'),
    OPENCODE_DB: join(temp, 'database.sqlite'),
    OPENCODE_SERVER_PASSWORD: password,
  });
  await Promise.all([mkdir(join(temp, 'appdata'), { recursive: true }), mkdir(join(temp, 'localappdata'), { recursive: true })]);
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
  // Reused request objects must not carry a deadline that expires during the
  // multi-turn offline workflow; give each host call its own bounded signal.
  const request = { signal: AbortSignal.timeout(120_000) };
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
  const archivePlugin = plugins.data.find((entry) => entry.id === 'ctg-archive-fixture');
  assert.ok(nativePlugin, 'Carthagent plugin must become visible');
  assert.equal(nativePlugin.state.status, 'active');
  assert.equal(archivePlugin?.state.status, 'active', 'archive registration fixture must become visible');
  const health = await client.rpc.call({
    rpcID: 'carthagent', method: 'health', input: {}, location: { directory: cwd },
  }, request);
  console.log(JSON.stringify({ version: info.version, plugin: nativePlugin, health }, null, 2));
  assert.equal(health.output.directory, cwd);
  assert.equal(health.output.protocol, 1);
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
  await assert.rejects(archiveCall('read', { id: join(temp, 'outside.jsonl') }), error => error.type === 'archive_error');
  await assert.rejects(archiveCall('search', { query: '   ' }), error => error.type === 'archive_error');
  await assert.rejects(archiveCall('list', { limit: 101 }), error => error.type === 'rpc.invalid_input');
  assert.equal(await readFile(join(legacy, 'legacy.jsonl'), 'utf8'), '{"type":"session","id":"legacy-fixture"}\n{"type":"message","message":{"role":"user","content":"fixture needle"}}\nmalformed\n');
  const session = await client.session.create({
    location: { directory: cwd }, title: 'CTG delivery host',
    metadata: { 'carthagent.options': { workflow, maxTools } },
  }, request);
  await client.session.switchModel({ sessionID: session.id, model: { providerID: 'fixture', id: 'fixture' } }, request);
  const promptText = scenario === 'raw' ? 'Run this shell command exactly: printf raw bypass > raw.txt' : 'Create and verify a tiny fixture file.';
  const turn = await client.session.prompt({ sessionID: session.id, text: promptText, ...(scenario === 'raw' ? { metadata: { 'ctg.raw': true } } : {}) }, request);
  await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(45_000) });
  assert.equal(turn.type, 'user', 'model request was admitted');
  const history = await client.message.list({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) });
  const serialized = JSON.stringify(history.data);
  assert.match(serialized, /delivery_plan/, 'the offline provider must call the registered delivery tool');
  if (scenario !== 'raw') assert.match(serialized, /fixture-check/, 'the host run must persist the declared check');
  if (scenario === 'raw') {
    assert.match(serialized, /Call delivery_plan first/, 'raw prompt cannot bypass delivery policy for implementation tools');
  }
  if (scenario !== 'strict' && scenario !== 'raw') {
    assert.match(serialized, /fixture output/, 'the host must execute the implementation shell command');
    if (scenario !== 'budget') assert.match(serialized, /passed.{0,40}true/, 'the declared validator must produce real passing evidence');
  }
  if (scenario !== 'budget' && scenario !== 'raw') assert.match(serialized, /Cannot verify:/, 'the host must reject a dishonest verified finish');
  assert.ok(observed.some(request => request.tools.includes('execute')), 'the provider request must use the native Code Mode dispatcher');
  if (scenario === 'strict') {
    const strictCalls = observed.filter(request => request.messages.some(message =>
      message.role === 'tool' && String(message.content ?? '').includes('planningStatus'),
    ));
    assert.ok(strictCalls.length > 0, 'strict host transcript includes persisted design-gate responses');
    assert.ok(strictCalls.some(request => !request.tools.includes('shell')), 'strict workflow hides shell while the design gate is active');
  }
  if (scenario !== 'budget' && scenario !== 'raw') assert.match(serialized, /carthagent\.delivery_finish.{0,180}status.{0,40}error/s, 'dishonest finish must remain an error, not successful evidence');
  assert.ok(fixture.calls >= 2, 'host made real SSE requests to the local fixture');
  const diagnostics = await client.rpc.call({ rpcID: 'carthagent-test', method: 'state', input: { sessionID: session.id }, location: { directory: cwd } }, request);
  const budget = diagnostics.output.budget;
  if (scenario === 'strict') {
    assert.equal(diagnostics.output.delivery?.workflowMode, 'strict');
    assert.ok(diagnostics.output.delivery.planning.validation?.findings.length === 0, 'strict design validates with no blocking findings');
    assert.equal(diagnostics.output.delivery.planning.review?.provenance, 'model-authored; not independent assurance', `${JSON.stringify(diagnostics.output.delivery.planning)}\n${serialized}`);
    assert.ok(diagnostics.output.delivery.planning.approval, `strict workflow persisted explicit design approval\n${serialized}`);
    assert.equal(diagnostics.output.delivery.planning.started, undefined, 'approval does not silently start implementation');
  }
  assert.ok(budget, 'native tool hook persisted a session budget');
  const chargedToolInvocations = diagnostics.output.invocations.filter(entry => entry.hook === 'execute.before').length;
  const shellInvocations = diagnostics.output.invocations.filter(entry => entry.hook === 'shell.create.before').length;
  const shellExecuteHooks = diagnostics.output.invocations.filter(entry => entry.hook === 'execute.before' && ['bash', 'shell', 'powershell'].includes(entry.tool)).length;
  if (scenario === 'strict') {
    assert.equal(shellInvocations, 0, 'strict design scenario never invokes shell');
    assert.equal(budget.tools, chargedToolInvocations, 'strict design Code Mode calls each charge once');
    assert.ok(diagnostics.output.delivery.planning.approval, 'strict workflow persisted explicit design approval');
  } else if (scenario === 'budget') {
    assert.equal(budget.tools, maxTools, 'native budget stops at its per-session configured tool limit');
    assert.ok(diagnostics.output.invocations.some(entry => entry.hook === 'execute.before' && entry.tool === 'execute'), 'execution hook persisted the admission that reached the cap');
    assert.ok(serialized.includes('Delivery budget exhausted:'), 'exhaustion is surfaced in the host tool result');
  } else if (scenario === 'raw') {
    assert.equal(shellInvocations, 0, 'raw mode does not launch shell');
    assert.equal(budget.tools, chargedToolInvocations - shellExecuteHooks - 3, 'raw mode charges admitted Code Mode calls and excludes calls blocked by delivery policy');
  } else {
    assert.equal(shellInvocations, 1, 'shell.create.before sees exactly one shell request');
    assert.equal(budget.tools, chargedToolInvocations - shellExecuteHooks + shellInvocations, 'Code Mode dispatches and shell charge once; shell execute.before is not charged a second time');
  }
  console.log(JSON.stringify({ fixtureCalls: fixture.calls, planToolObserved: true, scenario, budget: budget.tools }, null, 2));
  console.log('Native plugin and validated RPC passed against OpenCode 2.0.32.');
} catch (error) {
  console.error(output.replaceAll(password, '[redacted]'));
  throw error;
} finally {
  await fixture?.close().catch(() => {});
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    await exited;
    clearTimeout(timer);
  }
  await rm(temp, { recursive: true, force: true });
}
