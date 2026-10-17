import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { once } from 'node:events';
import { stopService, ensureService } from '../../lib/opencode/service.mjs';
import { OpenCode } from '@opencode/client';

const root = resolve(import.meta.dirname, '../..');
const binary = process.env.CTG_OPENCODE_BIN || join(root, 'node_modules/@opencode/cli/bin/opencode.exe');

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

export async function nativeCliFixture(t, { verdict = 'APPROVE', omitVerdict = false } = {}) {
  if (process.platform === 'win32') throw new Error('native CLI process fixtures currently require POSIX shell scripts');
  const temp = mkdtempSync(join(tmpdir(), 'ctg-native-cli-process-'));
  t.after(async () => {
    await stopService({ root: profile }).catch(() => {});
    rmSync(temp, { recursive: true, force: true });
    await new Promise(resolveClose => provider.close(resolveClose));
  });
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
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const messages = body.messages || [];
      const prompt = [...messages].reverse().find(message => message.role === 'user')?.content || '';
      if (fixtureState.onReviewRequest && prompt.includes('Review this exact GitHub pull request source snapshot')) {
        try { await fixtureState.onReviewRequest(); }
        catch (error) { fixtureState.mutationError = error; }
      }
      response.end(modelResponse(messages, { verdict, omitVerdict }));
    })().catch(error => {
      if (!response.headersSent) response.writeHead(500);
      response.end(error.message);
    });
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  writeFileSync(join(profile, 'config', 'opencode', 'opencode.json'), JSON.stringify({
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
    PATH: `${join(temp, 'bin')}${delimiter}${process.env.PATH}`,
    OPENCODE_DISABLE_AUTOUPDATE: 'true',
  };
  mkdirSync(join(temp, 'bin'));
  const gh = join(temp, 'bin', 'gh');
  writeFileSync(gh, `#!/bin/sh
if [ "$1" = pr ] && [ "$2" = view ]; then cat "${join(temp, 'pr-view.json')}"; exit $?; fi
if [ "$1" = api ]; then cat "${join(temp, 'pr-api.json')}"; exit $?; fi
echo unsupported gh fixture request >&2; exit 2
`);
  chmodSync(gh, 0o755);
  const run = (...args) => new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [join(root, 'bin/ctg.mjs'), ...args], {
      cwd, env: { ...env, CTG_NATIVE_RUNTIME_ROOT: root }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGTERM'), 30_000);
    child.once('error', error => { clearTimeout(timer); rejectRun(error); });
    child.once('close', (status, signal) => {
      clearTimeout(timer);
      resolveRun({ status, signal, stdout, stderr });
    });
  });
  const service = await ensureService({ root: profile, pluginPath: join(root, 'plugins/carthagent') });
  const client = OpenCode.make({ baseUrl: service.url, headers: service.headers });
  const request = { signal: AbortSignal.timeout(15_000) };
  await client.session.create({
    location: { directory: cwd },
    model: { providerID: 'ctg-fixture', id: 'fixture' },
    title: 'Activate native review fixture',
  }, request);
  const activatedBy = Date.now() + 15_000;
  while (true) {
    const [plugins, agents] = await Promise.all([
      client.plugin.list({ location: { directory: cwd } }, request),
      client.agent.list({ location: { directory: cwd } }, request),
    ]);
    if (plugins.data.some(plugin => plugin.id === 'carthagent' && plugin.state.status === 'active')
      && agents.data.some(agent => agent.id === 'build')) break;
    if (plugins.data.some(plugin => plugin.id === 'carthagent' && plugin.state.status === 'error')) {
      throw new Error(`Native fixture plugin failed to activate: ${JSON.stringify(plugins.data)}`);
    }
    if (Date.now() >= activatedBy) throw new Error(`Native review fixture did not activate plugin/build agent: ${JSON.stringify({ plugins: plugins.data, agents: agents.data })}`);
    await new Promise(resolveDelay => setTimeout(resolveDelay, 50));
  }
  return { cwd, env, temp, run, git, setReviewMutation(callback) { fixtureState.onReviewRequest = callback; } };
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
  });
}
