#!/usr/bin/env node
/** Exercise CTG's wrappers, including resumed failures, against the real host. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureService, stopService } from '../lib/opencode/service.mjs';
import { runHeadless } from '../lib/opencode/headless.mjs';
import { nativeFixture, streamText } from './native-fixture.mjs';

const host = await nativeFixture({
  plugin: process.argv[2],
  respond(body, res) {
    const text = JSON.stringify(body.messages.at(-1));
    if (text.includes('WRAPPER_FAILURE')) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Offline wrapper rejection', type: 'invalid_request_error' } }));
    } else streamText(res, text.includes('WRAPPER_SECOND') ? 'SECOND_TURN' : 'FIRST_TURN');
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
  const second = await runHeadless(service, host.cwd, 'WRAPPER_SECOND', { ...common, sessionID: first.session.id });
  assert.equal(second.result?.text, 'SECOND_TURN', 'Resume must return the current turn');
  let failure;
  try { failure = await runHeadless(service, host.cwd, 'WRAPPER_FAILURE', { ...common, sessionID: first.session.id }); }
  catch (error) { failure = { error }; }
  assert.ok(failure.error || failure.result?.error || failure.result?.status === 'error' || failure.outcome === 'failed',
    `Provider failure must not return a previous successful assistant: ${JSON.stringify(failure)}`);
  const recovered = await runHeadless(service, host.cwd, 'WRAPPER_SECOND', { ...common, sessionID: first.session.id });
  assert.equal(recovered.result?.text, 'SECOND_TURN');
  assert.equal(await stopService(options), true);
  console.log(JSON.stringify({ host: '2.0.32', serviceReuse: 'passed', repeatedTurns: 'passed', failure: 'passed', recovery: 'passed' }));
} finally {
  try { await stopService(options); }
  finally { await host.close(); }
}
