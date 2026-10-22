#!/usr/bin/env node
/** Offline real-host test. Uses a disposable HOME and never discovers the user's service. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { OpenCode } from '@opencode/client';
import { resolveOpenCode, runtimeIdentity as getRuntimeIdentity } from '../lib/opencode/runtime.mjs';
import { createNativeFixture, toolCall, assistantText } from './native-fixture.mjs';
import { loadNativeTestRuntime, preflightNativeTestRuntimeArtifact } from './native-runtime-identity.mjs';
import { waitForPluginActive } from './native-plugin-readiness.mjs';

const root = resolve(import.meta.dirname, '..');
const plugin = resolve(process.argv[2] ?? join(root, 'plugins/carthagent'));
const productionPlugin = plugin.endsWith('/.ctg-production-plugin') ? resolve(plugin, '../plugins/carthagent/src/index.ts') : plugin.endsWith('/plugins/carthagent') ? resolve(plugin, 'src/index.ts') : plugin;
const archiveFixture = resolve(root, 'tests/fixtures/archive-plugin');
const runtimeOptions = {};
if (process.env.CTG_TEST_RUNTIME_RELEASE_MANIFEST) {
  runtimeOptions.runtimeReleaseManifestPath = process.env.CTG_TEST_RUNTIME_RELEASE_MANIFEST;
}
if (process.env.CTG_TEST_RUNTIME_ARTIFACT_ROOT) {
  await preflightNativeTestRuntimeArtifact({
    ownedRoot: process.env.CTG_TEST_RUNTIME_ARTIFACT_ROOT,
    expectedManifestPath: process.env.CTG_TEST_RUNTIME_RELEASE_MANIFEST,
  });
  runtimeOptions.acquireOwnedRuntime = async () => process.env.CTG_TEST_RUNTIME_ARTIFACT_ROOT;
}
const binary = await resolveOpenCode(runtimeOptions);
const productionIdentity = await getRuntimeIdentity(binary, runtimeOptions);
const ownedRoot = productionIdentity.kind === 'ctg-owned' ? dirname(dirname(dirname(binary))) : undefined;
const expectedManifest = ownedRoot ? JSON.parse(await readFile(process.env.CTG_TEST_RUNTIME_RELEASE_MANIFEST ?? join(root, 'lib/opencode/runtime-release.json'), 'utf8')) : undefined;
const runtimeIdentity = await loadNativeTestRuntime({ binary, ownedRoot, expectedManifest });
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
  const maxTools = ['budget', 'raw'].includes(scenario) ? 6 : scenario === 'concurrent' ? 10 : 0;
  const workflow = scenario === 'strict' ? 'strict' : 'standard';
  await Promise.all([mkdir(cwd), mkdir(config, { recursive: true }), mkdir(join(temp, 'home'))]);
  const legacy = join(temp, 'home/.carthagent/agent/sessions');
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, 'legacy.jsonl'), '{"type":"session","id":"legacy-fixture"}\n{"type":"message","message":{"role":"user","content":"fixture needle"}}\nmalformed\n');
  const composedPlugin = join(temp, 'production-composition');
  await mkdir(composedPlugin);
  await writeFile(join(composedPlugin, 'index.ts'), `
import { setupCarthagent } from ${JSON.stringify(productionPlugin)};
const invocations = [];
const interrupts = [];
const duplicateInvocations = [];
const Observer = { id: 'carthagent-delivery-observer', methods: { state: {
  input: { type: 'object', properties: { sessionID: { type: 'string' } }, required: ['sessionID'], additionalProperties: false },
  output: { type: 'object', properties: { budget: { type: ['object', 'null'], additionalProperties: true }, delivery: { type: ['object', 'null'], additionalProperties: true }, invocations: { type: 'array', items: { type: 'object', additionalProperties: true } }, duplicateInvocations: { type: 'array', items: { type: 'object', additionalProperties: true } }, interrupts: { type: 'array', items: { type: 'object', additionalProperties: true } }, tools: { type: 'array', items: { type: 'string' } } }, required: ['budget', 'delivery', 'invocations', 'duplicateInvocations', 'interrupts', 'tools'], additionalProperties: false },
} }, events: {} };
export default { id: 'carthagent', async setup(context) {
  const monitored = { ...context,
    tool: { ...context.tool, hook: async (name, callback) => context.tool.hook(name, async event => { if (name === 'execute.before') { const entry = { hook: name, sessionID: event.sessionID, tool: event.tool, agent: event.agent, id: event.id, messageID: event.messageID }; if (invocations.some(previous => previous.sessionID === entry.sessionID && previous.tool === entry.tool && previous.id === entry.id && previous.messageID === entry.messageID)) duplicateInvocations.push(entry); invocations.push(entry); } await callback(event); }) },
    shell: { ...context.shell, hook: async (name, callback) => context.shell.hook(name, async event => { if (name === 'create.before') invocations.push({ hook: 'shell.' + name, command: event.command }); await callback(event); }) },
    session: { ...context.session, interrupt: async input => { interrupts.push(input); return context.session.interrupt(input); } },
  };
  const cleanups = [];
  try {
    const scenarioOptions = JSON.parse(process.env.CTG_NATIVE_DELIVERY_OPTIONS || '{}');
    if (process.env.CTG_NATIVE_SCENARIO === 'strict') scenarioOptions.workflow = 'strict';
    cleanups.push(await setupCarthagent(monitored, { delivery: true, deliveryOptions: scenarioOptions }));
    const observer = await context.rpc.register(Observer, { state: async input => {
      const stored = await context.storage.get('session/' + input.sessionID);
      return { budget: stored && stored.budget ? { tools: stored.budget.tools, limits: stored.budget.limits, stopped: stored.budget.stopped } : null, delivery: stored && stored.state ? stored.state : null, invocations: invocations.filter(call => call.sessionID === input.sessionID), duplicateInvocations: duplicateInvocations.filter(call => call.sessionID === input.sessionID), interrupts: interrupts.filter(call => call.sessionID === input.sessionID), tools: (await context.tool.list()).map(tool => tool.id) };
    } });
    cleanups.push(() => observer.dispose());
    return async () => { for (const cleanup of cleanups.reverse()) await cleanup?.(); };
  } catch (error) { for (const cleanup of cleanups.reverse()) await cleanup?.(); throw error; }
} };
`);
  await writeFile(join(config, 'opencode.json'), JSON.stringify({ plugins: [composedPlugin, archiveFixture], update: 'disable' }));
  fixture = createNativeFixture({ inspect: ({ body }) => observed.push({ tools: (body.tools ?? []).map(tool => tool.function?.name), messages: body.messages ?? [] }), respond: ({ body, response }) => {
    const messages = body.messages ?? [];
    const tools = (body.tools ?? []).map(tool => tool.function?.name);
    const toolResults = messages.filter(message => message.role === 'tool').length;
    const latestUser = [...messages].reverse().find(message => message.role === 'user');
    if (JSON.stringify(latestUser).includes('CONCURRENT_IDENTICAL')) {
      if (tools.includes('shell') && toolResults === 0) toolCall(response, { name: 'shell', arguments: { command: 'printf concurrent > identical.txt' } });
      else assistantText(response, 'CONCURRENT_IDENTICAL_SHELL_OK');
    } else if (JSON.stringify(latestUser).includes('MIXED_DISABLED')) {
      if (tools.includes('shell') && toolResults === 0) toolCall(response, { name: 'shell', arguments: { command: "printf disabled-session > mixed-disabled.txt" } });
      else assistantText(response, 'DISABLED_SESSION_SHELL_OK');
    } else if (JSON.stringify(latestUser).includes('MODE_SHIP_PARITY')) {
      assistantText(response, 'MODE_SHIP_GUIDANCE_OK');
    } else if (scenario === 'budget' && toolResults >= 6) {
      toolCall(response, { name: 'execute', arguments: { code: 'return await tools.carthagent["delivery_status"]({})' } });
    } else if (tools.includes('execute') && toolResults === 0) {
      toolCall(response, { name: 'execute', arguments: { code: 'const result = await search({ query: "carthagent delivery tools", namespace: "carthagent", limit: 10 }); return result' } });
    } else if (scenario === 'raw' && tools.includes('shell') && toolResults === 1) {
      toolCall(response, { name: 'shell', arguments: { command: "printf 'fixture output\\n' > fixture.txt" } });
    } else if (scenario === 'raw' && toolResults >= 2) {
      assistantText(response, 'DISABLED_SESSION_SHELL_OK');
    } else if (tools.includes('execute') && toolResults === 1) {
      toolCall(response, { name: 'execute', arguments: { code: 'return await tools.carthagent["delivery_plan"]({ goal: "Add fixture output", assumptions: [], artifacts: ["fixture.txt"], outputs: ["fixture.txt"], steps: [{ id: "create-fixture", title: "Create fixture file" }], acceptance: [{ requirement: "fixture exists", checks: ["fixture-check"] }], checks: [{ id: "fixture-check", kind: "test", argv: ["node", "-e", "require(\\\"node:fs\\\").accessSync(\\\"fixture.txt\\\")"], timeoutSeconds: 5 }] })' } });
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
      if (scenario === 'budget') toolCall(response, { name: 'execute', arguments: { code: 'return await tools.carthagent["delivery_status"]({})' } });
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
  assert.equal(info.version, runtimeIdentity.runtimeVersion);
  const unauthorized = await fetch(`${endpoint}/api/info`, { signal: request.signal });
  assert.equal(unauthorized.status, 401);
  await client.session.create({ location: { directory: cwd }, title: 'CTG host smoke' }, request);
  const location = { directory: cwd };
  const listPlugins = async (timeoutMs) => client.plugin.list({ location }, { signal: AbortSignal.timeout(timeoutMs) });
  const readinessOptions = { listPlugins, timeoutMs: 15_000, hostOutput: () => output };
  const nativePlugin = await waitForPluginActive('carthagent', readinessOptions);
  await waitForPluginActive('ctg-archive-fixture', readinessOptions);
  const health = await client.rpc.call({
    rpcID: 'carthagent', method: 'health', input: {}, location: { directory: cwd },
  }, request);
  assert.equal(health.output.hostVersion, runtimeIdentity.runtimeVersion);
  console.log(JSON.stringify({ version: info.version, compatibilityVersion: runtimeIdentity.compatibilityVersion, plugin: nativePlugin, health }, null, 2));
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
    metadata: { 'carthagent.options': { workflow, maxTools, ...(['raw', 'concurrent'].includes(scenario) ? { delivery: false } : {}) } },
  }, request);
  await client.session.switchModel({ sessionID: session.id, model: { providerID: 'fixture', id: 'fixture' } }, request);
  if (scenario === 'concurrent') {
    const sibling = await client.session.create({ location: { directory: cwd }, title: 'CTG identical concurrent shell sibling', metadata: { 'carthagent.options': { delivery: false, maxTools: 10 } } }, request);
    await client.session.switchModel({ sessionID: sibling.id, model: { providerID: 'fixture', id: 'fixture' } }, request);
    const prompts = await Promise.all([
      client.session.prompt({ sessionID: session.id, text: 'CONCURRENT_IDENTICAL session one, run identical shell now.' }, request),
      client.session.prompt({ sessionID: sibling.id, text: 'CONCURRENT_IDENTICAL session two, run identical shell now.' }, request),
    ]);
    assert.ok(prompts.every(turn => turn.type === 'user'));
    await Promise.all([session.id, sibling.id].map(sessionID => client.session.wait({ sessionID }, { signal: AbortSignal.timeout(45_000) })));
    for (const sessionID of [session.id, sibling.id]) {
      const diagnostics = await client.rpc.call({ rpcID: 'carthagent-delivery-observer', method: 'state', input: { sessionID }, location: { directory: cwd } }, request);
      assert.equal(diagnostics.output.budget.tools, 1, 'identical same-worktree shell command is charged only to its invoking session');
      assert.equal(diagnostics.output.invocations.filter(entry => ['bash', 'shell', 'powershell'].includes(entry.tool)).length, 1);
    }
    assert.match(await readFile(join(cwd, 'identical.txt'), 'utf8'), /concurrent/);
    console.log(JSON.stringify({ scenario, identicalShellCalls: 2, independentSessionBudgets: true }, null, 2));
  } else {
  const promptText = scenario === 'raw' ? 'Run this shell command exactly: printf raw bypass > raw.txt' : 'Create and verify a tiny fixture file.';
  const turn = await client.session.prompt({ sessionID: session.id, text: promptText, ...(scenario === 'raw' ? { metadata: { 'ctg.raw': true } } : {}) }, request);
  await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(45_000) });
  assert.equal(turn.type, 'user', 'model request was admitted');
  const history = await client.message.list({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) });
  const serialized = JSON.stringify(history.data);
  if (scenario !== 'raw') assert.match(serialized, /delivery_plan/, 'the offline provider must call the registered delivery tool');
  if (scenario === 'raw') {
    assert.match(serialized, /DISABLED_SESSION_SHELL_OK/, 'delivery:false leaves native shell available');
  }
  if (scenario !== 'raw') assert.match(serialized, /fixture-check/, 'the host run must persist the declared check');
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
  const diagnostics = await client.rpc.call({ rpcID: 'carthagent-delivery-observer', method: 'state', input: { sessionID: session.id }, location: { directory: cwd } }, request);
  if (scenario !== 'raw') {
    assert.ok(diagnostics.output.tools.some(name => name.includes('delivery_plan')), 'production setup exposes optional delivery tools when composition enables delivery');
    assert.ok(diagnostics.output.tools.some(name => name.includes('code_nav')), 'production setup composes codegraph registration with delivery');
  }
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
  if (scenario === 'strict') {
    assert.equal(diagnostics.output.invocations.some(entry => ['bash', 'shell', 'powershell'].includes(entry.tool)), false, 'strict design scenario never invokes shell');
    assert.equal(budget.tools, chargedToolInvocations - diagnostics.output.duplicateInvocations.length, 'strict Code Mode calls charge once; hook re-entry is deduplicated');
    assert.ok(diagnostics.output.delivery.planning.approval, 'strict workflow persisted explicit design approval');
  } else if (scenario === 'budget') {
    assert.equal(budget.tools, maxTools, 'native budget stops at its per-session configured tool limit');
    assert.ok(diagnostics.output.invocations.some(entry => entry.hook === 'execute.before' && entry.tool === 'execute'), 'execution hook persisted the admission that reached the cap');
    assert.ok(diagnostics.output.budget.stopped, 'the host budget persists its stopped reason');
    assert.ok(diagnostics.output.interrupts.some(call => call.resume === false), 'budget exhaustion interrupts the host turn without resuming it');
  } else if (scenario === 'raw') {
    assert.ok(diagnostics.output.invocations.some(entry => entry.hook === 'execute.before' && ['bash', 'shell', 'powershell'].includes(entry.tool)), 'delivery:false permits explicitly requested native shell execution');
    assert.equal(budget.tools, chargedToolInvocations, 'delivery:false session charges every admitted host tool call exactly once');
    assert.equal(diagnostics.output.invocations.some(entry => entry.tool?.startsWith('carthagent_delivery_')), false, 'disabled session never executes a delivery workflow tool');
  } else {
    assert.ok(diagnostics.output.invocations.some(entry => entry.hook === 'execute.before' && ['bash', 'shell', 'powershell'].includes(entry.tool)), 'the real host reports native shell at the session-scoped execution hook');
    assert.equal(budget.tools, chargedToolInvocations - diagnostics.output.duplicateInvocations.length, 'Code Mode dispatches and shell calls each charge once at execute.before');
  }
  console.log(JSON.stringify({ fixtureCalls: fixture.calls, planToolObserved: true, scenario, budget: budget.tools }, null, 2));
  if (scenario === 'mixed') {
    const disabledSession = await client.session.create({
      location: { directory: cwd }, title: 'CTG disabled session in shared worktree',
      metadata: { 'carthagent.options': { delivery: false, maxTools: 10 } },
    }, request);
    await client.session.switchModel({ sessionID: disabledSession.id, model: { providerID: 'fixture', id: 'fixture' } }, request);
    await client.session.prompt({ sessionID: disabledSession.id, text: 'MIXED_DISABLED run the native shell command once.' }, request);
    await client.session.wait({ sessionID: disabledSession.id }, { signal: AbortSignal.timeout(45_000) });
    const disabledHistory = await client.message.list({ sessionID: disabledSession.id }, { signal: AbortSignal.timeout(10_000) });
    assert.match(JSON.stringify(disabledHistory.data), /DISABLED_SESSION_SHELL_OK/);
    const disabledDiagnostics = await client.rpc.call({ rpcID: 'carthagent-delivery-observer', method: 'state', input: { sessionID: disabledSession.id }, location: { directory: cwd } }, request);
    const disabledCount = disabledDiagnostics.output.invocations.filter(entry => entry.hook === 'execute.before').length;
    assert.equal(disabledDiagnostics.output.budget.tools, disabledCount, 'disabled sibling session counts its own distinct shell call exactly once');
    assert.ok(disabledDiagnostics.output.budget.limits.tools === 10);
  }
  }
  if (scenario === 'standard') {
    const agents = (await client.agent.list({ location: { directory: cwd } }, request)).data;
    assert.ok(agents.some(agent => agent.id === 'ship' && agent.name === 'Ship' && agent.mode === 'primary'));
    assert.ok(agents.some(agent => agent.id === 'lite' && agent.name === 'Lite' && agent.mode === 'primary'));
    const modeSession = await client.session.create({ location: { directory: cwd }, title: 'Native mode parity', agent: 'lite' }, request);
    await client.session.switchModel({ sessionID: modeSession.id, model: { providerID: 'fixture', id: 'fixture' } }, request);
    const first = observed.length;
    await client.session.prompt({ sessionID: modeSession.id, text: 'MIXED_DISABLED native mode parity: execute directly.' }, request);
    await client.session.wait({ sessionID: modeSession.id }, { signal: AbortSignal.timeout(45_000) });
    assert.equal(observed.slice(first).some(call => JSON.stringify(call.messages).includes('Standard delivery:')), false, 'Lite has no delivery guidance');
    const liteHistory = await client.message.list({ sessionID: modeSession.id }, request);
    assert.match(JSON.stringify(liteHistory.data), /DISABLED_SESSION_SHELL_OK/);
    await client.session.switchAgent({ sessionID: modeSession.id, agent: 'ship' }, request);
    const second = observed.length;
    await client.session.prompt({ sessionID: modeSession.id, text: 'MODE_SHIP_PARITY inspect the workspace.' }, request);
    await client.session.wait({ sessionID: modeSession.id }, { signal: AbortSignal.timeout(45_000) });
    assert.ok(observed.slice(second).some(call => JSON.stringify(call.messages).includes('Standard delivery:')), 'switching to Ship enables the harness on the next request');
    await client.session.switchAgent({ sessionID: modeSession.id, agent: 'lite' }, request);
    assert.equal((await client.session.get({ sessionID: modeSession.id }, request)).agent, 'lite');
    const beforeCommands = fixture.calls;
    await client.session.command({ sessionID: modeSession.id, name: 'delivery-budget-status', text: '' }, request);
    await client.session.command({ sessionID: modeSession.id, name: 'delivery-budget-reset', text: '' }, request);
    assert.equal(fixture.calls, beforeCommands, 'budget commands must not dispatch provider requests');
    const planHistory = await client.message.list({ sessionID: session.id }, request);
    const snapshots = planHistory.data.flatMap(message => message.type === 'assistant' ? message.content.filter(part => part.type === 'tool' && part.state.status === 'completed' && part.state.metadata?.deliveryPlan) : []);
    assert.ok(snapshots.length > 0, 'real Code Mode results persist delivery plan snapshots for the graph');
    if (process.env.CTG_NATIVE_PLAN_PTY === '1') {
      assert.ok(ownedRoot, 'graph rendering acceptance requires a verified owned runtime');
      const probe = spawn(process.env.PYTHON ?? 'python3', ['-c', `
import importlib.util, json, os, sys
from pathlib import Path
root, binary = sys.argv[1:]
spec = importlib.util.spec_from_file_location('slash_probe', Path(root) / 'tools/test-native-slash-commands.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
fixture = json.load(sys.stdin)
home = Path(fixture['temp']) / 'graph-tui-home'
env = module.fixture_environment(os.environ, home, '', '')
env = {key: value for key, value in env.items() if key in module.TUI_ENV_KEYS}
env['OPENCODE_SERVER_PASSWORD'] = fixture['password']
env['OPENCODE_SERVER_USERNAME'] = 'opencode'
tui = module.Tui(binary, fixture, fixture['sessionID'], env)
try:
    tui.wait_for(lambda: '┃' in tui.screen.visible(), 'session composer')
    if 'getting started' in tui.screen.visible().lower():
        os.write(tui.master, b'\x1b')
        tui.drain(.3)
    tui.submit_slash('/graph', marker='SHIP PLAN')
    tui.wait_for(lambda: 'Create fixture file' in tui.screen.visible(), 'authoritative delivery step in plan graph')
    print(json.dumps({'graph': 'passed', 'source': 'actual Code Mode delivery snapshot', 'step': 'Create fixture file'}))
finally:
    tui.stop()
`, root, binary], {
        cwd: root,
        env: Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT'].filter(key => process.env[key]).map(key => [key, process.env[key]])),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let probeOutput = '';
      probe.stdout.on('data', chunk => { probeOutput += chunk; });
      probe.stderr.on('data', chunk => { probeOutput += chunk; });
      probe.stdin.end(JSON.stringify({ temp, cwd, baseUrl: endpoint, password, sessionID: session.id }));
      const timer = setTimeout(() => probe.kill('SIGTERM'), 45_000);
      const [code] = await once(probe, 'exit');
      clearTimeout(timer);
      assert.equal(code, 0, probeOutput.replaceAll(password, '[redacted]'));
      console.log(probeOutput.trim());
    }
  }
  console.log(`Native plugin and validated RPC passed against OpenCode ${runtimeIdentity.runtimeVersion} (compatibility ${runtimeIdentity.compatibilityVersion}).`);
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
