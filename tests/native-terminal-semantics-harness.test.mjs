import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = await readFile(new URL('../tools/native-terminal-semantics.py', import.meta.url), 'utf8');

function python(code) {
  const result = spawnSync('python3', ['-c', code], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('picker-only mode actually enables picker lifecycle', () => {
  const result = python(`import importlib.util, json
s=importlib.util.spec_from_file_location('decisions','tools/terminal-semantics-decisions.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
print(json.dumps({'pickerOnlyIsFocused': m.is_focused_terminal_case(False, False), 'focusedRoundtripIsFocused': m.is_focused_terminal_case(True, False), 'layoutIsFocused': m.is_focused_terminal_case(False, True)}))`);
  assert.deepEqual(result, { pickerOnlyIsFocused: false, focusedRoundtripIsFocused: true, layoutIsFocused: true });
});

test('portable decision helper does not depend on POSIX PTY modules', () => {
  const result = python(`import ast, pathlib
p=pathlib.Path('tools/terminal-semantics-decisions.py')
tree=ast.parse(p.read_text())
imports={n.name for n in ast.walk(tree) if isinstance(n, ast.Import)}
assert not imports.intersection({'fcntl','pty','termios','select'})
print(__import__('json').dumps('portable'))`);
  assert.equal(result, 'portable');
});

test('picker cancellation waits for composer restoration and catches stale overlays/early requests', () => {
  const result = python(`import importlib.util, json
s=importlib.util.spec_from_file_location('decisions','tools/terminal-semantics-decisions.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
h='recent sessions'; home='Ask anything'; overlay='No matches · search all\\nOpen                       esc'
print(json.dumps({'stillOpen': m.picker_cancel_observation(h, overlay, True, True, 0), 'notHome': m.picker_cancel_observation(h, 'Recent sessions', False, True, 0), 'requestDuringCancel': m.picker_cancel_observation(h, home, True, True, 1), 'valid': m.picker_cancel_observation(h, home, True, True, 0)}))`);
  assert.equal(result.stillOpen, null);
  assert.equal(result.notHome, null);
  assert.equal(result.requestDuringCancel.status, 'FAIL');
  assert.equal(result.requestDuringCancel.noPromptProviderRequestBeforeAcceptance, false);
  assert.equal(result.valid.status, 'PASS');
  assert.equal(result.valid.composerRestored, true);
});

test('rendered fixture matching accepts bracket-stripped body and bracketed header text', () => {
  const result = python(`import importlib.util, json
s=importlib.util.spec_from_file_location('decisions','tools/terminal-semantics-decisions.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
fixture='FINAL[SNIP]END'
header=' • FINAL[SNIP]END                +'
body='     FINALSNIPEND'
other='     FINAL[WRONG]END'
print(json.dumps([[m.rendered_fixture_row(line, fixture), m.rendered_fixture_body_row(line, fixture)] for line in (header, body, other)]))`);
  assert.deepEqual(result, [[true, false], [true, true], [false, false]]);
});

test('active-session submit requires visible staged prompt and active session identity', () => {
  const result = python(`import importlib.util, json
s=importlib.util.spec_from_file_location('decisions','tools/terminal-semantics-decisions.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
text='focused-host-request'
home='Ask anything '+text
active='┃ '+text+'\\n┃ Build · Offline fixture ctgfixture'
no_text='┃ Build · Offline fixture Offline Fixture'
weak='┃ '+text+'\\n┃ Build · Offline fixture Offline Fixture'
print(json.dumps([m.active_session_prompt_ready(x,text) for x in (home,active,no_text,weak)]))`);
  assert.deepEqual(result, [false, true, false, false]);
});

test('terminal semantics reports clipboard/title proof as controlled-host modeling, not OS claims', () => {
  assert.match(source, /'physicalOSClipboardVerified': False/);
  assert.match(source, /terminal-semantics-decisions\.py/);
  assert.match(source, /'mouseTrackingModesObserved'/);
  assert.match(source, /'gestureEventsSent'/);
  assert.match(source, /'submitInputTrace'/);
  assert.match(source, /'terminalTitleRestoration'/);
  assert.match(source, /'selectionClipboard'/);
  assert.match(source, /'clipboardOSC52'/);
});
