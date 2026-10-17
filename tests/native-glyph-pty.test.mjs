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

test('composer assertion requires the exact ordered Unicode payload on its rendered row', () => {
  const result = spawnSync('python3', ['-c', `import importlib.util
spec=importlib.util.spec_from_file_location('probe', ${JSON.stringify(probe)})
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
expected=module.USER_TEXT
assert module.assert_composer_payload('logo █▀▀ OpenCode\\n┃  '+expected+'\\n')
mutants=[
  'logo '+expected+'\\n┃  CTG_GLYPH_PAYLOAD 漢字 café → • −',
  'logo '+expected+'\\n┃  '+expected.replace('漢','?'),
  'logo '+expected+'\\n┃  '+expected.replace('→ •','• →'),
  'logo '+expected+'\\n┃  '+expected.replace('café','cafe'),
]
for screen in mutants:
  try: module.assert_composer_payload(screen)
  except AssertionError: pass
  else: raise AssertionError('mutated composer unexpectedly passed')
print('PASS')`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS/);
});

test('glyph screen tracks CJK wide cells and combining marks without losing exact composer text', () => {
  const result = spawnSync('python3', ['-c', `import importlib.util
spec=importlib.util.spec_from_file_location('probe', ${JSON.stringify(probe)})
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
screen=module.GlyphScreen(rows=3, columns=50)
text=module.USER_TEXT
screen.feed(('\\x1b[1;1H┃  '+text).encode())
row=screen.visible().splitlines()[0]
assert text in row, repr(row)
assert screen.x == 3 + sum(module.GlyphScreen.char_width(ch) for ch in text)
assert module.GlyphScreen.char_width('漢') == 2
assert module.GlyphScreen.char_width('\\u0301') == 0
print('PASS')`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS/);
});
