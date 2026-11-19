# Staged native sidebar polish

Combined v20 fixes six sidebar defects found by clicking through the Projects
rail at 80 to 200 columns, on a fresh profile and a signed-in profile with 23
sessions in three folders. It is staged source only: it does not activate a
runtime, change a release pin, or alter the default installed package, which
still selects v18.

## Fixes

- **Stray block glyphs on session titles.** v18 removed the blank row between
  session tabs but left the separator pulse overlay in place, so it drew `▄`
  through the spaces of the title row beneath it
  (`▄▄▄Add▄multiply() to math.js`), including on idle rows. The separator
  overlays are removed; each row keeps its own title and detail pulse.
- **Collapsing a folder scrolled the list away.** The reveal effect re-ran on
  every regroup and computed the active row from a fixed two-row stride that
  ignored folder headers and blank rows. It now runs only when the selection,
  tab count, height or compact mode changes, and measures the real row with
  `scrollChildIntoView` in the grouped rail.
- **Overlays painted under the main pane.** The compact-rail hover tooltip and
  the folder path overlay were drawn inside the rail, so the main pane painted
  over them and its text showed through. Both now render in a portal above the
  app, like the context menu. The folder path shows in place of the folder
  name (home-abbreviated when it is under the runtime's home), truncated from the left
  inside the rail; a longer path also opens a one-row tooltip beside the rail
  instead of covering Browse and New session.
- **Startup jump.** The rail painted as a flat, header-less session list, then
  gained the Projects/Voyages header and regrouped into folders a few seconds
  later; at 80 columns a horizontal tab strip appeared first and was replaced
  by the compact rail. Plugin readiness fired after the first local
  reconcile, before the server's plugin inventory had registered the Voyages
  pane. The plugin context now also reports `settled` once the generation that
  includes the first server inventory has loaded (or after five seconds if the
  server never answers). Until then the rail keeps its width as a muted
  `Loading…` placeholder, so the page beside it never shifts and the rail
  appears once, in its final layout. The main pane is not delayed.
- **Opening on Home scrolled the folders away.** Right after the first paint
  the rail scrolled to reveal the New session draft row at the bottom of the
  list, pushing every folder header off screen. Opening on Home now keeps the
  list at its top; the draft row is revealed only after the user has left the
  draft and starts a new session.
- **"Friends · WIP" on Voyages.** Removed from the plugin's Voyages pane
  (separate plugin change in this pull request).

## Source identity

- Pristine upstream: `843a6c514e606b436a7fe713422ace0a93ad3d61`.
- Complete patch: `docs/patches/opencode-v2.0.32-session-ui-combined-v20.patch`.
- Patch SHA-256: `335ef409841928fb34f6c8c0332eacb2c1b8dc90410835a8a6ae8dc6a8d367e0`.

The patch applies cleanly to pristine upstream. Its sections differ from v18
only in:

- `packages/tui/src/app.tsx`
- `packages/tui/src/component/session-tabs.tsx`
- `packages/tui/src/component/session-tabs-folder.tsx`
- `packages/tui/src/plugin/context.tsx`
- `packages/tui/test/navigation-rail.test.tsx`
- `packages/tui/test/sidebar/sidebar-hierarchy.test.tsx`

## Validation

- TUI typecheck clean; full TUI suite 1677 pass, 2 skip, 0 fail.
- Each regression test fails with its fix removed and passes with it:
  separator glyphs, collapse/expand position, compact tooltip bleed-through,
  short folder path in place, opening on Home keeps folders in view, and the
  plugin-inventory rail test at 120 and 80 columns.
- A local linux-arm64 build of this patch, run through the real `ctg` entry on
  a copy of a signed-in profile (23 sessions, three folders):
  - Startup at 120x36, 80x24 and 200x50, sampled every 200 ms: the divider
    column never moves; the rail shows `Loading…` and then its final layout
    (header, Browse/New session, all three folders) with no flat list, no
    horizontal tab strip and no later scroll.
  - Click-through at 120x36: collapsing and expanding a folder keeps its header
    on the same row and restores the same list; no `▄`/`▀` inside the rail in 13
    captures (hover, collapse, expand, select, path hover, context menu,
    Voyages, back to Projects); folder path hover and context menu render
    beside the rail and close cleanly.
  - Compact rail at 80x24: hovering a session opens its tooltip over the main
    pane and moving away restores the pane.

These checks read terminal cell text, not pixels.

Known limits, not changed here:

- In the installed CLI the runtime runs with a private `HOME`, so folder paths
  show in full (`/home/<user>/…`) rather than as `~/…`. Every other path label
  in the app behaves the same way.
- Long session titles fade out at the rail edge rather than ending in an
  ellipsis.
These are source and renderer checks plus a local linux-arm64 build exercised
through the real CLI; they are not multi-platform release acceptance.
