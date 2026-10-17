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

The supplied binary was identified as `opencode v0.0.0-ctg.2.0.32`, package
manifest `@opencode/cli-linux-x64` `0.0.0-ctg.2.0.32`, SHA-256
`85bb44a65e8c185f4f33d41507d29acc77f2db0cdcb0103a14476021c8e43794`. A
corrected full run passed picker Escape, actual 40x12 layout, exact Unicode
large-paste transport (18,047 UTF-8 bytes), `/copy`, and ordered title
restoration. Its selection gesture was incomplete; a focused rerun on the same
binary passed exact `SNIP` selection/readback, exact distinct `FINAL[SNIP]END`
copy/readback, and title restoration. These clipboard results are controlled
OSC 52 host-model results, not physical OS clipboard verification. Results are
bounded across runs and the full suite remains incomplete as one invocation;
see `docs/native-terminal-semantics-evidence/` for exact harness hashes and
per-run caveats. No physical clipboard claim is made.

The existing `tests/tui-copy-paste.test.mjs` covers parser logic and selection
string calculation only; it is not a substitute for this native probe.
