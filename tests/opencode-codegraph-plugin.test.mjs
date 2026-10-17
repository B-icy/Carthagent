import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { registerCodegraph } = await jiti.import('../plugins/carthagent/src/server/codegraph.ts');

test('native codegraph scan consumes the resolved per-session max-files setting', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ctg-native-codegraph-cap-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src/a.js'), 'export function alpha() {}\n');
  await writeFile(join(root, 'src/b.js'), 'export function beta() {}\n');
  let registered;
  const sessions = {
    capped: { location: { directory: root }, metadata: { 'carthagent.options': { codegraphMaxFiles: 1 } } },
    expanded: { location: { directory: root }, metadata: { 'carthagent.options': { codegraphMaxFiles: 2 } } },
  };
  const ctx = {
    options: {},
    tool: { transform: async callback => {
      callback({ namespace() {}, add(tool) { registered = tool; } });
      return { dispose: async () => {} };
    } },
    session: { get: async ({ sessionID }) => sessions[sessionID] },
  };
  const dispose = await registerCodegraph(ctx);
  t.after(dispose);
  const status = async sessionID => JSON.parse((await registered.execute({ op: 'status' }, { sessionID })).content).coverage;
  assert.deepEqual(
    (({ files, discovered, skipped, complete }) => ({ files, discovered, skipped, complete }))(await status('capped')),
    { files: 1, discovered: 2, skipped: 1, complete: false },
  );
  assert.deepEqual(
    (({ files, discovered, skipped, complete }) => ({ files, discovered, skipped, complete }))(await status('expanded')),
    { files: 2, discovered: 2, skipped: 0, complete: true },
  );
});
