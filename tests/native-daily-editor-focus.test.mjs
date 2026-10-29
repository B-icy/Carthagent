import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRoot, createSignal, createEffect, onCleanup } from 'solid-js/dist/solid.js';
import { createDailyEditorFocus } from '../plugins/carthagent/src/ui/daily-editor-focus.mjs';
import { createDailyQuestsState } from '../plugins/carthagent/src/ui/daily-quests-state.mjs';

// Focus-only adapter, not a native renderer test: retain the pinned ordering
// (blur previous, install handlers, emit focused) and route keys to the owner.
function fixture(t, { microtasks = [], defer = callback => microtasks.push(callback) } = {}) {
  let current;
  class Input extends EventEmitter {
    focused = false;
    isDestroyed = false;
    focusCalls = 0;
    text = '';
    focus() {
      if (this.isDestroyed || this.focused) return;
      current?.blur();
      current = this;
      this.focused = true;
      this.focusCalls++;
      this.emit('focused');
    }
    blur() { this.focused = false; if (current === this) current = undefined; }
    destroy() { this.blur(); this.isDestroyed = true; }
  }
  const actions = new Input();
  let input = new Input();
  let state, update, focus, dispose;
  createRoot(stop => {
    dispose = stop;
    [state, update] = createSignal({ phase: 'overview', hasDraft: false, busy: false, editorFocus: true, mode: 'base' });
    focus = createDailyEditorFocus({ state, editor: () => input, defer });
    focus.attachActions(actions);
    createEffect(focus.reconcile);
    onCleanup(focus.dispose);
  });
  t.after(dispose);
  const flush = () => {
    let count = 0;
    while (microtasks.length) {
      assert.ok(++count < 30, 'focus reconciliation must settle, not poll');
      microtasks.shift()();
    }
  };
  return {
    actions, focus, dispose, flush, microtasks,
    input: () => input,
    mountEditor: () => { input = new Input(); return input; },
    newInput: () => new Input(),
    current: () => current,
    patch: next => update(previous => ({ ...previous, ...next })),
    key(text) { if (current === input) input.text += text; },
    enterAction(run) { if (current === actions && focus.actionsEnabled()) run(); },
  };
}

test('compose promise mounts editor before native 1ms refocus; focus event repairs ownership without Tab', async t => {
  const f = fixture(t);
  f.flush();
  assert.equal(f.current(), f.actions);
  const id = '11111111-1111-4111-8111-111111111111';
  const detail = { id, status: 'open' };
  const controller = createDailyQuestsState({
    api: {
      snapshot: async () => ({ accountKey: 'a'.repeat(64), slate: { items: [detail] }, records: [] }),
      detail: async () => detail,
      submit: () => assert.fail('focus must not send evidence'),
    },
    changed: view => f.patch({ phase: view.phase, hasDraft: !!view.draft, busy: view.busy }),
  });
  t.after(() => controller.dispose());
  await controller.refresh(); await controller.select(id);
  let resolve;
  const selected = new Promise(done => { resolve = done; });
  const savedFocus = f.actions;
  const compose = controller.compose(() => selected);
  f.patch({ mode: 'modal' });
  f.flush();
  resolve({ id, evidence: { goal: 'manual fixture' } });
  f.patch({ mode: 'base' });
  // clear() schedules the old renderable's focus after promise continuations.
  const nativeTimer = () => savedFocus.focus();
  await compose;
  f.flush();
  assert.equal(f.current(), f.input());
  nativeTimer();
  assert.equal(f.current(), f.actions, 'reproduce stale actual focus despite editor ownership');
  let navigations = 0;
  f.enterAction(() => navigations++);
  assert.equal(navigations, 0, 'stale Enter cannot activate Back/refresh/submit');
  f.flush();
  f.key('Z\n');
  assert.equal(f.input().text, 'Z\n');
  assert.equal(f.current(), f.input());
  assert.equal(f.actions.focused, false);
  assert.equal(f.actions.listenerCount('focused'), 1);
});

test('default microtask runs after focus installation and rechecks latest ownership', async t => {
  const f = fixture(t, { defer: queueMicrotask });
  await Promise.resolve();
  f.patch({ phase: 'edit', hasDraft: true });
  await Promise.resolve();
  f.actions.focus();
  await Promise.resolve();
  assert.equal(f.current(), f.input());
  f.actions.focus();
  f.patch({ mode: 'modal' });
  await Promise.resolve();
  assert.equal(f.current(), undefined, 'never reclaim focus from a modal');
});

