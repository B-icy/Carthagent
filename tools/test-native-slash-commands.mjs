#!/usr/bin/env node
/** Run real slash-command acceptance with a trusted owned runtime and loopback-only provider. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflightNativeTestRuntimeArtifact } from './native-runtime-identity.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ownedRoot = process.env.CTG_OWNED_OPENCODE_RUNTIME;
const manifestPath = process.env.CTG_TEST_RUNTIME_RELEASE_MANIFEST;
assert.ok(ownedRoot, 'CTG_OWNED_OPENCODE_RUNTIME must select the explicit candidate artifact');
assert.ok(manifestPath, 'CTG_TEST_RUNTIME_RELEASE_MANIFEST must point at the trusted release manifest');
const preflight = await preflightNativeTestRuntimeArtifact({ ownedRoot, expectedManifestPath: manifestPath });
const binary = join(resolve(ownedRoot), `cli-${process.platform}-${process.arch}`, 'bin', process.platform === 'win32' ? 'opencode.exe' : 'opencode');

const artifact = process.env.CTG_SLASH_ACCEPTANCE_ARTIFACT ?? join(root, `ctg-slash-acceptance-${process.pid}.json`);
const temp = await mkdtemp(join(tmpdir(), 'ctg-slash-acceptance-'));
const fixturePath = join(temp, 'fixture.json');
const logsPath = process.env.CTG_SLASH_ACCEPTANCE_LOGS ?? join(temp, 'fixture.log');
let fixture;
let fixtureChild;
try {
  const script = `
import { once } from 'node:events';
import { writeFile as writeFixtureFile } from 'node:fs/promises';
import { join as joinPath } from 'node:path';
import { nativeFixture } from './tools/native-fixture.mjs';
const plugin = process.argv[1];
const host = await nativeFixture({ plugin, verifyInventory: true,
  env: { CTG_OWNED_OPENCODE_RUNTIME: process.env.CTG_OWNED_OPENCODE_RUNTIME,
    CTG_TEST_RUNTIME_RELEASE_MANIFEST: process.env.CTG_TEST_RUNTIME_RELEASE_MANIFEST },
  respond(body, response) {
    const messages = body.messages ?? [];
    const latest = [...messages].reverse().find(message => message.role === 'user');
    const text = typeof latest?.content === 'string' ? latest.content : JSON.stringify(latest?.content ?? '');
    globalThis.providerPrompts ??= [];
    globalThis.providerPrompts.push(text);
    void writeFixtureFile(joinPath(host.temp, 'provider-prompts.json'), JSON.stringify(globalThis.providerPrompts));
    const reply = text.includes('RAW_SENTINEL') ? 'RAW_FIXTURE_REPLY'
      : text.includes('framed task marker') ? 'GUIDE_FIXTURE_REPLY'
      : 'FIXTURE_REPLY';
    const chunk = (delta, finish_reason = null) => 'data: ' + JSON.stringify({ id:'ctg-slash-offline', object:'chat.completion.chunk', created:1, model:'fixture', choices:[{index:0,delta,finish_reason}] }) + '\\n\\n';
    response.writeHead(200, { 'content-type':'text/event-stream', connection:'close' });
    response.end(chunk({role:'assistant',content:reply}) + chunk({},'stop') + 'data: [DONE]\\n\\n');
  }});
try {
 const session = await host.client.session.create({ location:host.location, model:host.model, title:'slash command acceptance' }, host.request());
 await host.active();
 const info = { temp:host.temp, cwd:host.cwd, baseUrl:host.baseUrl, password:host.password,
   sessionID:session.id, pluginReadiness:host.pluginObservation,
    providerRequests:host.requests.length, providerLog:joinPath(host.temp, 'provider-prompts.json') };
 process.stdout.write(JSON.stringify(info)+'\\n');
 process.once('SIGTERM', async()=>{await host.close({preserveTemp:false});process.exit(0)});
 await new Promise(()=>{});
} catch(error) { await host.close({preserveTemp:false}); throw error; }
`;
  fixtureChild = spawn(process.execPath, ['--input-type=module', '-e', script, join(root, 'plugins/carthagent')], {
    cwd: root,
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      LANG: process.env.LANG ?? 'C.UTF-8',
      CTG_OWNED_OPENCODE_RUNTIME: resolve(ownedRoot),
      CTG_TEST_RUNTIME_RELEASE_MANIFEST: resolve(manifestPath),
      NODE_OPTIONS: process.env.NODE_OPTIONS ?? '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  fixtureChild.stderr.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-12000); });
  const line = await new Promise((resolveLine, reject) => {
    let stdout = '';
    const timer = setTimeout(() => reject(new Error(`native fixture startup timeout\n${stderr}`)), 60_000);
    fixtureChild.stdout.setEncoding('utf8').on('data', chunk => {
      stdout += chunk;
      const newline = stdout.indexOf('\n');
      if (newline !== -1) { clearTimeout(timer); resolveLine(stdout.slice(0, newline)); }
    });
    fixtureChild.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`native fixture exited ${code ?? signal}: ${stderr}`));
    });
  });
  fixture = JSON.parse(line);
  assert.equal(fixture.pluginReadiness?.pluginId, 'carthagent');
  assert.equal(fixture.pluginReadiness?.observed, 'active');
  await writeFile(fixturePath, JSON.stringify(fixture));
  const python = process.env.PYTHON ?? 'python3';
  const args = [join(root, 'tools/test-native-slash-commands.py'), '--binary', binary,
    '--owned-root', resolve(ownedRoot), '--release-manifest', resolve(manifestPath),
    '--fixture', fixturePath, '--artifact', artifact];
  const result = spawnSync(python, args, {
    cwd: root, encoding: 'utf8', timeout: 180_000,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: process.env.LANG ?? 'C.UTF-8',
      CTG_OWNED_OPENCODE_RUNTIME: resolve(ownedRoot),
      CTG_TEST_RUNTIME_RELEASE_MANIFEST: resolve(manifestPath),
      CTG_SLASH_ACCEPTANCE_LOGS: logsPath },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  await writeFile(logsPath, JSON.stringify({ stdout: result.stdout, stderr: result.stderr,
    status: result.status, signal: result.signal, error: result.error?.message ?? null }, null, 2) + '\n');
  if (result.error) throw result.error;
  const proof = JSON.parse(await readFile(artifact, 'utf8'));
  if (proof.status === 'PARTIAL') {
    process.stderr.write(`Slash acceptance partial; inspect retained proof and logs: ${artifact} · ${logsPath}\n`);
    process.exitCode = 2;
  } else {
    assert.equal(result.status, 0, `slash acceptance failed; retained logs: ${logsPath}`);
    assert.equal(proof.status, 'PASS');
  }
  assert.equal(proof.binarySha256, preflight.identity.binarySha256);
  assert.equal(proof.scope, 'Linux POSIX PTY; actual native plugin slash submissions; offline loopback provider');
  process.stdout.write(`Retained acceptance proof: ${artifact}\nRetained runner logs: ${logsPath}\n`);
} finally {
  if (fixtureChild && fixtureChild.exitCode === null) {
    fixtureChild.kill('SIGTERM');
    await Promise.race([new Promise(resolveExit => fixtureChild.once('exit', resolveExit)), new Promise(resolveExit => setTimeout(resolveExit, 7000))]);
    if (fixtureChild.exitCode === null) fixtureChild.kill('SIGKILL');
  }
  // Fixture files are outside the repository; proof and logs are retained.
  await rm(temp, { recursive: true, force: true });
}
