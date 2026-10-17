# Natural `/help` dispatch patch review

Standalone upstream patch: `docs/patches/opencode-v2.0.32-help-dispatch.patch`

- Upstream baseline: OpenCode `843a6c514e606b436a7fe713422ace0a93ad3d61` (v2.0.32)
- Upstream implementation commit: `75fea3b9475da6bbc59c5eeb6461a2994c84341b`
- Final upstream source including review corrections: `242cbb79cab1b473b63e5abbc29973cf6938ecbc`
- Patch SHA-256: `c1ce7d983be8ecdd3481b16da103fb32d144b0ec01f894915a110b46acdc6fe5`

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

Result on final source: focused test **1 passed, 0 failed**; the complete
`plugin-keymap.test.tsx` file **5 passed, 0 failed**. The fixture types `/help`
while autocomplete is open and presses Enter once without escaping or
dismissing it. Two plugin commands claim `/help`; the later handler runs. The
test verifies no `/session` request was made, disables the plugin through the
plugin UI, then submits `/help` again and verifies native help appears, also
without a session request. The fixture uses bare, no-argument `/help`, matching
the CTG command definition.

## Broader test observations

An intermediate unfiltered run failed the existing test `setup layers before
and after await reach keyboard, palette, and slash across disable and enable`:
the new test's `help-override` query had accidentally been applied to that
existing test even though it registered `setup-keymap`. The query was restored
to the existing helper default; the help-specific query is used only by the new
test. The captured full-file run then passed **5/5**. This was an actual test
regression in the intermediate branch and is corrected in the published head.

Baseline control: the unmodified `843a6c5` worktree ran the existing
`setup layers before and after await...` test alone and passed (**1 passed, 0
failed**). Final corrected source ran the entire test file successfully (**5
passed, 0 failed**).

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
