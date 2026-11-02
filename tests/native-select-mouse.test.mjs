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
