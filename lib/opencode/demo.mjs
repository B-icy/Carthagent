import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../delivery.mjs';

/** Run an honest, isolated offline walkthrough; it never contacts a provider. */
export async function runOfflineDemo({ io = console, execute = runCommand, nodeBinary = process.env.CTG_NODE_EXECUTABLE || process.execPath } = {}) {
  const workspace = await mkdtemp(join(tmpdir(), 'carthagent-native-demo-'));
  try {
    await mkdir(join(workspace, 'test'));
    await writeFile(join(workspace, 'app.mjs'), `export function summarize(items) {
  return items.filter(item => item.done).map(item => item.title).join(', ');
}
`);
    await writeFile(join(workspace, 'test', 'app.test.mjs'), `import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../app.mjs';

test('summarize includes completed items and preserves their order', () => {
  assert.equal(summarize([{ title: 'Plan', done: true }, { title: 'Ship', done: false }, { title: 'Test', done: true }]), 'Plan, Test');
});

test('summarize handles an empty list', () => {
  assert.equal(summarize([]), '');
});
`);
    io.log('Carthagent native offline demo');
    io.log('Scripted fixture only: no provider/API calls, no edits to your project, and no claim of project delivery evidence.');
    io.log('\nPlan: implement a tiny completed-task summarizer, then verify ordering and the empty case.');
    io.log(`\nFixture workspace: ${workspace}`);
    const result = await execute([nodeBinary, '--test', 'test/app.test.mjs'], { cwd: workspace, timeoutSeconds: 30 });
    if (result.code !== 0 || result.timedOut || result.cancelled) {
      io.error(`Offline demo check failed${result.timedOut ? ' (timed out)' : ''}: ${result.output?.trim() || 'no test output'}`);
      return 1;
    }
    io.log('\nVerification: isolated Node test suite passed (2 tests).');
    io.log('Finish: the sample behavior is verified only inside this disposable demo fixture.');
    return 0;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
