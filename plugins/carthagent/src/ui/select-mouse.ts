import type { MouseEvent, SelectOption, SelectRenderable } from "@opentui/core";

type Geometry = { scrollOffset: number; linesPerItem: number; maxVisibleItems: number };
const geometry = (node: SelectRenderable) => node as unknown as Geometry;

function rowAt(node: SelectRenderable, y: number) {
  const { scrollOffset, linesPerItem, maxVisibleItems } = geometry(node);
  const row = Math.floor((y - node.screenY) / Math.max(1, linesPerItem));
  const index = scrollOffset + row;
  if (row < 0 || row >= maxVisibleItems || index >= node.options.length) return undefined;
  return index;
}

// SelectRenderable re-centres its window on every selection or options change. Keep the window the user saw
// whenever the target row fits in it, so a click or refresh never slides other rows under the pointer.
function pinWindow(node: SelectRenderable, index: number, offset: number) {
  const g = geometry(node);
  const visible = Math.max(1, g.maxVisibleItems);
  const next = Math.max(0, Math.min(Math.max(index - visible + 1, Math.min(offset, index)), node.options.length - visible));
  if (g.scrollOffset === next) return;
  g.scrollOffset = next;
  node.requestRender();
}

function choose(node: SelectRenderable, index: number) {
  const offset = geometry(node).scrollOffset;
  node.setSelectedIndex(index);
  pinWindow(node, index, offset);
  node.selectCurrent();
}

// SelectRenderable only handles keys; map a left click to the fully drawn row under the pointer and activate it.
// Bind it to mouse-up: an action that opens a dialog on mouse-down is closed by that dialog's backdrop on release.
export function clickSelect(node: SelectRenderable | undefined, event: MouseEvent) {
  if (!node || event.button !== 0) return;
  const index = rowAt(node, event.y);
  if (index !== undefined) choose(node, index);
}

/** Wheel input moves the highlight (and with it the visible window) one row; it never activates. */
export function wheelSelect(node: SelectRenderable | undefined, event: Pick<MouseEvent, "scroll">, enabled = true) {
  const direction = event.scroll?.direction;
  if (!node || node.isDestroyed || !enabled || (direction !== "up" && direction !== "down")) return;
  const offset = geometry(node).scrollOffset;
  if (direction === "up") node.moveUp(); else node.moveDown();
  pinWindow(node, node.getSelectedIndex(), offset);
}

type PointerEvent = Pick<MouseEvent, "button" | "y">;

/**
 * Activates the row that was under the pointer when the primary button went down, on a release at the same
 * screen row. The press can move the select before the release arrives (focusing the navigation rail inserts a
 * hint line above it), so the row is resolved at press time. Bind `press` to the select and `release` to an
 * ancestor that still contains the pointer after such a shift; mouse events bubble, so the ancestor also sees
 * releases over the select. A release without a matching press (for example the release of a dialog backdrop
 * click) or after the pressed option changed never activates.
 */
export function createSelectPointer(node: () => SelectRenderable | undefined, enabled: () => boolean) {
  let pressed: { y: number; index: number; value: unknown } | undefined;
  const live = () => { const current = node(); return current && !current.isDestroyed ? current : undefined; };
  return {
    press(event: PointerEvent) {
      pressed = undefined;
      const current = live();
      if (!current || event.button !== 0) return;
      const index = rowAt(current, event.y);
      if (index !== undefined) pressed = { y: event.y, index, value: current.options[index]?.value };
    },
    release(event: PointerEvent) {
      const press = pressed;
      pressed = undefined;
      const current = live();
      if (!press || !current || event.button !== 0 || event.y !== press.y || !enabled()) return;
      if (current.options[press.index]?.value !== press.value) return;
      choose(current, press.index);
    },
  };
}

/**
 * Remembers the chosen option by value, not index, so rebuilding the options (refresh, reload, a new action
 * appearing) keeps the same option highlighted in the same window. Until the user picks a row, or when the
 * remembered option is absent, the select shows `fallback`; a list that gains a sending action therefore never
 * lands on it by position. Call `changed` from onChange and `sync` after options change.
 */
export function createSelectMemory(node: () => SelectRenderable | undefined, fallback: (options: SelectOption[]) => number = () => 0) {
  let value: unknown;
  let chosen = false;
  let offset = 0;
  let applying = false;
  const live = () => { const current = node(); return current && !current.isDestroyed ? current : undefined; };
  return {
    changed(option: SelectOption | null | undefined) {
      const current = live();
      if (applying || !current) return;
      value = option?.value;
      chosen = true;
      offset = geometry(current).scrollOffset;
      // Pointer helpers pin the window after the change event; record the window the user is left looking at.
      const chosenValue = value;
      queueMicrotask(() => { const node = live(); if (node && chosen && value === chosenValue && node.getSelectedOption()?.value === chosenValue) offset = geometry(node).scrollOffset; });
    },
    reset() { value = undefined; chosen = false; offset = 0; },
    /** Runs index changes made for safety (for example an event handler resetting to row 0) without recording them as a choice. */
    quiet(run: () => void) { applying = true; try { run(); } finally { applying = false; } },
    forget(match: (value: unknown) => boolean) { if (chosen && match(value)) { value = undefined; chosen = false; } },
    sync() {
      const current = live();
      if (!current || !current.options.length) return;
      const remembered = chosen ? current.options.findIndex((option) => option.value === value) : -1;
      const index = remembered >= 0 ? remembered : Math.max(0, Math.min(current.options.length - 1, fallback(current.options)));
      applying = true;
      try { current.setSelectedIndex(index); } finally { applying = false; }
      pinWindow(current, index, offset);
      // A transient list (reload in progress) must not move the window the remembered option returns to.
      if (!chosen || remembered >= 0) offset = geometry(current).scrollOffset;
    },
  };
}
