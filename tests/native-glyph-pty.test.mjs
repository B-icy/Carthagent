import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const probe = join(root, 'tools/native-glyph-pty.py');

test('glyph PTY child environment does not inherit the draft-runtime release token', () => {
  const result = spawnSync('python3', ['-c', `import importlib.util, pathlib
spec=importlib.util.spec_from_file_location('probe', ${JSON.stringify(probe)})
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
root=pathlib.Path('/tmp/isolated')
env=module.child_environment(root, root/'config', 'ascii', {'PATH':'/bin', 'CTG_RUNTIME_GITHUB_TOKEN':'sentinel'})
assert 'CTG_RUNTIME_GITHUB_TOKEN' not in env
assert env['CTG_TUI_GLYPHS']=='ascii'
assert env['HOME']==str(root/'home')
print('PASS')`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS/);
});
