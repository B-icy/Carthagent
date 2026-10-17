import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { runNativeUpdateForUI } = await jiti.import('../plugins/carthagent/src/ui/update.ts');

test('native UI update adapter forwards validated args and meaningful progress without executing a child process', async () => {
  const progress = [];
  const expected = { status: 'updated', release: { version: '1.2.0', tag: 'v1.2.0' }, method: 'npm' };
  const result = await runNativeUpdateForUI({
    args: ['--force'], cwd: '/private/workspace', root: '/private/package',
    runUpdate: async options => {
      assert.deepEqual(options.args, ['--force']);
      assert.equal(options.cwd, '/private/workspace');
      assert.equal(options.root, '/private/package');
      options.io.log('Updating Carthagent 1.0.0 → 1.2.0 (npm install)');
      options.io.log('Carthagent updated to 1.2.0. Restart any running console to pick it up.');
      return expected;
    },
    onProgress: (message, level) => progress.push({ message, level }),
  });
  assert.equal(result, expected);
  assert.deepEqual(progress, [
    { message: 'Updating Carthagent 1.0.0 → 1.2.0 (npm install)', level: 'log' },
    { message: 'Carthagent updated to 1.2.0. Restart any running console to pick it up.', level: 'log' },
  ]);
});

test('native UI update adapter preserves failure and error progress without success-shaped output', async () => {
  const progress = [];
  await assert.rejects(runNativeUpdateForUI({
    args: [], cwd: '/private/workspace', root: '/private/package',
    runUpdate: async options => {
      options.io.error('Update manifest unavailable.');
      throw new Error('No installation was attempted.');
    },
    onProgress: (message, level) => progress.push({ message, level }),
  }), /No installation was attempted/);
  assert.deepEqual(progress, [{ message: 'Update manifest unavailable.', level: 'error' }]);
});