test('Tab hands ownership to visible actions and back; stale event cannot reverse it', t => {
  const f = fixture(t);
  f.patch({ phase: 'edit', hasDraft: true }); f.flush();
  f.actions.focus(); // reconciliation queued for editor
  f.patch({ editorFocus: false }); f.flush();
  assert.equal(f.current(), f.actions);
  let selections = 0;
  f.enterAction(() => selections++);
  assert.equal(selections, 1);
  f.patch({ editorFocus: true }); f.flush();
  assert.equal(f.current(), f.input());
  f.key('after Tab');
  assert.equal(f.input().text, 'after Tab');
});

for (const blocked of [{ mode: 'modal' }, { mode: 'palette' }, { busy: true }]) {
  test(`pending repair respects ${JSON.stringify(blocked)} and restores only after unblock`, t => {
    const f = fixture(t);
    f.patch({ phase: 'edit', hasDraft: true }); f.flush();
    f.actions.focus();
    f.patch(blocked);
    const modal = f.newInput();
    modal.focus();
    f.flush();
    assert.equal(f.current(), modal, 'do not steal focus from an unrelated modal/control');
    assert.equal(f.focus.editorEnabled(), false);
    assert.equal(f.focus.actionsEnabled(), false);
    f.patch({ mode: 'base', busy: false }); f.flush();
    assert.equal(f.current(), f.input());
  });
}

test('preview/edit remount uses current editor; cancel/invalidate cannot revive destroyed draft', t => {
  const f = fixture(t);
  f.patch({ phase: 'edit', hasDraft: true }); f.flush();
  const oldEditor = f.input();
  f.actions.focus();
  oldEditor.destroy();
  f.patch({ phase: 'preview' }); f.flush();
  assert.equal(f.current(), f.actions);
  const nextEditor = f.mountEditor();
  f.patch({ phase: 'edit', editorFocus: true }); f.flush();
  assert.equal(f.current(), nextEditor);
  f.actions.focus();
  nextEditor.destroy();
  f.patch({ phase: 'overview', hasDraft: false }); f.flush();
  assert.equal(f.current(), f.actions);
  assert.equal(oldEditor.focusCalls, 1);
  assert.equal(nextEditor.focusCalls, 1);
  f.patch({ phase: 'edit', hasDraft: false }); f.flush();
  assert.equal(f.current(), undefined, 'no editor focus without a live draft');
});

test('unmount cancels pending repairs, detaches listeners and cannot steal next page focus', t => {
  const f = fixture(t);
  f.patch({ phase: 'edit', hasDraft: true }); f.flush();
  f.actions.focus();
  assert.ok(f.microtasks.length);
  f.dispose();
  assert.equal(f.actions.listenerCount('focused'), 0);
  f.input().blur(); f.actions.blur();
  const nextPage = f.newInput();
  nextPage.focus();
  f.flush();
  assert.equal(f.current(), nextPage);
  f.focus.reconcile();
  assert.equal(f.microtasks.length, 0);
  assert.equal(f.focus.actionsEnabled(), false);
  assert.equal(f.focus.editorEnabled(), false);
});

test('replacing or destroying native action refs does not retain a stale focus listener', t => {
  const f = fixture(t);
  f.flush();
  const replacement = f.newInput();
  f.focus.attachActions(replacement); f.flush();
  assert.equal(f.actions.listenerCount('focused'), 0);
  assert.equal(replacement.listenerCount('focused'), 1);
  replacement.destroy();
  f.focus.reconcile(); f.flush();
  assert.equal(replacement.focusCalls, 1);
});

test('page wires focus lifecycle and selection guard; pinned renderer exposes the used focus event contract', async () => {
  const page = await readFile(new URL('../plugins/carthagent/src/ui/daily-quests.tsx', import.meta.url), 'utf8');
  assert.match(page, /createEffect\(\(\) => focus\.reconcile\(\)\)/);
  assert.match(page, /mode: context\.keymap\.mode\.current\(\)/);
  assert.match(page, /ref=\{\(node\) => focus\.attachActions\(node\)\}/);
  assert.match(page, /if \(!value \|\| !focus\.actionsEnabled\(\)\) return/);
  assert.match(page, /onCleanup\(\(\) => \{ focus\.dispose\(\)/);
  const api = await readFile(new URL('../node_modules/@opentui/core/Renderable.d.ts', import.meta.url), 'utf8');
  assert.match(api, /FOCUSED = "focused"/);
  assert.match(api, /focus\(\): void/);
  assert.match(api, /blur\(\): void/);
  assert.match(api, /get isDestroyed\(\): boolean/);
});
