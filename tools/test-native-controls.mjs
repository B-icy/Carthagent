#!/usr/bin/env node
/** Real host, local provider only. Verifies admission, framing and compaction. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { OpenCode } from '@opencode/client';

const temp = await mkdtemp(join(tmpdir(), 'ctg-native-controls-'));
const plugin = resolve(import.meta.dirname, '../plugins/carthagent');
const requests = [];
const provider = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw || '{}');
  requests.push(body);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = delta => `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`;
  res.write(event({ role: 'assistant', content: 'Fixture response complete.' }));
  res.end(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } })}\n\ndata: [DONE]\n\n`);
});
let child;
let output = '';
try {
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const cwd = join(temp, 'project');
  const config = join(temp, 'config/opencode');
  await Promise.all([mkdir(cwd), mkdir(config, { recursive: true }), mkdir(join(temp, 'home'))]);
  await writeFile(join(config, 'opencode.json'), JSON.stringify({
    plugins: [plugin], update: 'disable', model: 'ctg-fixture/fixture',
    providers: { 'ctg-fixture': {
      package: '@opencode/ai/providers/openai-compatible',
      settings: { baseURL: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: 'offline-fixture' },
      models: { fixture: { limit: { context: 32000, output: 1024 } } },
    } },
  }));
  const password = randomBytes(24).toString('hex');
  child = spawn(process.env.CTG_OPENCODE_BIN ?? 'opencode', ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
    cwd, env: {
      PATH: process.env.PATH, HOME: join(temp, 'home'),
      XDG_CONFIG_HOME: join(temp, 'config'), XDG_DATA_HOME: join(temp, 'data'),
      XDG_CACHE_HOME: join(temp, 'cache'), XDG_STATE_HOME: join(temp, 'state'),
      OPENCODE_DB: join(temp, 'db.sqlite'), OPENCODE_SERVER_PASSWORD: password,
    }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const baseUrl = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(Error(`Host startup timeout: ${output}`)), 30_000);
    const collect = chunk => {
      output = (output + chunk).slice(-16384);
      const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (url) { clearTimeout(timer); done(url); }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(Error(`Host exited ${code}: ${output}`)); });
  });
  const client = OpenCode.make({ baseUrl, headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } });
  const request = () => ({ signal: AbortSignal.timeout(30_000) });
  const location = { directory: cwd };
  const a = await client.session.create({ location, title: 'Framed', model: { providerID: 'ctg-fixture', id: 'fixture' } }, request());
  const b = await client.session.create({ location, title: 'Raw', model: { providerID: 'ctg-fixture', id: 'fixture' } }, request());
  const rpc = (method, input) => client.rpc.call({ rpcID: 'carthagent.session', method, input, location }, request());
  const deadline = Date.now() + 15_000;
  while (true) {
    const inventory = await client.plugin.list({ location }, request());
    if (inventory.data.some(p => p.id === 'carthagent' && p.state.status === 'active')) break;
    assert.ok(Date.now() < deadline, 'CTG plugin activation timed out');
    await new Promise(done => setTimeout(done, 100));
  }
  assert.deepEqual((await rpc('framing', { sessionID: a.id, enabled: true })).output, { enabled: true });
  await Promise.all([
    client.session.prompt({ sessionID: a.id, text: 'Implement a parser' }, request()),
    client.session.prompt({ sessionID: b.id, text: 'Implement a parser', metadata: { 'ctg.raw': true } }, request()),
  ]);
  await Promise.all([client.session.wait({ sessionID: a.id }, request()), client.session.wait({ sessionID: b.id }, request())]);
  const aMessages = await client.session.context({ sessionID: a.id }, request());
  const bMessages = await client.session.context({ sessionID: b.id }, request());
  assert.notEqual(aMessages.find(m => m.type === 'user')?.text, 'Implement a parser');
  assert.equal(bMessages.find(m => m.type === 'user')?.text, 'Implement a parser');
  assert.ok(aMessages.some(m => m.type === 'assistant'), JSON.stringify(aMessages));
  assert.ok(bMessages.some(m => m.type === 'assistant'), JSON.stringify(bMessages));
  assert.equal(aMessages.at(-1).outcome, 'succeeded');
  assert.equal(bMessages.at(-1).outcome, 'succeeded');
  const marker = 'Preserve fixture decision 3e7b9';
  await rpc('compact', { sessionID: a.id, notes: marker });
  await client.session.wait({ sessionID: a.id }, request());
  const compacted = await client.session.context({ sessionID: a.id }, request());
  assert.ok(compacted.some(m => m.type === 'compaction'), JSON.stringify(compacted));
  assert.ok(requests.some(body =>
    JSON.stringify(body.messages).includes(marker)
    && JSON.stringify(body.messages.at(-1)).includes('structured summary')
  ), 'User notes reached the actual native summary request');
  console.log(JSON.stringify({ host: (await client.server.info(request())).version, sessions: 2, providerRequests: requests.length, framing: 'passed', raw: 'passed', compaction: 'passed' }));
} catch (error) {
  console.error(output);
  throw error;
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(timer);
  }
  provider.closeAllConnections();
  await new Promise(done => provider.close(done));
  await rm(temp, { recursive: true, force: true });
}
