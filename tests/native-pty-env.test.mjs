import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('native PTY entrypoint strips runtime transport credentials without dropping fixture environment', async () => {
  const source = await readFile(new URL('../tools/test-native-pty.mjs', import.meta.url), 'utf8');
  assert.match(source, /key\.toLowerCase\(\) === 'ctg_runtime_github_token'/);
  assert.match(source, /spawnSync\('python3', args, \{ cwd: root, env: pythonEnv/);
  const script = `import runpy; clean = runpy.run_path('tools/native-pty-smoke.py')['host_environment']({'PATH':'/bin','CTG_RUNTIME_GITHUB_TOKEN':'secret','ctg_runtime_github_token':'other','CTG_FAKE_PROVIDER':'fixture'}); assert not any(k.lower() == 'ctg_runtime_github_token' for k in clean); assert clean['PATH'] == '/bin'; assert clean['CTG_FAKE_PROVIDER'] == 'fixture'`;
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
