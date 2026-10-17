# Natural `/help` dispatch patch review

Standalone upstream patch: `docs/patches/opencode-v2.0.32-help-dispatch.patch`

- Upstream baseline: OpenCode `843a6c514e606b436a7fe713422ace0a93ad3d61` (v2.0.32)
- Upstream implementation commit: `75fea3b9475da6bbc59c5eeb6461a2994c84341b`
- Final upstream source including review corrections: `3858bfdf5d8797230237435ea933eef9d031077c`
- Patch SHA-256: `f6993068688df82f407d5c44b7d58da27047845f2bd7a3ce88060c037a8b9097`

The TUI's native `/help` command is a fallback rather than an exclusive
reservation. Autocomplete presents one `/help` option: the most recently
registered non-native extension command, or native `help.show` if no extension
claims the name. Direct Enter dispatch applies the same last-extension-wins
rule. Other argument-taking slash commands retain their previous first-match
dispatch behavior. When a plugin is disabled/deactivated, disposing its keymap
layer removes its claim; autocomplete and Enter then fall back to native help.
Duplicate extension claims are deterministic: the last registered extension
owns `/help` until its layer is disposed, then the previous extension (or native
help) is revealed.

## Focused regression test

Test: `packages/tui/test/plugin-keymap.test.tsx`,
`a plugin /help overrides native /help for natural autocomplete selection and restores it on disable`.

Run from `packages/tui` with Bun 1.4.2:

```sh
bun test --timeout 30000 --test-name-pattern 'plugin /help' test/plugin-keymap.test.tsx
```

Result on final source: **1 passed, 0 failed**. The fixture types `/help` while
autocomplete is open and presses Enter without escaping or dismissing it. Two
plugin commands claim `/help`; the later handler runs. The test verifies no
`/session` request was made, disables the plugin through the plugin UI, then
submits `/help` again and verifies native help appears, also without a session
request.

## Broader test observations

An earlier unfiltered run of `plugin-keymap.test.tsx` against the initial
implementation reported **4 passed, 1 failed**. The failing test was the new
help test, because the temporary fixture did not match the plugin identity used
by the plugin-management UI. The fixture was corrected; it is not a passing
result for the final source and is retained here as investigation history.

A later unfiltered run during concurrent typecheck activity timed out in the
existing test `setup layers before and after await reach keyboard, palette, and
slash across disable and enable`; the help test also timed out while trying to
locate the plugin entry. The captured terminal showed the plugin UI still at
`fixture.help-override`, while the helper waited for `fixture.setup-keymap`.
This was an intermediate fixture-selection mismatch, subsequently corrected by
making the helper query the fixture's actual plugin ID. That full-file run is
not evidence of a final-code regression.

Baseline control: the unmodified `843a6c5` worktree ran that existing
`setup layers before and after await...` test alone and passed (**1 passed, 0
failed**). The final focused help test also passes alone. The unfiltered file
has not been rerun successfully on final source; no claim is made that the
entire file is green.

## Typecheck and fixture limits

`bun run typecheck` from `packages/tui` was attempted using the available shared
dependencies. It emitted broad unrelated diagnostics across `packages/core`
and source files resolved from the dirty prototype checkout (including missing
workspace packages, Node/DOM/Bun globals, and Effect type errors), then exceeded
the 120-second timeout and was terminated. This environment did not provide a
valid full-package typecheck result. The autocomplete optional `command.slash`
access is explicitly guarded before reading `slash.arguments`.

The test runner prints an existing `MaxListenersExceededWarning` for renderer
resize listeners; it also occurs in the baseline control. No assertions were
weakened. The final-binary PTY proof is deferred until composition with the
independently reviewed session-ui and theme patches and the pending glyph work.
