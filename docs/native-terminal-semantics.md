# Native terminal semantics probe

`npm run test:native-terminal-semantics` is a real-PTY probe for the native
OpenCode TUI. It requires an explicitly owned 2.0.32 executable:

```sh
CTG_OPENCODE_BIN=/absolute/path/to/opencode.exe npm run test:native-terminal-semantics
```

The executable runs with a fresh temporary project, config, database, and XDG
profile. Its only model endpoint is a loopback offline HTTP fixture; no paid
provider is contacted. The full probe checks an exact Unicode/large bracketed
paste, picker cancellation, and the rendered state after resizing the PTY to
40x12. Focused switches are available for corrected semantics:

```sh
CTG_OPENCODE_BIN=/absolute/path/to/opencode \
  python3 tools/native-terminal-semantics.py --focused-host-roundtrip \
  --artifact /tmp/focused.json
CTG_OPENCODE_BIN=/absolute/path/to/opencode \
  python3 tools/native-terminal-semantics.py --assertion-regression-only \
  --artifact /tmp/layout.json
CTG_OPENCODE_BIN=/absolute/path/to/opencode \
  python3 tools/native-terminal-semantics.py --picker-regression-only \
  --artifact /tmp/picker.json
```

The picker-only case opens the picker, sends Escape, and requires dismissal,
restoration of the home composer, and zero provider requests before acceptance.
The layout check requires the actual 40x12 PTY geometry, a visible fixture
response and composer, no visible picker, a live host, and rendered rows that
fit the viewport.

The focused clipboard case seeds modeled clipboard state, drags across exactly
`SNIP` in the displayed `FINAL[SNIP]END` response, queries the modeled host,
then invokes `/copy` and checks the new clipboard-update delta and exact
readback against the distinct full response. Selection and `/copy` statuses
are labeled as controlled-host-model acceptance. They are not physical OS
clipboard verification. The `--host-model-only` mode is a parser/state-model
self-test only; it does not launch OpenCode and is not native acceptance.

Title acceptance requires the title-stack save and restore controls in order,
the seeded title as final modeled host state, a drained PTY, and normal exit
code zero. Results identify the exact executable path, `--version`, binary
SHA-256/build hash, probe and plugin hashes, source commit/dirty state, and
terminal geometry. A non-passing or unrun lane keeps the overall artifact
incomplete; captured OSC bytes alone never prove physical clipboard behavior.

## Evidence status (PR #162)

The evidence directory contains the previous picker/model passes and the latest
attempted focused/layout artifacts with their original metadata. Treat these as
provenance, not one all-green suite. The focused and layout PTY runs used binary
SHA-256 `30a3bb65d4d005c7a12e82d3b97579dc97e451c23b0dac660123f91534c9f484`.
That build predates the author's final title-restoration patch and is therefore
not acceptance evidence for title restoration; its recorded title `PASS` is
explicitly superseded. Its controlled-host OSC 52 observations do not prove
physical OS clipboard behavior. The latest picker attempt is incomplete and
does not supersede the earlier recorded picker pass.

At this revision, narrow-layout acceptance is unresolved, and exact native
selection/copy plus final-binary title restoration are pending rerun on the
author's final binary. The controlled model self-test is parser/state-model
only, not native acceptance. See `docs/native-terminal-semantics-evidence/`
for statuses, hashes, and per-artifact caveats. No physical clipboard claim is
made; overall acceptance remains open.

The existing `tests/tui-copy-paste.test.mjs` covers parser logic and selection
string calculation only; it is not a substitute for this native probe.
