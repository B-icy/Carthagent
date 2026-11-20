# Native polish v21

Combined v21 fixes the remaining defects found by clicking through the 1.1.2
Projects rail, Voyages and prompt, and shortens startup. It carries every v20
change. The build recipe and prebuild workflow select v21 for the next release;
the resolver pin and packaged release manifest stay on v18 until the release
change promotes the generated manifest.

## Fixes

- **Long session titles.** A title that does not fit now ends in an ellipsis
  instead of fading out at the rail edge. Hovering it for a moment shows the
  full title in a tooltip beside the rail; the row itself stays still. Titles
  that fit show no tooltip.
- **Home paths.** The runtime runs with a private `HOME`, so folder labels,
  the Browse dialog and its Home button showed and opened the profile folder.
  `ctg` now passes the user's real home as `CTG_USER_HOME`; the TUI shows it as
  `~` and Home opens it. A missing or relative value falls back to the old
  behaviour.
- **`/ctg-help` and other Carthagent commands.** Picking a command without
  arguments from slash completion took two Enters, because the plugin also
  registers an argument-taking twin so that a typed `/name` still dispatches.
  Completion now recognises the twin (same name and aliases) and runs the
  command on the first Enter, for the name and every alias.
- **Rail divider.** Dragging the Projects/Voyages divider past the page snapped
  the rail to its compact width. It now stops at the widest rail that still fits
  beside the page (at most 72 columns, leaving 64 for the page).
- **Drag release clicked through.** Releasing a divider drag over the prompt
  footer opened the working-directory menu, because the renderer delivers the
  release to the element under the pointer. While a resize is in progress a
  transparent layer above the app takes the pointer, and it is removed only
  after the release has been dispatched. Removing it also draws a frame at
  once: hit testing reads the last drawn frame, so without it a right-click or
  scroll right after a drag could land on the removed layer and do nothing.
- **Startup.** Each launch compiled the plugin's TSX files with Babel, about
  1.7 s on a one-core machine. Release builds now cache each compiled file
  under the profile's cache folder, keyed by the file's bytes and the
  executable. Changed bytes, a different build or a corrupt entry recompile.
  The first paint also waits at most 300 ms (was 1 s) for a terminal that never
  reports its background colour; a late answer still switches the theme.

The Voyages "Could not load" error after a session's folder was moved or
deleted is fixed in the plugin (separate change in the same pull request): account
calls retry once at the launch folder when the server rejects the session's
folder.

## Source identity

- Pristine upstream: `843a6c514e606b436a7fe713422ace0a93ad3d61`.
- Complete patch: `docs/patches/opencode-v2.0.32-session-ui-combined-v21.patch`.
- Patch SHA-256: `9a73eb1ded4d9914a554640226949d53caca986ef8b846ef8592fe75a9a1bf92`.

The patch applies cleanly to pristine upstream. Relative to v20 it changes:

- `packages/tui/src/app.tsx`
- `packages/tui/src/component/prompt/autocomplete.tsx`
- `packages/tui/src/component/session-tabs.tsx`
- `packages/tui/src/plugin/runtime-plugin-support.bun.ts`
- `packages/tui/src/prompt/slash-options.ts`
- `packages/tui/src/ui/layout.ts`
- `packages/tui/src/ui/pane-resize-handle.tsx`
- `packages/tui/test/navigation-rail.test.tsx`
- `packages/tui/test/plugin-keymap.test.tsx`
- `packages/tui/test/prompt/slash-options.test.ts`
- `packages/tui/test/ui/layout.test.ts`

It also changes three upstream files that earlier patches left untouched:

- `packages/tui/src/util/path-format.ts`
- `packages/tui/test/ui/pane-resize-handle.test.tsx`
- `packages/tui/test/util/path-format.test.ts`

and adds:

- `packages/tui/src/plugin/transform-cache.ts`
- `packages/tui/src/util/theme-mode.ts`
- `packages/tui/test/component/session-tabs-title.test.tsx`
- `packages/tui/test/plugin/transform-cache.test.ts`
- `packages/tui/test/util/theme-mode.test.ts`

## Validation

- TUI typecheck clean; full TUI suite 1693 pass, 2 skip, 0 fail.
- The title, divider-clamp, drag-release and completion regression tests fail
  against the v20 sources and pass with v21.
- The first five-platform prebuild of this patch failed on three runners: the
  hidden-sidebar mouse test right-clicked the rail just after a divider drag
  and no menu opened. Locally it failed 11 of 30 runs. The cause was the
  stale-frame hit test described above. With the fix it passed 120 of 120
  runs, and a focused regression test that presses right after a resize
  fails 5 of 5 runs without the fix and passes 30 of 30 with it.
- A local linux-arm64 build of this patch, run through the real `ctg` entry on
  a copy of a signed-in profile at 120x36:
  - A long title ends in `…`; after hovering, the full title appears beside the
    rail and the row text is unchanged; moving away removes it.
  - Dragging the divider from column 40 to 71 leaves it at column 55 (the
    widest rail for 120 columns), opens nothing, and the divider returns to its
    resting colour once the pointer leaves.
  - `/ctg-help` and one Enter opens Carthagent help.
  - Browse shows the current folder as `~/…` and offers `~ Home`; no profile
    path appears.
  - With the session's folder renamed away, Voyages shows its signed-out view
    instead of "Could not load".
  - The plugin load stage took 1693 ms before the cache and 137 to 146 ms on
    later launches. Time to the final rail layout on later launches was 2.4 s
    and 3.6 s, against 3.9 to 5.8 s for v20 on the same machine. The first
    launch, which also starts the server, took 8.1 s.

These checks read terminal cell text, not pixels, and timings come from one
one-core arm64 machine. They are not multi-platform release acceptance.
