# Loading and sidebar refresh

## Behavior

- Interactive `ctg` startup shows a transient animated status line while preparing
  the profile/runtime, connecting to the service, and loading sessions. The line
  is cleared before the native console takes over.
- `ctg update` shows release-check, package-resolution, and installation stages.
  Normal output clears the transient line first; cancellation clears it too.
- Redirected output and `TERM=dumb` receive no progress escape sequences.
  `CTG_REDUCED_MOTION=1` makes launcher and Voyages loading feedback static.
  Native-console animations continue to follow its existing animation setting.
- Native startup uses the existing spinner/shimmer component with a 150 ms
  appearance delay and a 500 ms minimum display, rather than a three-second hold.
- Projects has clearer mode selection, a labelled current-folder card, explicit
  model selection, a Search label, readable session states, and empty states.
  Grouped scroll and drag positions now include folder headings and gaps.
- Focused Projects supports arrows or j/k, left/right to collapse/expand,
  Enter to open, `/` to search, `n` for a new session, and Escape to return.
  Entering keyboard focus anchors the cursor to the current session, including
  when folder metadata arrived before the session list during startup.
- Voyages uses readable quest statuses, completion counts, indented quests,
  theme-aware selection, shorter action descriptions, loading/error/empty states,
  and grapheme/cell-aware truncation. Selection and scroll survive mode switches.
- Inherited update, crash, permission, onboarding, settings, and resume messages
  use Carthagent branding. Crash reports open the Carthagent issue tracker.

## Runtime provenance

The development patch is
`docs/patches/opencode-v2.0.32-session-ui-combined-v7.patch`.
It applies to source revision `843a6c514e606b436a7fe713422ace0a93ad3d61`;
`script/ctg/prepare-development-runtime.sh` and
`CTG_DEVELOPMENT_RUNTIME_PATCH_SHA256` pin its bytes.

This follows the delayed startup and staged upgrade feedback inspected in
OpenCode v1.19.5, using the existing CTG runtime and OpenTUI 0.5.17 components.

Published beta.4 continues to use combined-v6. Combined-v7 is a development
candidate, not a published five-platform runtime. Promoting it requires the
normal owned-runtime build/provenance and package release workflow.

## Verification

- `npm run quality`: lint, build/typechecks, and 1,137 tests passed; 5 skipped.
- Runtime `bun run check`: all 35 tasks successful.
- Linux x64 compiled runtime built successfully.
- Runtime sidebar/navigation/model/layout tests: 118 passed across 12 files.
- Final navigation stress run: 140 tests passed across ten full-suite repetitions,
  including a real held profile lock during folder collapse. Persistence is
  asynchronous I/O; the acceptance check uses a bounded state wait rather than
  a renderer-frame deadline. Instrumented writes took up to 641 ms locally.
- Corrected beta.5 native prebuild: run `41689731417`, source commit
  `8be12940a4d5726e4f0f90625983c3212c574942`. Combined-v7 SHA-256:
  `d5c0b41f8b57c6d3619bef0b0a480ad4adab319ecbe22d5fd1de6be9b8bc2707`.
- That prebuild passed both Linux and both macOS targets. Windows passed all
  140 navigation checks after a transient dependency-download retry, then exposed
  36 Unix-specific sidebar fixture/assertion failures. Native path resolution and
  separator-aware expectations correct those tests, including successful folder
  selection that was incorrectly waiting for a forward slash on Windows.
- The portable-test revision pins combined-v7 SHA-256
  `4a3b59d584864d2d0f248bc521b69c350fdfb20ba50e3955675d7432b1a217b4`.
  Runtime `bun run check` passed again after these corrections.
- Repeated session-setup fixtures clear their reused tab's process-local draft
  stash before mounting. The stress run exposed a prior test's retained draft
  turning `/new` into ordinary text on subsequent repetitions.
- Corrected sidebar stress run: 600 tests passed across seven files and ten
  repetitions, with 3,630 assertions and zero failures. Final runtime checks
  passed all 35 tasks; runtime-pin/workflow checks passed all 25 tests.
- The prior CI Linux artifact independently passed archive/executable verification
  and native-host, native-controls, daily-quest, and native-PTY acceptance.
- Voyages real-renderer interaction tests: 12 passed, including compact layout,
  keyboard and mouse focus, modal isolation, and delayed scroll restoration.
- Launcher progress tests cover animation, clipping, abort cleanup, redirected
  output, dumb terminals, disabled progress, and reduced motion.
- Actual launcher PTY: startup reaches Projects; beta update check animates and
  exits successfully; update cancellation exits without installing anything.
  Early startup cancellation exits with code 130.
- Standalone compiled-console PTY: Projects/Voyages switching and resizing at
  110×36, 80×24, and 60×20. At 80 columns the rail is compact; at 60 it is hidden
  by the existing responsive layout.
- Signed-in production acceptance in a fresh durable profile: normal Cloud device
  authorization completed; Voyages loaded the captain, ship, wallet, and three
  current daily quests. Sidebar focus and Enter opened daily assignments. Live
  content remained readable at 110×36, 80×24, and 60×20. Captures are under
  `sidebar-refresh/signed-in/` in the evidence directory below.
- Patch application checked against a pristine index of the pinned source.

Local evidence is retained in
`~/.local/share/carthagent-acceptance/sidebar-refresh/`, including raw terminal
recordings, text frames, `launcher/results-final.json`, and the launcher probe.
Text frames validate terminal content and interaction, not compositor color
rendering; the seascape's colored blocks lose their appearance in text captures.

## Local preview

After compiling a prepared development runtime and producing its manifest and
checksums, select it explicitly with a separate profile:

```sh
CTG_OWNED_OPENCODE_RUNTIME=/path/to/dist-ctg \
CTG_OPENCODE_HOME="$HOME/.local/share/carthagent-sidebar-preview" \
node bin/ctg.mjs
```

The acceptance work uses separate profiles and does not replace the installed
beta.4 runtime or the normal authenticated profile.
