#!/usr/bin/env node
/** Real CLI-adapter print/JSON smoke against a disposable OpenCode host/provider. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { runOpenCodeCli } from '../lib/opencode/cli.mjs';
import { createOpenCodeCliRuntime } from '../lib/opencode/cli-runtime.mjs';
import { createJiti } from 'jiti';

const { Carthagent } = await createJiti(import.meta.url).import('../plugins/carthagent/src/rpc.ts');

const packageRoot = resolve(import.meta.dirname, '..');
const runtimeRoot = process.env.CTG_NATIVE_RUNTIME_ROOT || packageRoot;
const binaryOverride = process.env.CTG_OPENCODE_BIN;
const pluginPath = process.env.CTG_NATIVE_PLUGIN_PATH || join(runtimeRoot, 'plugins/carthagent');
const runtimeModules = ['runtime.mjs', 'service.mjs', 'headless.mjs'].map(name => join(runtimeRoot, 'lib/opencode', name));
for (const required of runtimeModules) {
  if (!existsSync(required)) throw new Error(`Native CLI host smoke dependency not found: ${required}. Install/use the package-owned native runtime or set CTG_NATIVE_RUNTIME_ROOT to the checkout under test.`);
}
const modules = await Promise.all(['runtime.mjs', 'service.mjs', 'headless.mjs']
  .map(name => import(pathToFileURL(join(runtimeRoot, 'lib/opencode', name)).href)));
const [runtimeApi, serviceApi, headlessApi] = modules;
const binary = await runtimeApi.resolveOpenCode(binaryOverride ? { binary: binaryOverride } : {});
for (const required of [binary, pluginPath]) {
  if (!existsSync(required)) throw new Error(`Native CLI host smoke dependency not found: ${required}. Install the package-owned runtime/CLI or set CTG_OPENCODE_BIN and CTG_NATIVE_RUNTIME_ROOT explicitly.`);
}
const temp = await mkdtemp(join(tmpdir(), 'ctg-cli-host-smoke-'));
const cwd = join(temp, 'project');
const profileRoot = join(temp, 'profile');
const configPath = join(profileRoot, 'config/opencode/opencode.json');
const requests = [];
const sessionIDs = [];
const nativeEventsCaptured = [];
let budgetProviderTurns = 0;
let uncappedShellCompleted = false;
let admittedRequests = 0;
let foreignSessionID;
const provider = createServer((req, res) => {
  void (async () => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    requests.push(body);
    const lastUser = [...(body.messages || [])].reverse().find(message => message.role === 'user');
    const userText = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content ?? 'unknown prompt');
    const responseText = `CLI fixture response for ${userText}`;
    const budgetPrompt = userText.includes('Smoke budget enforcement');
    const shellCapPrompt = userText.includes('Smoke bash cap');
    const uncappedPrompt = userText.includes('Smoke uncapped shell');
    const needsBudgetRead = budgetPrompt && budgetProviderTurns++ === 0;
    const needsBudgetWrite = budgetPrompt && !needsBudgetRead && budgetProviderTurns === 2;
    const needsTool = (userText.includes('Smoke JSON') && !body.messages.some(message => message.role === 'tool')) || needsBudgetRead || needsBudgetWrite || ((shellCapPrompt || uncappedPrompt) && !body.messages.some(message => message.role === 'tool'));
    const fails = userText.includes('Smoke provider failure');
    const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
      id: 'ctg-cli-smoke', object: 'chat.completion.chunk', created: 1, model: 'fixture',
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`;
    if (fails || userText.includes('Smoke provider failure after success')) {
      // Use a non-retryable client error so the pinned host terminates this
      // fixture turn promptly instead of exercising provider backoff policy.
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: userText.includes('after success') ? 'fixture provider unavailable after success' : 'fixture provider unavailable', type: 'server_error' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (needsTool) {
      const toolCall = shellCapPrompt || uncappedPrompt
        ? { index: 0, id: shellCapPrompt ? 'fixture-bash-cap' : 'fixture-uncapped-shell', type: 'function', function: { name: 'shell', arguments: JSON.stringify({ command: `sleep 3; touch ${shellCapPrompt ? join(cwd, 'bash-cap-completed.txt') : join(cwd, 'uncapped-shell-completed.txt')}`, timeout: 0 }) } }
        : needsBudgetWrite
        ? { index: 0, id: 'fixture-budget-second-write', type: 'function', function: { name: 'write', arguments: JSON.stringify({ path: join(cwd, 'budget-side-effect.txt'), content: 'over-budget write must not happen\n' }) } }
        : budgetPrompt
          ? { index: 0, id: 'fixture-budget-first-write', type: 'function', function: { name: 'write', arguments: JSON.stringify({ path: join(cwd, 'budget-positive-control.txt'), content: 'admitted write executed\n' }) } }
          : { index: 0, id: 'fixture-tool-call', type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: join(cwd, 'tool-fixture.txt') }) } };
      res.end(`${chunk({ role: 'assistant', tool_calls: [toolCall] })}${chunk({}, 'tool_calls')}data: [DONE]\n\n`);
    } else {
      res.write(chunk({ role: 'assistant', content: responseText }));
      res.end(`${chunk({}, 'stop')}data: [DONE]\n\n`);
    }
  })().catch(error => { res.writeHead(500); res.end(error.message); });
});
let child;
let hostOutput = '';

async function stopHost() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try { await exited; } finally { clearTimeout(timer); }
}

try {
  await Promise.all(['project', 'profile/home', 'profile/config/opencode', 'profile/data', 'profile/state', 'profile/cache']
    .map(path => mkdir(join(temp, path), { recursive: true })));
  await writeFile(join(cwd, 'tool-fixture.txt'), 'native fixture tool succeeded\n');
  await new Promise((resolveGit, rejectGit) => {
    const git = spawn('git', ['init', '-q'], { cwd });
    git.once('error', rejectGit);
    git.once('exit', code => code === 0 ? resolveGit() : rejectGit(new Error(`git init exited ${code}`)));
  });
  await new Promise((resolveGit, rejectGit) => {
    const git = spawn('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture root'], { cwd });
    git.once('error', rejectGit);
    git.once('exit', code => code === 0 ? resolveGit() : rejectGit(new Error(`git fixture commit exited ${code}`)));
  });
  const projectSkill = join(cwd, '.opencode', 'skills', 'fixture-skill', 'SKILL.md');
  await mkdir(join(cwd, '.opencode', 'skills', 'fixture-skill'), { recursive: true });
  await mkdir(join(cwd, '.opencode', 'skill'), { recursive: true });
  await writeFile(projectSkill, '---\nname: fixture-skill\ndescription: fixture skill discovery\n---\nUse this fixture skill.\n');
  await writeFile(join(cwd, '.opencode', 'skill', 'fixture-skill.md'), '---\nname: fixture-skill\ndescription: fixture skill discovery\n---\nUse this fixture skill.\n');
  await mkdir(join(cwd, '.opencode', 'commands'), { recursive: true });
  await writeFile(join(cwd, '.opencode', 'commands', 'fixture-template.md'), '---\ndescription: fixture command template discovery\n---\nFixture command prompt.\n');
  await writeFile(join(cwd, '.opencode', 'opencode.json'), JSON.stringify({
    plugins: [resolve(import.meta.dirname, 'fixtures/native-discovery-plugin')],
    skills: ['.opencode/skill'],
    commands: { 'fixture-command': { description: 'fixture command discovery', template: 'Fixture command prompt.' } },
    agents: { 'fixture-agent': { description: 'fixture agent discovery', mode: 'primary', prompt: 'Fixture agent prompt.' } },
  }));
  await writeFile(join(cwd, 'AGENTS.md'), 'FIXTURE_PROJECT_INSTRUCTION\n');
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  await writeFile(configPath, JSON.stringify({
    plugins: [resolve(pluginPath)], update: 'disable', model: 'ctg-fixture/fixture',
    providers: { 'ctg-fixture': {
      package: '@opencode/ai/providers/openai-compatible',
      settings: { baseURL: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: 'offline-fixture' },
      models: { fixture: { limit: { context: 32000, output: 1024 } } },
    } },
  }));
  const password = randomBytes(24).toString('hex');
  const env = {
    PATH: process.env.PATH,
    HOME: join(profileRoot, 'home'), USERPROFILE: join(profileRoot, 'home'),
    APPDATA: join(profileRoot, 'appdata'), LOCALAPPDATA: join(profileRoot, 'localappdata'),
    XDG_CONFIG_HOME: join(profileRoot, 'config'), XDG_DATA_HOME: join(profileRoot, 'data'),
    XDG_STATE_HOME: join(profileRoot, 'state'), XDG_CACHE_HOME: join(profileRoot, 'cache'),
    TMP: join(profileRoot, 'temp'), TEMP: join(profileRoot, 'temp'),
    OPENCODE_DB: join(profileRoot, 'data/opencode.db'), OPENCODE_SERVER_PASSWORD: password,
     OPENCODE_CONFIG_PROJECT_DISABLE: 'false',
  };
  await Promise.all(['appdata', 'localappdata', 'temp'].map(path => mkdir(join(profileRoot, path), { recursive: true })));
  child = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', '0'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((resolveUrl, reject) => {
    const timer = setTimeout(() => reject(Error(`OpenCode startup timed out: ${hostOutput}`)), 30_000);
    const collect = data => {
      hostOutput = (hostOutput + data).slice(-12000);
      const match = hostOutput.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolveUrl(match[0]); }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(Error(`OpenCode exited ${code}: ${hostOutput}`)); });
  });
  const service = {
    url,
    headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` },
    binary,
    paths: { root: profileRoot },
  };
  const native = {
    runtime: runtimeApi,
    service: { ...serviceApi, ensureService: async () => service },
    headless: { ...headlessApi, runHeadless: async (...args) => {
      const result = await headlessApi.runHeadless(...args);
      sessionIDs.push(result.session.id);
      return result;
    } },
    clientFactory: async selectedService => {
      const { OpenCode } = await import('@opencode/client');
      const client = OpenCode.make({ baseUrl: selectedService.url, headers: selectedService.headers });
      const subscribe = client.event.subscribe.bind(client.event);
      client.event.subscribe = options => ({
        async *[Symbol.asyncIterator]() {
          for await (const event of subscribe(options)) {
            nativeEventsCaptured.push(event);
            yield event;
          }
        },
      });
      return client;
    },
  };
  const capture = () => {
    const lines = [];
    return { lines, stdout: { write: text => lines.push(String(text)) }, io: { log: text => lines.push(String(text)), error: text => lines.push(`ERR:${text}`) } };
  };
  const print = capture();
  const printRuntime = await createOpenCodeCliRuntime({ cwd, native, stdout: print.stdout, io: print.io });
  if (process.env.CTG_NATIVE_SMOKE_BUDGET_ONLY !== '1') {
  const printCode = await runOpenCodeCli({ argv: ['-p', '--no-guide', '--model', 'ctg-fixture/fixture', 'Smoke print'], runtime: printRuntime, io: print.io, stdoutIsTTY: false });
  assert.equal(printCode, 0, `print run failed: ${print.lines.join('\n')}\n${hostOutput}`);
  assert.match(print.lines.join('\n'), /CLI fixture response for Smoke print/);

  const secondTurn = capture();
  const secondRuntime = await createOpenCodeCliRuntime({ cwd, native, stdout: secondTurn.stdout, io: secondTurn.io });
  const secondCode = await runOpenCodeCli({ argv: ['-p', '--no-guide', '--session', sessionIDs[0], '--model', 'ctg-fixture/fixture', 'Smoke second turn'], runtime: secondRuntime, io: secondTurn.io, stdoutIsTTY: false });
  assert.equal(secondCode, 0, `second print run failed: ${secondTurn.lines.join('\n')}\n${hostOutput}`);
  assert.match(secondTurn.lines.join('\n'), /CLI fixture response for Smoke second turn/);
  assert.doesNotMatch(secondTurn.lines.join('\n'), /CLI fixture response for Smoke print/);

  const failureAfterSuccess = capture();
  const failureAfterSuccessRuntime = await createOpenCodeCliRuntime({ cwd, native, stdout: failureAfterSuccess.stdout, io: failureAfterSuccess.io });
  const failureAfterSuccessCode = await runOpenCodeCli({ argv: ['-p', '--no-guide', '--session', sessionIDs[0], '--model', 'ctg-fixture/fixture', 'Smoke provider failure after success'], runtime: failureAfterSuccessRuntime, io: failureAfterSuccess.io, stdoutIsTTY: false });
  assert.equal(failureAfterSuccessCode, 1, `failed turn must not inherit previous success: ${failureAfterSuccess.lines.join('\n')}`);
  assert.doesNotMatch(failureAfterSuccess.lines.join('\n'), /CLI fixture response for Smoke (print|second turn)/);
  admittedRequests = requests.length;
  }

  const { OpenCode } = await import('@opencode/client');
  const fixtureClient = OpenCode.make({ baseUrl: service.url, headers: service.headers });
   const discoveryLocation = { location: { directory: cwd } };
  const discover = async () => {
    const location = await fixtureClient.location.get(discoveryLocation);
    const [skills, commands, agents] = await Promise.all([
      fixtureClient.skill.list(discoveryLocation), fixtureClient.command.list(discoveryLocation),
      fixtureClient.agent.list(discoveryLocation),
    ]);
    const instructionSession = await fixtureClient.session.create({ location: { directory: cwd }, title: 'Project instruction discovery', model: { providerID: 'ctg-fixture', id: 'fixture' } });
    const sessionID = instructionSession.id;
    const instructions = await fixtureClient.session.context({ sessionID: instructionSession.id });
    await fixtureClient.session.prompt({ sessionID: instructionSession.id, text: 'Trigger fixture context.' });
    await fixtureClient.session.wait({ sessionID: instructionSession.id });
    const promptContext = await fixtureClient.session.context({ sessionID: instructionSession.id });
    return {
      skill: (skills.data ?? skills).some(item => String(item.name || item.id).includes('fixture-skill')),
      command: (commands.data ?? commands).some(item => String(item.name || item.id).includes('fixture')),
      promptTemplate: (commands.data ?? commands).some(item => item.name === 'fixture-template'),
      agent: (agents.data ?? agents).some(item => String(item.name || item.id).includes('fixture')),
      projectPlugin: (commands.data ?? commands).some(item => item.name === 'fixture-project-plugin-marker'),
      instructionEntries: instructions,
      promptContext,
      sessionID,
      location,
    };
  };
  const normalDiscovery = await discover();
  assert.deepEqual({ skill: normalDiscovery.skill, command: normalDiscovery.command, promptTemplate: normalDiscovery.promptTemplate, agent: normalDiscovery.agent, projectPlugin: normalDiscovery.projectPlugin }, { skill: true, command: true, promptTemplate: true, agent: true, projectPlugin: true }, `normal project discovery: ${JSON.stringify(normalDiscovery)}`);
  const normalPromptRequest = [...requests].reverse().find(body => JSON.stringify(body.messages ?? []).includes('Trigger fixture context.'));
  assert.ok(JSON.stringify(normalPromptRequest?.messages ?? []).includes('FIXTURE_PROJECT_INSTRUCTION'), `normal project instructions must reach the provider request: ${JSON.stringify(normalPromptRequest?.messages ?? [])}`);
  const templateSession = await fixtureClient.session.create({ location: { directory: cwd }, title: 'Project command template discovery', model: { providerID: 'ctg-fixture', id: 'fixture' } });
  await fixtureClient.session.command({ sessionID: templateSession.id, name: 'fixture-template', text: '' });
  await fixtureClient.session.wait({ sessionID: templateSession.id });
  const templateRequest = [...requests].reverse().find(body => JSON.stringify(body.messages ?? []).includes('Fixture command prompt.'));
  assert.ok(templateRequest, 'discovered project command template must expand into the provider request');
  await fixtureClient.session.remove({ sessionID: templateSession.id });
  await fixtureClient.session.remove({ sessionID: normalDiscovery.sessionID });
  const isolatedRoot = join(temp, 'isolated-profile');
  const isolatedService = await serviceApi.ensureService({ root: isolatedRoot, pluginPath, isolate: true });
  try {
    const isolatedClient = OpenCode.make({ baseUrl: isolatedService.url, headers: isolatedService.headers });
    const isolatedLocation = await isolatedClient.location.get(discoveryLocation);
    const [skills, commands, agents] = await Promise.all([
      isolatedClient.skill.list(discoveryLocation), isolatedClient.command.list(discoveryLocation),
      isolatedClient.agent.list(discoveryLocation),
    ]);
    const isolatedInstructions = await isolatedClient.session.create({ location: { directory: cwd }, title: 'Isolate instruction check', model: { providerID: 'ctg-fixture', id: 'fixture' } });
    const instructionEntries = await isolatedClient.session.context({ sessionID: isolatedInstructions.id });
    const isolatedRequestIndex = requests.length;
    await isolatedClient.session.prompt({ sessionID: isolatedInstructions.id, text: 'Trigger isolated context.' });
    await isolatedClient.session.wait({ sessionID: isolatedInstructions.id });
    const isolatedContext = await isolatedClient.session.context({ sessionID: isolatedInstructions.id });
    assert.deepEqual({ skill: skills.data ?? skills, command: commands.data ?? commands, agent: agents.data ?? agents }, { skill: [], command: [], agent: [] }, 'isolate disables project skills, commands, and agents');
    assert.equal(JSON.stringify(commands.data ?? commands).includes('Fixture command prompt.'), false, 'isolate disables project prompt-template discovery');
    assert.equal(isolatedLocation.project.id, normalDiscovery.location.project.id, 'isolate retains the same actual project identity');
    assert.equal((commands.data ?? commands).some(item => item.name === 'fixture-project-plugin-marker'), false, 'project plugin marker is absent in isolate');
    assert.equal(JSON.stringify(instructionEntries).includes('FIXTURE_PROJECT_INSTRUCTION'), false, 'isolate disables project AGENTS.md instructions');
    assert.equal(JSON.stringify(isolatedContext).includes('FIXTURE_PROJECT_INSTRUCTION'), false, 'isolate prompt excludes project AGENTS.md instructions');
    assert.equal(JSON.stringify(requests.slice(isolatedRequestIndex).map(body => body.messages)).includes('FIXTURE_PROJECT_INSTRUCTION'), false, 'isolated provider request excludes project AGENTS.md instructions');
    await isolatedClient.session.remove({ sessionID: isolatedInstructions.id });
    const isolatedHealth = await isolatedClient.rpc(Carthagent).health({}, discoveryLocation);
    assert.ok(isolatedHealth.capabilities.includes('delivery.budgets.v1'), 'CTG delivery remains active in isolate');
  } finally {
    await serviceApi.stopService({ root: isolatedRoot });
    await rm(isolatedRoot, { recursive: true, force: true });
  }
  if (process.env.CTG_NATIVE_SMOKE_BUDGET_ONLY !== '1') {
  const foreignDir = join(temp, 'foreign');
  await mkdir(foreignDir);
  const capabilities = await fixtureClient.rpc(Carthagent).health({}, { location: { directory: cwd } });
  assert.ok(capabilities.capabilities.includes('delivery.budgets.v1'), JSON.stringify(capabilities));
  const foreign = await fixtureClient.session.create({ location: { directory: foreignDir }, title: 'Foreign workspace session', model: { providerID: 'ctg-fixture', id: 'fixture' } });
  foreignSessionID = foreign.id;
  const continued = capture();
  const continueRuntime = await createOpenCodeCliRuntime({ cwd, native, stdout: continued.stdout, io: continued.io });
  const continueCode = await runOpenCodeCli({ argv: ['-p', '-c', '--no-guide', '--model', 'ctg-fixture/fixture', 'Smoke continue in workspace'], runtime: continueRuntime, io: continued.io, stdoutIsTTY: false });
  assert.equal(continueCode, 0, `continue run failed: ${continued.lines.join('\n')}\n${hostOutput}`);
  assert.notEqual(sessionIDs.at(-1), foreign.id, 'continue must not select a session from another workspace');
  assert.equal(sessionIDs.at(-1), sessionIDs[0], 'continue must select the newest existing session in this workspace');
  }

  if (process.env.CTG_NATIVE_SMOKE_BUDGET_ONLY !== '1') {
  const guideSeed = capture();
  const guideSeedRuntime = await createOpenCodeCliRuntime({ cwd, native, stdout: guideSeed.stdout, io: guideSeed.io });
  const guideSeedCode = await runOpenCodeCli({ argv: ['-p', '-p', '--guide', '--model', 'ctg-fixture/fixture', 'Smoke establish persisted guide'], runtime: guideSeedRuntime, io: guideSeed.io, stdoutIsTTY: false });
  assert.equal(guideSeedCode, 0, `guided seed run failed: ${guideSeed.lines.join('\n')}\n${hostOutput}`);
  const guideSessionID = sessionIDs.at(-1);
  const noGuide = capture();
  const noGuideRuntime = await createOpenCodeCliRuntime({ cwd, native, stdout: noGuide.stdout, io: noGuide.io });
  const noGuideCode = await runOpenCodeCli({ argv: ['-p', '--no-guide', '--session', guideSessionID, '--model', 'ctg-fixture/fixture', 'Smoke explicit no-guide overrides persisted guide'], runtime: noGuideRuntime, io: noGuide.io, stdoutIsTTY: false });
  assert.equal(noGuideCode, 0, `resumed no-guide run failed: ${noGuide.lines.join('\n')}\n${hostOutput}`);
  const noGuideRequest = [...requests].reverse().find(body => body.messages?.some(message => message.role === 'user' && String(message.content).includes('Smoke explicit no-guide overrides persisted guide')));
  assert.ok(noGuideRequest, 'resumed no-guide prompt reached the offline fixture provider');
  const noGuideUser = noGuideRequest.messages.find(message => message.role === 'user' && String(message.content).includes('Smoke explicit no-guide overrides persisted guide'));
  assert.equal(noGuideUser.content, 'Smoke explicit no-guide overrides persisted guide', 'explicit --no-guide must prevent persisted framing from rewriting resumed prompts');
  }

  const budget = capture();
  const budgetRuntime = await createOpenCodeCliRuntime({ cwd, native, stdout: budget.stdout, io: budget.io });
  const requestsBeforeBudget = requests.length;
  const budgetCode = await runOpenCodeCli({ argv: ['-p', '--json', '--no-delivery', '--max-tools', '1', '--no-guide', '--model', 'ctg-fixture/fixture', 'Smoke budget enforcement'], runtime: budgetRuntime, io: budget.io, stdoutIsTTY: false });
  assert.equal(budgetCode, 1, `budget run should terminate as interrupted: ${budget.lines.join('\n')}\n${JSON.stringify(requests.slice(requestsBeforeBudget))}\n${JSON.stringify(nativeEventsCaptured.slice(-40))}`);
  const budgetSessionID = sessionIDs.at(-1);
  assert.ok(budgetSessionID, 'the enforced budget run created a native session');
  const budgetRequests = requests.slice(requestsBeforeBudget).filter(body => {
    const lastUser = [...(body.messages || [])].reverse().find(message => message.role === 'user');
    return String(lastUser?.content || '').includes('Smoke budget enforcement');
  });
  assert.equal(budgetRequests.length, 2, `provider received the initial tool request and one continuation; actual=${budgetRequests.length}`);
  assert.equal(budgetProviderTurns, 2, 'fixture provider received no further request after the over-budget tool call');
  assert.equal(existsSync(join(cwd, 'budget-positive-control.txt')), true, 'the first admitted native write executed as a positive control');
  assert.equal(existsSync(join(cwd, 'budget-side-effect.txt')), false, 'the over-budget native write did not execute');
  const budgetEvents = budget.lines.filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  assert.ok(budgetEvents.some(event => event.type === 'tool_execution_start' && event.sessionID === budgetSessionID && event.toolName === 'write'), JSON.stringify(budgetEvents));
  assert.ok(budgetEvents.some(event => event.type === 'message' && event.sessionID === budgetSessionID && event.message.type === 'idle' && event.message.outcome === 'interrupted'), JSON.stringify(budgetEvents));
  assert.ok(nativeEventsCaptured.some(event => event.type === 'session.execution.interrupted' && event.data?.sessionID === budgetSessionID), 'the over-budget tool interrupted the native session');
  const budgetStatus = await fixtureClient.rpc(Carthagent).budgetStatus({ sessionID: budgetSessionID }, { location: { directory: cwd } });
  assert.deepEqual({ tools: budgetStatus.tools, maxTools: budgetStatus.maxTools, stopped: budgetStatus.stopped }, { tools: 1, maxTools: 1, stopped: 'tool-calls' });

  const bashCap = capture();
  const bashCapRuntime = await createOpenCodeCliRuntime({ cwd, native, stdout: bashCap.stdout, io: bashCap.io });
  const bashCapCode = await runOpenCodeCli({ argv: ['-p', '--no-guide', '--bash-cap', '0.5', '--model', 'ctg-fixture/fixture', 'Smoke bash cap'], runtime: bashCapRuntime, io: bashCap.io, stdoutIsTTY: false });
  assert.equal(bashCapCode, 0, `bash-cap session failed: ${bashCap.lines.join('\n')}\n${hostOutput}`);
  const bashCapSession = await fixtureClient.session.get({ sessionID: sessionIDs.at(-1) });
  assert.equal(bashCapSession.metadata['carthagent.options'].bashCap, 0.5);
  assert.equal(existsSync(join(cwd, 'bash-cap-completed.txt')), false, 'the capped three-second shell command timed out before its side effect');
  await new Promise(resolveDelay => setTimeout(resolveDelay, 2700));
  assert.equal(existsSync(join(cwd, 'bash-cap-completed.txt')), false, 'a timed-out child command did not run its delayed side effect');

  const uncapped = capture();
  const uncappedRuntime = await createOpenCodeCliRuntime({ cwd, native, stdout: uncapped.stdout, io: uncapped.io });
  const uncappedCode = await runOpenCodeCli({ argv: ['-p', '--no-guide', '--no-delivery', '--model', 'ctg-fixture/fixture', 'Smoke uncapped shell'], runtime: uncappedRuntime, io: uncapped.io, stdoutIsTTY: false });
  assert.equal(uncappedCode, 0, `uncapped shell positive control failed: ${uncapped.lines.join('\n')}\n${hostOutput}`);
  await new Promise(resolveDelay => setTimeout(resolveDelay, 3300));
  uncappedShellCompleted = existsSync(join(cwd, 'uncapped-shell-completed.txt'));
  assert.equal(uncappedShellCompleted, true, 'neighboring --no-delivery session retains its uncapped shell behavior');

  if (process.env.CTG_NATIVE_SMOKE_BUDGET_ONLY === '1') {
    console.log(JSON.stringify({ binary, host: '2.0.32', budgetEnforcement: 'passed', providerTurns: budgetProviderTurns, budgetStatus: { tools: budgetStatus.tools, maxTools: budgetStatus.maxTools, stopped: budgetStatus.stopped }, positiveControl: existsSync(join(cwd, 'budget-positive-control.txt')), overBudgetSideEffect: existsSync(join(cwd, 'budget-side-effect.txt')) }));
  } else {
  const json = capture();
  const jsonRuntime = await createOpenCodeCliRuntime({ cwd, native, stdout: json.stdout, io: json.io });
  const jsonCode = await runOpenCodeCli({ argv: ['--json', '--no-guide', '--model', 'ctg-fixture/fixture', 'Smoke JSON'], runtime: jsonRuntime, io: json.io, stdoutIsTTY: false });
  assert.equal(jsonCode, 0, `JSON run failed: ${json.lines.join('\n')}\n${hostOutput}`);
  const events = json.lines.filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  assert.ok(events.some(event => event.type === 'message_end' && event.message.role === 'assistant'));
  assert.ok(requests.length >= 7, 'all admitted CLI invocations and the post-tool model turn reached the local provider');
  assert.ok(events.some(event => event.type === 'tool_execution_start' && event.toolName === 'read'));
  assert.ok(events.some(event => event.type === 'tool_execution_end' && event.toolName === 'read' && event.isError === false), JSON.stringify({ projected: events, native: nativeEventsCaptured }));

  const failedSession = await fixtureClient.session.create({ location: { directory: cwd }, title: 'Provider failure JSON smoke', model: { providerID: 'ctg-fixture', id: 'fixture' } });
  const failedJson = capture();
  const failedRuntime = await createOpenCodeCliRuntime({ cwd, native, stdout: failedJson.stdout, io: failedJson.io });
  const failedCode = await runOpenCodeCli({ argv: ['-p', '--json', '--no-guide', '--session', failedSession.id, '--model', 'ctg-fixture/fixture', 'Smoke provider failure'], runtime: failedRuntime, io: failedJson.io, stdoutIsTTY: false });
  assert.equal(failedCode, 1, `provider failure should return a failing exit code: ${failedJson.lines.join('\n')}`);
  const failedEvents = failedJson.lines.filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  assert.ok(failedEvents.length, 'provider failure must emit JSONL terminal diagnostics');
  assert.ok(failedEvents.every(event => event.sessionID === failedSession.id), JSON.stringify(failedEvents));
  assert.ok(failedEvents.some(event => event.type === 'message_end' && event.message.stopReason === 'error'), JSON.stringify(failedEvents));
  assert.ok(failedEvents.some(event => event.type === 'message' && event.message.type === 'idle' && ['failed', 'interrupted'].includes(event.message.outcome)), JSON.stringify(failedEvents));
  assert.ok(failedEvents.some(event => JSON.stringify(event).includes('fixture provider unavailable')), JSON.stringify(failedEvents));
  assert.ok(!failedEvents.some(event => event.sessionID === foreignSessionID), 'failure JSONL must not include a foreign or stale session');
  const failedAfterSuccess = capture();
  const failedAfterSuccessRuntime = await createOpenCodeCliRuntime({ cwd, native, stdout: failedAfterSuccess.stdout, io: failedAfterSuccess.io });
  const failedAfterSuccessCode = await runOpenCodeCli({ argv: ['--json', '--no-guide', '--session', sessionIDs[0], '--model', 'ctg-fixture/fixture', 'Smoke provider failure after success'], runtime: failedAfterSuccessRuntime, io: failedAfterSuccess.io, stdoutIsTTY: false });
  assert.equal(failedAfterSuccessCode, 1, `JSON failure after success should fail: ${failedAfterSuccess.lines.join('\n')}`);
  const failedAfterSuccessEvents = failedAfterSuccess.lines.filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  assert.ok(!failedAfterSuccessEvents.some(event => JSON.stringify(event).includes('CLI fixture response for Smoke print') || JSON.stringify(event).includes('CLI fixture response for Smoke second turn')), JSON.stringify(failedAfterSuccessEvents));
  assert.ok(failedAfterSuccessEvents.some(event => event.type === 'message' && event.message.type === 'idle' && event.message.outcome === 'failed'), JSON.stringify({ output: failedAfterSuccess.lines, native: nativeEventsCaptured.filter(event => event.data?.sessionID === sessionIDs[0]).slice(-30), requests: requests.slice(-4) }));
  console.log(JSON.stringify({ binary, host: '2.0.32', providerRequests: requests.length, admittedRequests, print: 'passed', repeatedTurn: 'passed', providerFailureAfterSuccess: 'passed', jsonProviderFailureAfterSuccess: 'passed', continueWorkspaceIsolation: 'passed', jsonToolEvents: 'passed', budgetEnforcement: 'passed', bashCap: 'timed out before side effect', uncappedShellPositiveControl: uncappedShellCompleted, projectDiscovery: 'normal and isolated checked', jsonProviderFailure: 'passed', profile: 'disposable fixture; existing service injected' }));
  }
} catch (error) {
  console.error(hostOutput);
  throw error;
} finally {
  await stopHost();
  provider.closeAllConnections();
  if (provider.listening) await new Promise(done => provider.close(done));
  await rm(temp, { recursive: true, force: true });
}
