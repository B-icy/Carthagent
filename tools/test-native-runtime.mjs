#!/usr/bin/env node
/** Exercise CTG's wrappers, including resumed failures, against the real host. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureService, stopService } from '../lib/opencode/service.mjs';
import { runHeadless } from '../lib/opencode/headless.mjs';
import { nativeFixture, streamText } from './native-fixture.mjs';

let stallStarted;
const stalled = new Promise(resolve => { stallStarted = resolve; });
const host = await nativeFixture({
  plugin: process.argv[2],
  respond(body, res) {
    const text = JSON.stringify([...body.messages].reverse().find(message => message.role === 'user'));
    if (text.includes('WRAPPER_STALL')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.flushHeaders();
      stallStarted();
      return;
    }
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
  const readTool = toolTurn.messages.flatMap(message => message.content ?? []).find(part => part.type === 'tool' && part.name === 'read');
  assert.equal(readTool?.state.status, 'completed', 'The native read tool must really complete before the final answer');
  assert.ok(readTool.state.content.some(part => part.type === 'text' && part.text.includes('Read this through the native tool.')));
  assert.equal(toolTurn.result?.text, 'FINAL_AFTER_TOOL', 'Return the final assistant after tools, not the initial tool-call message');
  let failure;
  try { failure = await runHeadless(service, host.cwd, 'WRAPPER_FAILURE', { ...common, sessionID: first.session.id }); }
  catch (error) { failure = { error }; }
  assert.ok(failure.error || failure.result?.error || failure.result?.status === 'error' || failure.outcome === 'failed',
    `Provider failure must not return a previous successful assistant: ${JSON.stringify(failure)}`);
  const recovered = await runHeadless(service, host.cwd, 'WRAPPER_SECOND', { ...common, sessionID: first.session.id });
  assert.equal(recovered.result?.text, 'SECOND_TURN');
  const cancel = new AbortController();
  const interrupted = runHeadless(service, host.cwd, 'WRAPPER_STALL', { ...common, sessionID: first.session.id, signal: cancel.signal });
  let admissionTimer;
  try {
    await Promise.race([stalled, new Promise((_, reject) => {
      admissionTimer = setTimeout(() => reject(Error('Wrapper cancellation fixture did not reach provider')), 10_000);
    })]);
    const neighbor = await runHeadless(service, host.cwd, 'WRAPPER_SECOND', common);
    assert.equal(neighbor.result?.text, 'SECOND_TURN', 'A stalled session must not block its neighbor');
  } finally {
    clearTimeout(admissionTimer);
    cancel.abort(Error('Offline wrapper cancellation'));
  }
  const cancelled = await interrupted;
  assert.equal(cancelled.reason, 'aborted');
  assert.equal(cancelled.outcome, 'interrupted');
  assert.notEqual(cancelled.result?.text, 'SECOND_TURN', 'An interrupted resumed turn must not reuse a prior answer');
  const afterCancel = await runHeadless(service, host.cwd, 'WRAPPER_SECOND', { ...common, sessionID: first.session.id });
  assert.equal(afterCancel.result?.text, 'SECOND_TURN');
  let preAborted;
  try {
    preAborted = await runHeadless(service, host.cwd, 'MUST_NOT_BE_ADMITTED', {
      ...common, sessionID: first.session.id, signal: AbortSignal.abort(Error('Already cancelled')),
    });
  } catch (error) { preAborted = { error }; }
  assert.ok(preAborted.error || preAborted.outcome === 'interrupted', 'A pre-aborted invocation cannot inherit an earlier successful outcome');
  assert.equal(preAborted.result, undefined, 'A pre-aborted invocation has no current-turn assistant response');
  let unroutable;
  try {
    unroutable = await runHeadless(service, host.cwd, 'UNAVAILABLE_MODEL', {
      ...common, session: { model: { providerID: 'absent-fixture', id: 'missing' } },
    });
  } catch (error) { unroutable = { error }; }
  assert.ok(unroutable.error || unroutable.outcome === 'failed' || unroutable.session?.outcome === 'failed',
    `A failure without an assistant must expose a failed terminal outcome: ${JSON.stringify(unroutable)}`);
  assert.equal(await stopService(options), true);
  const restarted = await ensureService(options);
  assert.notEqual(restarted.info.id, service.info.id, 'Restart registers a fresh owned service identity');
  const resumed = await runHeadless(restarted, host.cwd, 'WRAPPER_SECOND', { ...common, sessionID: first.session.id });
  assert.equal(resumed.session.id, first.session.id);
  assert.equal(resumed.result?.text, 'SECOND_TURN', 'Session state remains usable after the owned service restarts');
  assert.equal(await stopService(options), true);
  console.log(JSON.stringify({ host: '2.0.32', serviceReuse: 'passed', repeatedTurns: 'passed', finalAnswerAfterTool: 'passed', successMetadata: 'passed', failure: 'passed', recovery: 'passed', cancellation: 'passed', neighboringSession: 'passed', serviceRestart: 'passed' }));
} finally {
  try { await stopService(options); }
  finally { await host.close(); }
}
