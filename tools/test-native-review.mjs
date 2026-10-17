#!/usr/bin/env node
/** Real-host independent review receipts must bind to exact Git source. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeFixture, streamText } from './native-fixture.mjs';

let reviewRequests = 0;
const host = await nativeFixture({
  plugin: process.argv[2],
  pluginOptions: { reviewModel: { providerID: 'ctg-fixture', id: 'fixture' } },
  respond(body, res) {
    const text = JSON.stringify(body.messages);
    const snapshot = text.match(/Snapshot(?: SHA-256)?: ([a-f0-9]+)/)?.[1];
    const head = text.match(/HEAD: ([a-f0-9]+)/)?.[1];
    if (!snapshot || !head || !text.includes('REVIEW_JSON:')) return streamText(res);
    reviewRequests++;
    streamText(res, `Fixture source review complete.\nREVIEW_JSON: ${JSON.stringify({ version: 1, snapshot, head, findings: [] })}\nVERDICT: APPROVE`);
  },
});
try {
  const git = (...args) => execFileSync('git', args, { cwd: host.cwd, encoding: 'utf8' });
  git('init', '--initial-branch=main');
  await writeFile(join(host.cwd, 'fixture.txt'), 'review baseline\n');
  git('add', 'fixture.txt');
  git('-c', 'user.name=CTG Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Review fixture');
  await host.active();
  const worker = await host.client.session.create({ location: host.location, model: host.model, title: 'Implementation session' }, host.request());
  const rpc = async method => (await host.client.rpc.call({ rpcID: 'carthagent.workspace', method,
    input: { sessionID: worker.id }, location: host.location }, host.request())).output;
  const before = await rpc('review');
  assert.equal(before.status, 'unreviewed');
  const result = await rpc('startReview');
  assert.equal(result.status, 'approved');
  assert.notEqual(result.sessionID, worker.id);
  const reviewer = await host.client.session.get({ sessionID: result.sessionID }, host.request());
  assert.equal(reviewer.parentID, undefined);
  assert.equal(reviewer.location.directory, host.cwd);
  assert.equal((await rpc('review')).status, 'approved');
  const count = reviewRequests;
  await assert.rejects(rpc('startReview'));
  assert.equal(reviewRequests, count, 'Already approved source must not launch another review');
  await host.stop();
  await host.start();
  await host.active();
  assert.equal((await rpc('review')).status, 'approved', 'Review receipt survives service restart');
  await writeFile(join(host.cwd, 'fixture.txt'), 'changed source\n');
  assert.equal((await rpc('review')).status, 'stale', 'Any source change invalidates approval');
  console.log(JSON.stringify({ host: '2.0.32', independentReview: 'passed', persistedReceipt: 'passed', staleInvalidation: 'passed' }));
} catch (error) {
  console.error(host.output);
  const reviews = join(host.cwd, '.harness/reviews');
  for (const entry of await readdir(reviews).catch(() => [])) {
    if (entry.endsWith('.json')) console.error(await readFile(join(reviews, entry), 'utf8'));
  }
  const inventory = await host.client.session.list({ location: host.location }, host.request());
  for (const session of inventory.data ?? []) console.error(JSON.stringify({ title: session.title, messages: await host.client.session.context({ sessionID: session.id }, host.request()) }));
  throw error;
} finally {
  await host.close();
}
