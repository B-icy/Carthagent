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

The probe sends an actual SGR mouse drag over the fixture response and runs
`/copy`, then decodes the emitted OSC 52 payloads. Those checks are
`OBSERVED_NOT_VERIFIED`, not passes: a PTY can capture the requested clipboard
contents but cannot prove that a real terminal host accepted them or read back
its clipboard. Title restoration is a separate blocking check. The pinned
OpenCode 2.0.32 executable changes its OSC title but emits no VT title-stack
save/restore controls, so the check reports `FAIL`. The probe exits nonzero for
all three unresolved terminal-host checks; do not interpret emitted OSC bytes
as host acceptance.

The existing `tests/tui-copy-paste.test.mjs` covers parser logic and selection
string calculation only; it is not a substitute for this native probe.
