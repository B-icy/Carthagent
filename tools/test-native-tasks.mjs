#!/usr/bin/env node
/** Real Git worktrees and native root sessions through the shipped workspace RPC. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeFixture } from './native-fixture.mjs';

const host = await nativeFixture({ plugin: process.argv[2] });
try {
  const git = (...args) => execFileSync('git', args, { cwd: host.cwd, encoding: 'utf8' });
  git('init', '--initial-branch=main');
  await writeFile(join(host.cwd, 'fixture.txt'), 'baseline\n');
  git('add', 'fixture.txt');
  git('-c', 'user.name=CTG Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Offline fixture');
  await host.active();
  const rpc = async (method, input) => (await host.client.rpc.call({ rpcID: 'carthagent.workspace', method, input, location: host.location }, host.request())).output;
  const first = await rpc('createTask', { task: 'First isolated task' });
  const second = await rpc('createTask', { task: 'Second isolated task' });
  assert.notEqual(first.sessionID, second.sessionID);
  assert.notEqual(first.directory, second.directory);
  assert.notEqual(first.directory, host.cwd);
  const sessions = await Promise.all([first, second].map(task => host.client.session.get({ sessionID: task.sessionID }, host.request())));
  for (const [index, session] of sessions.entries()) {
    assert.equal(session.parentID, undefined);
    assert.equal(session.location.directory, [first, second][index].directory);
  }
  assert.equal(sessions[0].projectID, sessions[1].projectID);
  await writeFile(join(first.directory, 'fixture.txt'), 'first task edit\n');
  assert.equal(await readFile(join(second.directory, 'fixture.txt'), 'utf8'), 'baseline\n');
  assert.equal(await readFile(join(host.cwd, 'fixture.txt'), 'utf8'), 'baseline\n');
  const snapshot = await rpc('snapshot', {});
  assert.equal(snapshot.tasks.length, 2);
  assert.deepEqual(new Set(snapshot.sessions.map(session => session.id)), new Set([first.sessionID, second.sessionID]));
  for (const task of [first, second]) {
    assert.deepEqual(await rpc('open', { sessionID: task.sessionID }), { opened: true, directory: task.directory });
  }
  await host.stop();
  await host.start();
  await host.active();
  const restored = await rpc('snapshot', {});
  assert.deepEqual(restored.tasks.map(task => task.id).sort(), snapshot.tasks.map(task => task.id).sort());
  assert.deepEqual(restored.sessions.map(session => session.id).sort(), snapshot.sessions.map(session => session.id).sort());
  console.log(JSON.stringify({ host: '2.0.32', worktrees: 2, rootSessions: 2, isolation: 'passed', restart: 'passed' }));
} catch (error) {
  console.error(host.output);
  throw error;
} finally {
  await host.close();
}
