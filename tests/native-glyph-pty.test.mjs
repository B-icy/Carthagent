import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { delimiter, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const helpers = join(root, 'tools/native-glyph-helpers.py');
const candidates = [
  process.env.PYTHON,
  join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
  process.platform === 'win32' ? 'python.exe' : 'python3',
  'python',
].filter(Boolean);
const resolveExecutable = candidate => {
  if (existsSync(candidate)) return candidate;
  for (const directory of (process.env.PATH || '').split(delimiter)) {
    const path = join(directory, candidate);
    if (existsSync(path)) return path;
  }
  return null;
};
const python = candidates.map(resolveExecutable).find(Boolean);
const skipPython = python ? false : 'Python was not found; set PYTHON to an interpreter path';

test('glyph child environment does not inherit the draft-runtime release token', { skip: skipPython }, () => {
  const result = spawnSync(python, ['-c', `import importlib.util, pathlib
spec=importlib.util.spec_from_file_location('helpers', ${JSON.stringify(helpers)})
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

test('composer assertion requires the exact ordered Unicode payload on its rendered row', { skip: skipPython }, () => {
  const result = spawnSync(python, ['-c', `import importlib.util
spec=importlib.util.spec_from_file_location('helpers', ${JSON.stringify(helpers)})
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

test('glyph screen tracks CJK wide cells and combining marks without losing exact composer text', { skip: skipPython }, () => {
  const result = spawnSync(python, ['-c', `import importlib.util
spec=importlib.util.spec_from_file_location('helpers', ${JSON.stringify(helpers)})
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

test('native glyph PTY entrypoint imports its hyphenated sibling helper', {
  skip: skipPython || (process.platform === 'win32' ? 'The PTY entrypoint depends on Unix fcntl; portable helper contracts are tested above' : false),
}, () => {
  const result = spawnSync(python, ['-c', `import importlib.util, pathlib
entry=pathlib.Path(${JSON.stringify(join(root, 'tools/native-glyph-pty.py'))})
spec=importlib.util.spec_from_file_location('native_glyph_pty_entry', entry)
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
assert module.USER_TEXT == 'CTG_GLYPH_PAYLOAD 漢字 café → • − …'
assert module.GlyphScreen.char_width('漢') == 2
assert callable(module.assert_composer_payload)
print('PASS')`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS/);
});


test('glyph screen records fragmented OSC titles for final-binary branding assertions', { skip: skipPython }, () => {
  const result = spawnSync(python, ['-c', `import importlib.util
spec=importlib.util.spec_from_file_location('helpers', ${JSON.stringify(helpers)})
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
screen=module.GlyphScreen()
for chunk in [b'\\x1b]2;Cart', b'hagent\\x07', b'\\x1b]0;CTG | Ship\\x1b', b'\\\\']:
  screen.feed(chunk)
assert screen.title_updates == ['Carthagent', 'CTG | Ship'], screen.title_updates
assert screen.visible().strip() == ''
print('PASS')`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS/);
});
