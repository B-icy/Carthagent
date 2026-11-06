import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPointerActions } from '../plugins/carthagent/src/ui/pointer-action.ts';

const page = await readFile(new URL('../plugins/carthagent/src/ui/workspace.tsx', import.meta.url), 'utf8');

// Mirrors OpenTUI dispatch: the hit renderable handles the event first, then it bubbles to the page root.
const harness = (enabled = () => true) => {
  const calls = [];
  const pointer = createPointerActions(enabled);
  const handlers = new Map();
  const bind = (name) => { const handler = pointer.action(() => calls.push(name)); handlers.set(name, handler); return handler; };
  const send = (type, target, button = 0) => {
    const event = { type, button, target };
    if (type === 'up') handlers.get(target)?.(event);
    (type === 'down' ? pointer.press : pointer.release)(event);
  };
  const click = (target, button = 0) => { send('down', target, button); send('up', target, button); };
  return { calls, bind, send, click };
};

test('a primary press and release on the same action runs its callback exactly once', () => {
  const h = harness();
  h.bind('refresh'); h.bind('worktree');
  h.click('refresh');
  assert.deepEqual(h.calls, ['refresh']);
  // A stray release with no new press never repeats the action.
  h.send('up', 'refresh');
  assert.deepEqual(h.calls, ['refresh']);
});

test('drags between actions, other buttons and presses that began elsewhere do not activate', () => {
  const h = harness();
  h.bind('refresh'); h.bind('worktree');
  h.send('down', 'refresh'); h.send('up', 'worktree');
  h.click('worktree', 2);
  h.send('down', 'filter'); h.send('up', 'refresh');
  assert.deepEqual(h.calls, []);
});

test('a release left over from a dialog backdrop press does not re-activate the action under the pointer', () => {
  const h = harness();
  h.bind('worktree');
  h.click('worktree');
  // The dialog backdrop is outside the page, so only the release reaches the page.
  h.send('up', 'worktree');
  assert.deepEqual(h.calls, ['worktree']);
});

test('actions stay inert while another layer (dialog) owns input', () => {
  let base = false;
  const h = harness(() => base);
  h.bind('refresh');
  h.click('refresh');
  base = true;
  h.click('refresh');
  assert.deepEqual(h.calls, ['refresh']);
});

test('workspace actions use paired primary press/release instead of inert on:click', () => {
  assert.doesNotMatch(page, /on:click/);
  assert.match(page, /const pointer = createPointerActions\(base\)/);
  assert.match(page, /return <box [^\n]*onMouseDown=\{pointer\.press\} onMouseUp=\{pointer\.release\}>/);
  const actions = [...page.matchAll(/onMouseUp=\{pointer\.action\(/g)];
  assert.equal(actions.length, 13);
  for (const label of ['↻ Refresh</text>', 'View delivery evidence', 'View review status', 'Load cached pull requests', '+ Associate pull request…', 'from GitHub', '↻ Refresh delivery workflow', '↻ Refresh delivery architecture', '↻ Refresh selected session evidence', '+ Create worktree']) {
    const line = page.split('\n').find((text) => text.includes(label));
    assert.ok(line, label);
    assert.match(line, /onMouseUp=\{pointer\.action\(/, label);
  }
  assert.match(page, /onMouseUp=\{pointer\.action\(\(\) => void openSession\(session\.id\)\)\}/);
  assert.match(page, /onMouseUp=\{pointer\.action\(\(\) => context\.ui\.router\.navigate\(\{ type: "session", sessionID: session\.id \}\)\)\}/);
  // The navigation list keeps keyboard onSelect; pointer must not activate its stale selected row.
  assert.match(page, /<select options=\{navigationOptions\(\)\} onSelect=\{\(_index, option\) => selectNavigation\(option\)\}[^\n]*onMouseDown=\{\(\) => setFilterFocused\(false\)\} \/>/);
});
