import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { stopService, ensureService } from '../../lib/opencode/service.mjs';
import { OpenCode } from '@opencode/client';

const root = resolve(import.meta.dirname, '../..');
const binary = process.env.CTG_OPENCODE_BIN || join(root, 'node_modules/@opencode/cli/bin/opencode.exe');
const carthagentEntryUrl = pathToFileURL(join(root, 'plugins/carthagent/src/index.ts')).href;

function terminateProcessTree(child, force = false) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', ...(force ? ['/F'] : [])], {
        windowsHide: true, stdio: 'ignore', timeout: 3000,
      });
    } catch {
      try { child.kill('SIGKILL'); } catch {}
    }
    return;
  }
  try { process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM'); }
  catch { try { child.kill(force ? 'SIGKILL' : 'SIGTERM'); } catch {} }
}

export function runNativeProcess(command, args, { cwd, env, timeoutMs = 30_000 } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd, env, detached: process.platform !== 'win32', windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    let timedOut = false;
    let settled = false;
    let escalation;
    let hardBound;
    const finish = (status, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(escalation);
      clearTimeout(hardBound);
      resolveRun({ status, signal, stdout, stderr, timedOut, pid: child.pid });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
      escalation = setTimeout(() => terminateProcessTree(child, true), 1500);
      // Descendants may inherit the pipes; never let their handles block the caller forever.
      hardBound = setTimeout(() => {
        terminateProcessTree(child, true);
        child.stdout.destroy();
        child.stderr.destroy();
        finish(null, 'TIMEOUT');
      }, 5000);
    }, timeoutMs);
    child.once('error', error => {
      clearTimeout(timer);
      clearTimeout(escalation);
      clearTimeout(hardBound);
      if (!settled) { settled = true; rejectRun(error); }
    });
    child.once('close', (status, signal) => finish(status, signal));
  });
}

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function modelResponse(messages, { verdict = 'APPROVE', omitVerdict = false } = {}) {
  const prompt = [...messages].reverse().find(message => message.role === 'user')?.content || '';
  const snapshot = /Snapshot SHA-256: ([a-f0-9]+)/.exec(prompt)?.[1];
  const head = /(?:^|\n)HEAD: ([a-f0-9]{40})/.exec(prompt)?.[1]
    || /Verified PR head: ([a-f0-9]{40})/.exec(prompt)?.[1];
  const findings = verdict === 'CHANGES-REQUESTED'
    ? [{ file: 'source.txt', line: 1, severity: 'blocking', issue: 'fixture issue', fix: 'fixture fix' }]
    : [];
  const text = `${omitVerdict ? 'fixture reviewer omitted verdict' : `REVIEW_JSON: ${JSON.stringify({ version: 1, snapshot, head, findings })}\nVERDICT: ${verdict}`}`;
  return `data: ${JSON.stringify({ id: 'native-cli-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`
    + `data: ${JSON.stringify({ id: 'native-cli-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`
    + 'data: [DONE]\n\n';
}

