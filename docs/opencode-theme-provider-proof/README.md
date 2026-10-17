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
provider remount, and successful changes update the settings object through the
injected in-memory `ConfigProvider` service. This proves the config update call
and in-process state, not filesystem persistence or survival across a restart.
Unknown theme names and unsupported explicit modes return `false` without
changing the selection, mode, tokens, or settings object. Omitting a mode for a
dark-only theme selects the actual dark fallback and updates the selected name
in the in-memory config service.

No external provider or network is used; both the theme documents and config
service are test-local. No host API changes beyond the approved patch are made.

## Validation

Run against the exact upstream base plus the two approved patch files, with Bun
1.4.2:

All five consecutive reruns passed (each **1 pass, 0 fail, 18 expectations**).

The test-only source patch is `plugin-theme-provider.patch`.

## Independently verified patch digests

SHA-256 digests for the exact patch inputs used in the independent review:

| Patch | SHA-256 |
| --- | --- |
| `session-ui-base.patch` (base patch) | `36379e0bf4ec0f63929c12b5ac96dfc73df60b124cef9f4adeb36d86287bc92f` |
| `live-theme-api-base.patch` | `0bcb1462688c00a09564e9874c3e01429baf92fe004bfc6400704fb24133c123` |
| `plugin-theme-provider.patch` (test-only patch) | `1afe7901f43261ed1ffa324b1dcf3a317404ecd2175956a1513ca29139427714` |

`bun typecheck` from `packages/tui` also passed. The isolated source checkout's
Git common directory was removed by an environment restart, but its source tree
and test remain at `/tmp/opencode/ctg-live-theme-proof-clean` for evidence. The
test was rerun after a fresh frozen-lockfile install and passed.
