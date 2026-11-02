import type { MouseEvent, SelectRenderable } from "@opentui/core";

// SelectRenderable only handles keys; map a left click to the fully drawn row under the pointer and activate it.
export function clickSelect(node: SelectRenderable | undefined, event: MouseEvent) {
  if (!node || event.button !== 0) return;
  const { scrollOffset, linesPerItem, maxVisibleItems } = node as unknown as {
    scrollOffset: number;
    linesPerItem: number;
    maxVisibleItems: number;
  };
  const row = Math.floor((event.y - node.screenY) / Math.max(1, linesPerItem));
  const index = scrollOffset + row;
  if (row < 0 || row >= maxVisibleItems || index >= node.options.length) return;
  node.setSelectedIndex(index);
  node.selectCurrent();
}
