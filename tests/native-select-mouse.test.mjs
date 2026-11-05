import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clickSelect } from '../plugins/carthagent/src/ui/select-mouse.ts';

const node = (scrollOffset, linesPerItem) => {
  const calls = [];
  return { calls, scrollOffset, linesPerItem, maxVisibleItems: 3, screenY: 10, options: [{}, {}, {}, {}], setSelectedIndex: i => calls.push(['set', i]), selectCurrent: () => calls.push(['select']) };
};

test('clicks activate the row under the pointer, accounting for scroll and row height', () => {
  const n = node(1, 2);
  clickSelect(n, { button: 0, y: 13 });
  assert.deepEqual(n.calls, [['set', 2], ['select']]);
});

test('clicks outside rows or with other buttons are ignored', () => {
  for (const event of [{ button: 0, y: 9 }, { button: 0, y: 30 }, { button: 0, y: 13 }, { button: 2, y: 10 }]) {
    const n = node(0, 1);
    clickSelect(n, event);
    assert.deepEqual(n.calls, []);
  }
  clickSelect(undefined, { button: 0, y: 10 });
});

import { createSelectMemory, createSelectPointer, wheelSelect } from '../plugins/carthagent/src/ui/select-mouse.ts';

// Models the pinned SelectRenderable: selection changes re-centre the window and emit onChange synchronously.
function select(count, visible = 5, screenY = 10) {
  const n = { calls: [], screenY, scrollOffset: 0, linesPerItem: 1, maxVisibleItems: visible, isDestroyed: false, selected: 0, onChange: () => {},
    options: Array.from({ length: count }, (_, i) => ({ name: `row ${i}`, value: `v${i}` })),
    recentre() { this.scrollOffset = Math.max(0, Math.min(this.selected - Math.floor(this.maxVisibleItems / 2), this.options.length - this.maxVisibleItems)); },
    setSelectedIndex(i) { if (i < 0 || i >= this.options.length) return; this.selected = i; this.recentre(); this.onChange(i, this.options[i]); },
    getSelectedIndex() { return this.selected; }, getSelectedOption() { return this.options[this.selected] ?? null; },
    moveUp() { this.setSelectedIndex(Math.max(0, this.selected - 1)); }, moveDown() { this.setSelectedIndex(Math.min(this.options.length - 1, this.selected + 1)); },
    selectCurrent() { this.calls.push(this.options[this.selected].value); }, requestRender() {} };
  return n;
}

test('pointer activates the row resolved at press even if the select moves before release', () => {
  const n = select(4);
  const p = createSelectPointer(() => n, () => true);
  p.press({ button: 0, y: 11 });
  n.screenY = 11; // a focus hint was inserted above the select
  p.release({ button: 0, y: 11 });
  assert.deepEqual(n.calls, ['v1']);
});

test('pointer ignores stray releases, other rows, other buttons, disabled state and changed options', () => {
  const n = select(4);
  let enabled = true;
  const p = createSelectPointer(() => n, () => enabled);
  p.release({ button: 0, y: 11 });
  p.press({ button: 0, y: 11 }); p.release({ button: 0, y: 12 });
  p.press({ button: 2, y: 11 }); p.release({ button: 2, y: 11 });
  enabled = false; p.press({ button: 0, y: 11 }); p.release({ button: 0, y: 11 }); enabled = true;
  p.press({ button: 0, y: 11 }); n.options = [{ value: 'other' }, { value: 'submit' }]; p.release({ button: 0, y: 11 });
  assert.deepEqual(n.calls, []);
});

test('wheel moves the highlight without activating and keeps the visible window steady', () => {
  const n = select(11);
  for (let i = 0; i < 4; i++) wheelSelect(n, { scroll: { direction: 'down' } });
  assert.equal(n.selected, 4); assert.equal(n.scrollOffset, 0);
  for (let i = 0; i < 6; i++) wheelSelect(n, { scroll: { direction: 'down' } });
  assert.equal(n.selected, 10); assert.equal(n.scrollOffset, 6);
  wheelSelect(n, { scroll: { direction: 'up' } }, false);
  assert.equal(n.selected, 10);
  assert.deepEqual(n.calls, []);
});

test('click on a visible row activates it without sliding the window', () => {
  const n = select(11);
  n.selected = 8; n.scrollOffset = 6;
  clickSelect(n, { button: 0, y: 14 });
  assert.deepEqual(n.calls, ['v10']);
  assert.equal(n.scrollOffset, 6);
});

test('memory restores the chosen value and window after options are rebuilt, and never defaults onto Submit', async () => {
  const n = select(11);
  const memory = createSelectMemory(() => n, options => options[0].value === 'submit' ? options.findIndex(o => o.value === 'details') : 0);
  n.onChange = (_i, option) => memory.changed(option);
  for (let i = 0; i < 7; i++) { wheelSelect(n, { scroll: { direction: 'down' } }); await Promise.resolve(); }
  const offset = n.scrollOffset;
  n.options = [...n.options.slice(0, 3), { value: 'new' }, ...n.options.slice(3)];
  memory.quiet(() => n.setSelectedIndex(0)); // an event handler's safety reset is not a user choice
  memory.sync();
  assert.equal(n.getSelectedOption().value, 'v7');
  assert.equal(n.scrollOffset, offset + 1);
  memory.reset();
  n.options = [{ value: 'submit' }, { value: 'choose' }, { value: 'details' }, { value: 'back' }];
  memory.sync();
  assert.equal(n.getSelectedOption().value, 'details');
  memory.forget(() => true);
  assert.deepEqual(n.calls, []);
});
