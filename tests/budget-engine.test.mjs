import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

for (const mode of ['tools', 'seconds', 'repairs']) test(`actual engine stops ${mode}, restores budget and accepts explicit reset offline`, { timeout: 45000 }, async t => {
  const cwd = mkdtempSync(join(tmpdir(), 'budget café '));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  let calls = 0;
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      calls++;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (mode === 'seconds') { res.flushHeaders(); return; }
      const chunk = { id: 'local', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: `call${calls}`, type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: 'input.txt' }) } }] }, finish_reason: null }] };
      if (mode === 'repairs') {
        if (calls === 1) chunk.choices[0].delta.tool_calls[0].function = { name: 'delivery_plan', arguments: JSON.stringify({ goal: 'unfinished fixture', assumptions: [], artifacts: ['.'], steps: ['Implement'], acceptance: [{ requirement: 'fixture', checks: ['check'] }], checks: [{ id: 'check', kind: 'test', argv: [process.execPath, '-e', 'process.exit(0)'], timeoutSeconds: 5 }] }) };
        else chunk.choices[0].delta = { role: 'assistant', content: 'Incomplete fixture response' };
      }
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      chunk.choices = [{ index: 0, delta: {}, finish_reason: mode === 'repairs' && calls > 1 ? 'stop' : 'tool_calls' }];
      res.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const agent = join(cwd, 'agent'); mkdirSync(agent);
  writeFileSync(join(agent, 'models.json'), JSON.stringify({ providers: { localtest: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'dummy', models: [{ id: 'fixture', contextWindow: 128000, maxTokens: 1024 }] } } }));
  writeFileSync(join(cwd, 'input.txt'), 'café ✓');
  const session = join(cwd, 'session.jsonl');
  const cli = fileURLToPath(new URL('../bin/pi2.mjs', import.meta.url));
  let beforeRestore = -1;
  async function run(prompt) {
    const child = spawn(process.execPath, [cli, '-p', '--no-guide', '--provider', 'localtest', '--model', 'fixture', '--session', session, '--max-tools', mode === 'tools' ? '1' : '0', '--max-seconds', mode === 'seconds' ? '1' : '10', '--max-repairs', mode === 'repairs' ? '1' : '0', prompt], { cwd, env: { ...process.env, PI_OFFLINE: '1', PI2_CODING_AGENT_DIR: agent, PI_CODING_AGENT_DIR: agent } });
    child.stdin.end();
    let output = ''; child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d);
    const timer = setTimeout(() => child.kill(), 15000);
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    clearTimeout(timer);
    // Print mode reports the last assistant error even for a command-only reset.
    // Reset is verified from persisted state and subsequent successful tool use.
    assert.equal(code, (mode === 'seconds' || mode === 'repairs') && calls !== beforeRestore ? 0 : 1, `${output}\nrequests=${calls}\nsession=${readFileSync(session, 'utf8').slice(-6000)}`);
    return readFileSync(session, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  }
  let entries = await run('Read input.txt repeatedly');
  const toolResults = e => e.filter(x => x.type === 'message' && x.message?.role === 'toolResult' && !x.message.isError);
  assert.equal(toolResults(entries).length, mode === 'seconds' ? 0 : 1);
  assert.equal(entries.filter(e => e.customType === 'delivery-budget-v1').at(-1).data.stopped, { seconds: 'elapsed-time', tools: 'tool-calls', repairs: 'repair-rounds' }[mode]);
  assert.ok(calls <= (mode === 'repairs' ? 3 : 2), `unexpected followups: ${calls}`);
  const before = calls;
  beforeRestore = calls;
  entries = await run('Read again');
  assert.equal(calls, before, 'restored stop must not call provider');
  assert.equal(toolResults(entries).length, mode === 'seconds' ? 0 : 1);
  entries = await run('/delivery-budget-reset');
  beforeRestore = -1;
  assert.equal(entries.filter(e => e.customType === 'delivery-budget-v1').at(-1).data.stopped, null);
  entries = await run('Read again');
  assert.equal(toolResults(entries).length, mode === 'seconds' ? 0 : mode === 'repairs' ? 1 : 2);
  assert.ok(calls > before, 'explicit reset admits a fresh request');
});
