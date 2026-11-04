# Native folder navigation follow-up

Development branch: `folder-navigation`. This is a local follow-up to beta.6, not a published release.

## Changes

- Projects/Voyages labels use readable foregrounds on a raised selected surface. The focus hint owns a non-shrinking row.
- Browse and New session have persistent filled backgrounds, spacing, and hover feedback.
- Session rows retain both lines; the second line shows Idle, Working, New reply, Failed, or required attention with readable text.
- New session opens with an editable folder path. It accepts absolute paths, relative paths, and `~/`; completion is accepted with Right/End at the end of the input.
- Ctrl+P opens the folder picker; Ctrl+O or clicking Model opens model selection. Tab moves between fields. Plain letters remain path input.
- The picker includes `./ Select this folder` and `../ Parent folder`. Enter/Right activates the highlighted row; Left and Backspace on an empty filter go up. Clicking a folder opens it immediately.
- Direct-path navigation returns focus to filtering after success. Filtering and navigation reset scrolling, including large listings.
- Folder/model/agent ownership remains staged until explicit setup confirmation; session creation still occurs on the first message.

## Reference

Interaction design follows Agent of Empires' MIT-licensed new-session form and directory picker:

- https://github.com/agent-of-empires/agent-of-empires/blob/main/src/tui/dialogs/new_session/path_input.rs
- https://github.com/agent-of-empires/agent-of-empires/blob/main/src/tui/dialogs/new_session/render.rs
- https://github.com/agent-of-empires/agent-of-empires/blob/main/src/tui/components/dir_picker.rs

This adapts those interactions to the existing Solid/OpenTUI implementation and location-scoped filesystem API.

## Verification

- Sidebar, new-session ownership/preflight, folder browser, navigation rail, and rail rendering: **83 passed, 505 assertions**.
- Runtime development trust and native Ship/Plan packaging checks: **18 passed**.
- TUI typecheck passed after final changes. Full runtime `bun run check` passed during implementation (35 typecheck tasks; existing repository lint warnings).
- Linux x64 native development binary built successfully.
- Development v9 patch tree: `364d553fc1b4f74956ab5b1c3a485d155e2d0514`.
- Development patch SHA-256: `eda717ebe6b5d258b3c79153a23130b0f267491bc145cae8da183f2284a25e3e`.
- Expanded runtime suite: **1,613 passed, 2 skipped, zero failures**; native TUI typecheck passed.
- Published combined-v8, release manifest, npm version, and published runtime pin are unchanged.

## Actual terminal evidence

Captured Windows Terminal windows, not reconstructed screenshots, under
`~/.local/share/carthagent-acceptance/beta5-ux-review/native/`:

- `187-aoe-final-sidebar.png`: filled actions, readable tabs and session status lines.
- `188-aoe-final-compact-picker.png`: compact-width picker, current/parent rows, readable selection and footer.
- `189-aoe-native-path-completion.png`: direct path editing and completion.
- `190-aoe-native-selected-location.png` and `191-aoe-native-location-ready.png`: validated different project directory and explicit setup confirmation.
- `192-aoe-existing-session-preserved.png`: reopened original transcript with original session model.

Native interactions exercised parent → filtered child → Right open → Enter select, single-click child opening, completion, directory selection, and returning to the existing session. No prompt was sent during these checks. The preview uses the original acceptance profile, without cloning OAuth credentials.

The local review launcher selects `packages/cli/dist-ux-spacing`. Screenshots retain beta.6 branding because this work has not been versioned or released. Cross-platform release packaging and the broader historical acceptance checklist were not rerun for this development follow-up.

## Spacing refinement

Removed the reserved keyboard-hint row when navigation is unfocused and the wide rail's extra top padding. This removes two empty rows between the tab bar and folder name. The keyboard hint receives its row when focused. Focused navigation/rail/hierarchy regression checks passed (27 tests).