export async function nativeCliFixture(t, { verdict = 'APPROVE', omitVerdict = false, deliveryOptions, observeDeliveryState = false } = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'ctg-native-cli-process-'));
  const cwd = join(temp, 'project');
  const profile = join(temp, 'profile');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(join(profile, 'config', 'opencode'), { recursive: true });
  const fixtureState = {};
  const provider = createServer((request, response) => {
    void (async () => {
      let raw = '';
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw || '{}');
      if (request.url === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ data: [{ id: 'fixture', object: 'model', owned_by: 'Carthagent Ship' }] }));
        return;
      }
      const messages = body.messages || [];
      const prompt = [...messages].reverse().find(message => message.role === 'user')?.content || '';
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      if (fixtureState.providerResponse) {
        await fixtureState.providerResponse({ body, messages, prompt, response });
        return;
      }
      const isPRReview = prompt.includes('Review this exact GitHub pull request source snapshot');
      if (isPRReview) {
        fixtureState.reviewRequests ||= [];
        fixtureState.reviewRequests.push({
          head: /Verified PR head: ([a-f0-9]{40})/.exec(prompt)?.[1],
          snapshot: /Snapshot SHA-256: ([a-f0-9]{64})/.exec(prompt)?.[1],
          sourceIncluded: prompt.includes('native fixture source'),
        });
      }
      if (isPRReview && fixtureState.onReviewRequest) {
        response.once('finish', () => {
          fixtureState.reviewRequests.at(-1).providerResponseFinished = true;
          try {
            fixtureState.onReviewRequest();
            fixtureState.reviewRequests.at(-1).headAdvancedAfterResponse = true;
          } catch (error) { fixtureState.mutationError = error; }
        });
      }
      response.end(modelResponse(messages, { verdict, omitVerdict }));
    })().catch(error => {
      if (!response.headersSent) response.writeHead(500);
      response.end(error.message);
    });
  });
  t.after(async () => {
    provider.closeAllConnections();
    await Promise.all([
      stopService({ root: profile, healthTimeout: 1500, stopTimeout: 10_000, lockTimeout: 12_000 }),
      new Promise((resolveClose, rejectClose) => provider.close(error => error ? rejectClose(error) : resolveClose())),
    ]);
    rmSync(temp, { recursive: true, force: true });
  });
  let observerPlugin;
  if (observeDeliveryState) {
    observerPlugin = join(temp, 'delivery-observer');
    mkdirSync(observerPlugin);
    writeFileSync(join(observerPlugin, 'index.ts'), `
import { Rpc } from '@opencode/plugin/rpc';
import { setupCarthagent } from ${JSON.stringify(carthagentEntryUrl)};
const deliveryOptions = ${JSON.stringify(deliveryOptions || {})};
const stateCache = new Map();
const State = Rpc.define({ id: 'ctg-budget-test', methods: { get: {
  input: { type: 'object', properties: { sessionID: { type: 'string' } }, required: ['sessionID'], additionalProperties: false },
  output: { type: 'object', properties: { tools: { type: 'integer' }, repairs: { type: 'integer' }, limits: { type: 'object', additionalProperties: true }, stopped: { type: ['string', 'null'] }, startedAt: { type: 'integer' }, error: { type: 'string' } }, additionalProperties: false },
} }, events: {} });
export default { id: 'ctg-budget-observer', async setup(ctx) {
  const monitored = { ...ctx, storage: { ...ctx.storage,
    get: async key => { const value = await ctx.storage.get(key); if (key.startsWith('session/') && value?.budget) stateCache.set(key.slice(8), structuredClone(value.budget)); return value; },
    set: async (key, value) => { if (key.startsWith('session/') && value?.budget) stateCache.set(key.slice(8), structuredClone(value.budget)); return ctx.storage.set(key, value); },
  } };
  const cleanup = await setupCarthagent(monitored, { deliveryOptions });
  const observer = await ctx.rpc.register(State, { get: async input => {
    const budget = stateCache.get(input.sessionID);
    return budget ? { tools: budget.tools, repairs: budget.repairs, limits: budget.limits, stopped: budget.stopped, startedAt: budget.startedAt } : { error: 'Native delivery budget state is not yet observed for this session' };
  } });
  return async () => { await observer.dispose(); await cleanup(); };
} };
`);
  }
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  writeFileSync(join(profile, 'config', 'opencode', 'opencode.json'), JSON.stringify({
    ...(deliveryOptions || observerPlugin ? { plugins: [
      ...(observerPlugin ? [observerPlugin] : deliveryOptions ? [{ package: join(root, 'plugins/carthagent'), options: { deliveryOptions } }] : []),
    ] } : {}),
    model: 'ctg-fixture/fixture',
    update: 'disable',
    providers: { lattice: {
      package: '@opencode/ai/providers/openai-compatible',
      settings: { baseURL: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: 'offline-fixture' },
      models: { 'gpt-6-luna': { name: 'Carthagent Ship fixture', limit: { context: 32000, output: 1024 } } },
    }, 'ctg-fixture': {
      package: '@opencode/ai/providers/openai-compatible',
      settings: { baseURL: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: 'offline-fixture' },
      models: { fixture: { name: 'Carthagent Ship fixture', limit: { context: 32000, output: 1024 } } },
    } },
  }));
  const env = {
    ...process.env,
    CTG_OPENCODE_HOME: profile,
    CTG_OPENCODE_BIN: binary,
    CARTHAGENT_CONFIG: join(temp, 'carthagent-config.json'),
    OPENCODE_DISABLE_AUTOUPDATE: 'true',
  };
  const ghShim = join(temp, 'gh-fixture.mjs');
  const ghLog = join(temp, 'gh-fixture.jsonl');
  writeFileSync(ghShim, `
import { appendFileSync, readFileSync } from 'node:fs';
const [group, command, ...args] = process.argv.slice(2);
appendFileSync(${JSON.stringify(ghLog)}, JSON.stringify([group, command, ...args]) + '\\n');
if (group === 'pr' && command === 'view' && args.join(' ') === '14 --json url,number') process.stdout.write(readFileSync(${JSON.stringify(join(temp, 'pr-view.json'))}));
else if (group === 'api' && command === 'repos/owner/fixture/pulls/14' && args.length === 0) process.stdout.write(readFileSync(${JSON.stringify(join(temp, 'pr-api.json'))}));
else { console.error('unsupported gh fixture request', group, command, ...args); process.exitCode = 2; }
`);
  const ghPreload = join(temp, 'gh-fixture-preload.mjs');
  writeFileSync(ghPreload, `
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { basename } from 'node:path';
import { appendFileSync } from 'node:fs';
const fixture = ${JSON.stringify(ghShim)};
const originalSpawn = childProcess.spawn;
const originalExecFileSync = childProcess.execFileSync;
const isGh = command => basename(String(command)).replace(/\\.exe$/i, '').toLowerCase() === 'gh';
const blocked = command => {
  if (isGh(command) || basename(String(command)).toLowerCase() !== 'gh-fixture-sentinel') return false;
  appendFileSync(${JSON.stringify(join(temp, 'gh-real-fallback.jsonl'))}, JSON.stringify(String(command)) + '\\n');
  return true;
};
childProcess.spawn = function(command, args, options) {
  if (blocked(command)) return originalSpawn(process.execPath, ['-e', 'process.exit(97)'], options);
  return isGh(command) ? originalSpawn(process.execPath, [fixture, ...(args || [])], options) : originalSpawn(command, args, options);
};
childProcess.execFileSync = function(command, args, options) {
  if (blocked(command)) return originalExecFileSync(process.execPath, ['-e', 'process.exit(97)'], options);
  return isGh(command) ? originalExecFileSync(process.execPath, [fixture, ...(args || [])], options) : originalExecFileSync(command, args, options);
};
syncBuiltinESMExports();
`);
  const preloadFlag = `--import=${pathToFileURL(ghPreload).href}`;
  env.NODE_OPTIONS = [env.NODE_OPTIONS, preloadFlag].filter(Boolean).join(' ');
  const run = (...args) => runNativeProcess(process.execPath, [join(root, 'bin/ctg.mjs'), ...args], {
    cwd, env: { ...env, CTG_NATIVE_RUNTIME_ROOT: root },
  });
  const service = await ensureService({ root: profile, pluginPath: join(root, 'plugins/carthagent') });
  const client = OpenCode.make({ baseUrl: service.url, headers: service.headers });
  const request = { signal: AbortSignal.timeout(15_000) };
  const activationSession = await client.session.create({
    location: { directory: cwd },
        model: { providerID: 'ctg-fixture', id: 'fixture' },
    title: 'Activate native review fixture',
  }, request);
  const activatedBy = Date.now() + 15_000;
  while (true) {
    const plugins = await client.plugin.list({ location: { directory: cwd } }, request);
    if (plugins.data.some(plugin => plugin.id === 'carthagent' && plugin.state.status === 'active')) break;
    if (plugins.data.some(plugin => plugin.id === 'carthagent' && plugin.state.status === 'error')) {
      throw new Error(`Native fixture plugin failed to activate: ${JSON.stringify(plugins.data)}`);
    }
    if (Date.now() >= activatedBy) throw new Error(`Native fixture plugin did not activate: ${JSON.stringify(plugins.data)}`);
    await new Promise(resolveDelay => setTimeout(resolveDelay, 50));
  }
  const agentDeadline = Date.now() + 15_000;
  let agentInventory;
  while (true) {
    agentInventory = await client.agent.list({ location: { directory: cwd } }, request);
    if (agentInventory.data.some(agent => agent.id === 'build' && agent.mode === 'primary')) break;
    if (Date.now() >= agentDeadline) throw new Error(`Native fixture build agent did not register after workspace activation: ${JSON.stringify(agentInventory.data)}`);
    await new Promise(resolveDelay => setTimeout(resolveDelay, 50));
  }
  return {
    cwd, env, temp, run, git, profile, activationSession,
    model: { providerID: 'ctg-fixture', id: 'fixture' }, client,
    request: () => ({ signal: AbortSignal.timeout(15_000) }),
    setProviderResponse(callback) { fixtureState.providerResponse = callback; },
    get reviewRequests() { return fixtureState.reviewRequests || []; },
    get mutationError() { return fixtureState.mutationError; },
    get advancedPullRequestHead() { return fixtureState.advancedPullRequestHead; },
    set advancedPullRequestHead(value) { fixtureState.advancedPullRequestHead = value; },
    setReviewMutation(callback) { fixtureState.onReviewRequest = callback; },
    get ghFallbacks() {
      try { return readFileSync(join(temp, 'gh-real-fallback.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
      catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    },
    async verifyGhIsolation() {
      const result = await runNativeProcess(process.execPath, ['-e', "require('node:child_process').execFileSync('gh-fixture-sentinel')"], {
        cwd, env: { ...env, CTG_NATIVE_RUNTIME_ROOT: root }, timeoutMs: 5000,
      });
      return result;
    },
    get ghInvocations() {
      try { return readFileSync(ghLog, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
      catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    },
    async deliveryBudget(sessionID, { timeout = 15_000, stopped, tools, repairs } = {}) {
      const deadline = Date.now() + timeout;
      let latest;
      do {
        const value = await client.rpc.call({ rpcID: 'ctg-budget-test', method: 'get', location: { directory: cwd }, input: { sessionID } }, { signal: AbortSignal.timeout(5_000) });
        latest = value.output;
        if (!latest.error
          && (stopped === undefined || latest.stopped === stopped)
          && (tools === undefined || latest.tools === tools)
          && (repairs === undefined || latest.repairs === repairs)) return latest;
        await new Promise(resolveDelay => setTimeout(resolveDelay, 50));
      } while (Date.now() < deadline);
      return latest;
    },
  };
}

export function initPrRepository(fixture, { source = 'native fixture source\n' } = {}) {
  const { cwd, temp } = fixture;
  const bare = join(temp, 'origin.git');
  mkdirSync(bare);
  execFileSync('git', ['init', '--bare', '-q', bare]);
  execFileSync('git', ['init', '-q', cwd]);
  git(cwd, 'config', 'user.email', 'fixture@example.invalid');
  git(cwd, 'config', 'user.name', 'Native CLI fixture');
  git(cwd, 'checkout', '-qb', 'main');
  writeFileSync(join(cwd, 'source.txt'), 'base source\n');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-qm', 'base');
  git(cwd, 'remote', 'add', 'origin', `https://github.com/owner/fixture.git`);
  execFileSync('git', ['push', '-q', bare, 'main'], { cwd });
  const baseHead = git(cwd, 'rev-parse', 'HEAD');
  git(cwd, 'checkout', '-qb', 'feature');
  writeFileSync(join(cwd, 'source.txt'), source);
  git(cwd, 'commit', '-qam', 'PR change');
  execFileSync('git', ['push', '-q', bare, 'feature'], { cwd });
  const head = git(cwd, 'rev-parse', 'HEAD');
  const metadata = {
    state: 'open', number: 14,
    head: { sha: head, ref: 'feature', repo: { full_name: 'owner/fixture', clone_url: bare } },
    base: { sha: baseHead, ref: 'main', repo: { full_name: 'owner/fixture', clone_url: bare } },
    url: 'https://github.com/owner/fixture/pull/14',
  };
  writeFileSync(join(temp, 'pr-view.json'), JSON.stringify({ number: 14, url: metadata.url }));
  writeFileSync(join(temp, 'pr-api.json'), JSON.stringify(metadata));
  fixture.bare = bare;
  return { bare, head, baseHead };
}

export function setPullRequestFixture(fixture, { mutateHead = false } = {}) {
  const { cwd, temp } = fixture;
  const head = git(cwd, 'rev-parse', 'HEAD');
  const baseHead = git(cwd, 'rev-parse', 'HEAD^');
  const bare = join(temp, 'origin.git');
  const metadata = {
    state: 'open', number: 14,
    head: { sha: mutateHead ? 'a'.repeat(40) : head, ref: 'feature', repo: { full_name: 'owner/fixture', clone_url: bare } },
    base: { sha: baseHead, ref: 'main', repo: { full_name: 'owner/fixture', clone_url: bare } },
    url: 'https://github.com/owner/fixture/pull/14',
  };
  writeFileSync(join(temp, 'pr-view.json'), JSON.stringify({ number: 14, url: metadata.url }));
  writeFileSync(join(temp, 'pr-api.json'), JSON.stringify(metadata));
}

export function mutatePullRequestRemote(fixture) {
  const bare = fixture.bare;
  if (!bare) throw new Error('Initialize the PR repository before enabling remote mutation.');
  fixture.setReviewMutation(() => {
    const current = execFileSync('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/feature'], { encoding: 'utf8' }).trim();
    if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixture.cwd, encoding: 'utf8' }).trim() !== current) throw new Error('Local PR branch no longer matches fixture origin.');
    writeFileSync(join(fixture.cwd, 'source.txt'), 'PR source advanced during review\n');
    execFileSync('git', ['add', 'source.txt'], { cwd: fixture.cwd });
    const env = { ...process.env, GIT_AUTHOR_NAME: 'Native fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Native fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
    execFileSync('git', ['commit', '-qm', 'PR head moved during review'], { cwd: fixture.cwd, env });
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixture.cwd, encoding: 'utf8' }).trim();
    execFileSync('git', ['push', '-q', bare, 'HEAD:feature'], { cwd: fixture.cwd });
    const metadataPath = join(fixture.temp, 'pr-api.json');
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    metadata.head.sha = commit;
    writeFileSync(metadataPath, JSON.stringify(metadata));
    fixture.advancedPullRequestHead = commit;
  });
}
