# Live plugin theme provider proof

This focused integration test closes a boundary left open by
`plugin-theme.test.tsx` in the approved live-theme API patch: those unit tests
mock `host.themes`, while this proof mounts the real Solid `ThemeProvider` and
`ConfigProvider` and passes the actual provider service to `createPluginContext`.

## Reproduction

Start from upstream OpenCode
`843a6c514e606b436a7fe713422ace0a93ad3d61` (v2.0.32), apply
`session-ui-base.patch` followed by `live-theme-api-base.patch`, then apply
`plugin-theme-provider.patch`. Then run:

```sh
bun --cwd packages/tui test test/plugin-theme-provider.test.tsx
```

The test provides dual-mode and dark-only custom theme documents in memory via
the real provider theme source. It verifies the plugin API reports the selected
theme and resolved mode, rendered provider tokens change reactively without a
provider remount, and successful changes persist through the real config
service. Unknown theme names and unsupported explicit modes return `false`
without changing the selection, mode, tokens, or config. Omitting a mode for a
dark-only theme selects the actual dark fallback and persists the selection.

No external provider or network is used; both the theme documents and config
service are test-local. No host API changes beyond the approved patch are made.

## Validation

Run against the exact upstream base plus the two approved patch files, with Bun
1.4.2:

```text
1 pass
0 fail
16 expect() calls
```

The test source is included as `plugin-theme-provider.test.tsx` alongside the
patch for review.
