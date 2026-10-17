# Native terminal semantics probe

`npm run test:native-terminal-semantics` is a real-PTY probe for the native
OpenCode TUI. It requires an explicitly owned 2.0.32 executable:

```sh
CTG_OPENCODE_BIN=/absolute/path/to/opencode.exe npm run test:native-terminal-semantics
```

The executable runs with a fresh temporary project, config, database, and XDG
profile. Its only model endpoint is a loopback offline HTTP fixture; no paid
provider is contacted. A bracketed paste containing Unicode and a large
multiline payload must arrive exactly in the fixture request before the probe
reports that behavior as passed. The probe opens the native model picker, sends
Escape, then resizes the actual PTY to 40x12. Picker cancellation is passed
only if its visible heading was observed before Escape; otherwise it is
explicitly unsupported.

This is intentionally not an all-green acceptance test on a plain PTY. A PTY
does not implement an interactive terminal emulator's selection buffer,
clipboard readback, or window-title state. Such checks are emitted as
`UNSUPPORTED` (or `OBSERVED_NOT_VERIFIED` when raw OSC output alone was seen),
listed in `incompleteChecks`, and cause a nonzero exit. Do not interpret that
as a pass. A capable terminal-emulator harness must provide readback/state
assertions before those criteria can be accepted.

The existing `tests/tui-copy-paste.test.mjs` covers parser logic and selection
string calculation only; it is not a substitute for this native probe.
