# Live theme control for TUI plugins

Reviewable upstream patch: `docs/patches/opencode-v2.0.32-live-theme-api.patch`

Patch SHA-256: `0bcb1462688c00a09564e9874c3e01429baf92fe004bfc6400704fb24133c123`

The narrow host extension is `context.ui.theme.current()` and
`context.ui.theme.set({ name, mode? })`. It delegates to OpenCode's existing
reactive theme service, which applies changes in the running TUI and persists
configuration. It does not edit theme files or signal/restart the process.
Theme files must be provisioned before TUI startup so the host has discovered
them. A missing theme or unsupported requested mode returns `false` without
partially changing the active theme or mode.

Focused coverage: `packages/tui/test/plugin-theme.test.tsx` (2 tests).
Validation used Bun 1.4.2: focused theme tests pass 2/2 and the plugin package
typecheck passes. This is a standalone candidate patch; it is not composed into
the pinned runtime patch and does not update the runtime recipe digest.
