#!/usr/bin/env node
/** Exercise CTG's wrappers, including resumed failures, against the real host. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureService, stopService } from '../lib/opencode/service.mjs';
import { runHeadless } from '../lib/opencode/headless.mjs';
import { nativeFixture, streamText } from './native-fixture.mjs';

const host = await nativeFixture({
  plugin: process.argv[2],
  respond(body, res) {
    const text = JSON.stringify([...body.messages].reverse().find(message => message.role === 'user'));
    if (text.includes('WRAPPER_TOOL') && !body.messages.some(message => message.role === 'tool')) {
      assert.ok(body.tools.some(tool => tool.function?.name === 'read'), 'Native host must advertise the requested read tool');
      const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
        id: 'runtime-tool', object: 'chat.completion.chunk', created: 1, model: 'fixture',
        choices: [{ index: 0, delta, finish_reason }],
      })}\n\n`;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`${chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'wrapper-read', type: 'function',
        function: { name: 'read', arguments: JSON.stringify({ path: join(host.cwd, 'wrapper-tool.txt') }) } }] })}${chunk({}, 'tool_calls')}data: [DONE]\n\n`);
      return;
    }
    if (text.includes('WRAPPER_FAILURE')) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Offline wrapper rejection', type: 'invalid_request_error' } }));
    } else streamText(res, text.includes('WRAPPER_TOOL') ? 'FINAL_AFTER_TOOL' : text.includes('WRAPPER_SECOND') ? 'SECOND_TURN' : 'FIRST_TURN');
  },
});
const options = { root: join(host.temp, 'runtime'), pluginPath: process.argv[2] ?? join(import.meta.dirname, '../plugins/carthagent') };
try {
  options.profile = JSON.parse(await readFile(join(host.temp, 'config/opencode/opencode.json'), 'utf8'));
  const service = await ensureService(options);
  const reused = await ensureService(options);
  assert.equal(reused.info.pid, service.info.pid);
  assert.equal(reused.url, service.url);
  const common = { timeout: 30_000, env: { PATH: process.env.PATH }, session: {
    model: host.model, metadata: { 'carthagent.options': { guide: false } },
  } };
  const first = await runHeadless(service, host.cwd, 'WRAPPER_FIRST', common);
  assert.equal(first.result?.text, 'FIRST_TURN');
  assert.equal(first.outcome, 'succeeded');
  assert.equal(first.terminal, true);
  assert.equal(first.budgetReason, undefined, 'A successful terminal outcome has no budget failure reason');
  const second = await runHeadless(service, host.cwd, 'WRAPPER_SECOND', { ...common, sessionID: first.session.id });
  assert.equal(second.result?.text, 'SECOND_TURN', 'Resume must return the current turn');
  await writeFile(join(host.cwd, 'wrapper-tool.txt'), 'Read this through the native tool.\n');
  const toolTurn = await runHeadless(service, host.cwd, 'WRAPPER_TOOL', common);
  assert.equal(toolTurn.outcome, 'succeeded');
  assert.equal(toolTurn.result?.text, 'FINAL_AFTER_TOOL', 'Return the final assistant after tools, not the initial tool-call message');
  let failure;
  try { failure = await runHeadless(service, host.cwd, 'WRAPPER_FAILURE', { ...common, sessionID: first.session.id }); }
  catch (error) { failure = { error }; }
  assert.ok(failure.error || failure.result?.error || failure.result?.status === 'error' || failure.outcome === 'failed',
    `Provider failure must not return a previous successful assistant: ${JSON.stringify(failure)}`);
  const recovered = await runHeadless(service, host.cwd, 'WRAPPER_SECOND', { ...common, sessionID: first.session.id });
  assert.equal(recovered.result?.text, 'SECOND_TURN');
  let unroutable;
  try {
    unroutable = await runHeadless(service, host.cwd, 'UNAVAILABLE_MODEL', {
      ...common, session: { model: { providerID: 'absent-fixture', id: 'missing' } },
    });
  } catch (error) { unroutable = { error }; }
  assert.ok(unroutable.error || unroutable.outcome === 'failed' || unroutable.session?.outcome === 'failed',
    `A failure without an assistant must expose a failed terminal outcome: ${JSON.stringify(unroutable)}`);
  assert.equal(await stopService(options), true);
  console.log(JSON.stringify({ host: '2.0.32', serviceReuse: 'passed', repeatedTurns: 'passed', failure: 'passed', recovery: 'passed' }));
} finally {
  try { await stopService(options); }
  finally { await host.close(); }
}
