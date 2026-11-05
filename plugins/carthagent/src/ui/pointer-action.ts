import type { MouseEvent, Renderable } from "@opentui/core";

type PointerEvent = Pick<MouseEvent, "button"> & { target: Renderable | null; currentTarget?: Renderable | null };

// OpenTUI emits only down/up mouse events, so a Solid `on:click` never fires. An action runs on the primary
// release over the same renderable that received the primary press. Press and release are recorded on a common
// ancestor; mouse events bubble, so the action handler sees the release before the ancestor clears the press.
// Pairing keeps a stray release (for example after a dialog backdrop press closed the dialog) from activating
// whatever action happens to be under the pointer.
export function createPointerActions(enabled: () => boolean) {
  let pressed: Renderable | null = null;
  return {
    press(event: PointerEvent) {
      pressed = event.button === 0 && enabled() ? event.target : null;
    },
    release() {
      pressed = null;
    },
    action(run: () => void) {
      return (event: PointerEvent) => {
        const owner = event.currentTarget ?? event.target;
        if (event.button !== 0 || !pressed || pressed !== owner || !enabled()) return;
        pressed = null;
        run();
      };
    },
  };
}
