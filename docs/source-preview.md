# Projects sidebar source preview

This preview runs the redesigned Projects sidebar from OpenCode source plus the
Carthagent plugin in this checkout. It is a development preview. Nothing here
builds, publishes, installs, or changes the published `ctg` runtime.

## What is pinned where

| Purpose | Patch | Recipe | Hash reference |
| --- | --- | --- | --- |
| Published runtime (preview.12) | `docs/patches/opencode-v2.0.32-session-ui-combined-v4.patch` | `script/ctg/build-owned-runtime.sh`, publish workflow | `CTG_RUNTIME_PATCH_SHA256`, `lib/opencode/runtime-release.json` |
| Source preview (development) | `docs/patches/opencode-v2.0.32-session-ui-combined-v5.patch` | `script/ctg/prepare-development-runtime.sh` | `CTG_DEVELOPMENT_RUNTIME_PATCH_SHA256` |

Both patches apply to clean upstream `https://github.com/anomalyco/opencode` at
`843a6c514e606b436a7fe713422ace0a93ad3d61`. v5 is a replacement patch: it
contains everything in v4 plus the sidebar, folder browser and new-session
setup sources and their tests under `packages/tui/test/sidebar`. Do not apply
v4 first.

## Setup

1. `npm ci` in this checkout (the plugin runs from `plugins/carthagent`).
2. Clone upstream into a new directory, check out the pinned commit, and run
   `script/ctg/prepare-development-runtime.sh <checkout>`. The script refuses a
   different commit, a dirty checkout or a patch with the wrong SHA-256, then
   runs `git apply --check` and `git apply`. It does not install or compile.
3. Run `bun install` with Bun 1.4.2 in the prepared checkout.

## Launch

```sh
script/ctg/source-preview.sh --source DIR --profile DIR --bun PATH [--workspace DIR] [-- ARGS...]
```

- All three of `--source`, `--profile` and `--bun` are required. Relative
  paths resolve against your current directory, so you can launch from
  anywhere. Paths with spaces work when quoted.
- The launcher checks that `packages/cli/src/index.ts` and `node_modules`
  exist and that `bun --version` matches the checkout's `packageManager` pin.
  It fails before touching the profile when a prerequisite is missing.
- It runs Bun with `--no-env-file` from `<source>/packages/cli` (required for
  JSX resolution) under `env -i`. Only these variables reach OpenCode: `HOME`,
  `PATH` (Bun's directory, Node's directory if found, `/usr/bin`, `/bin`),
  `TERM`, `COLORTERM`, `TMPDIR`, the four `XDG_*` directories,
  `OPENCODE_CONFIG_DIR`, `OPENCODE_TEST_HOME`,
  `OPENCODE_DISABLE_PROJECT_CONFIG=1`, `OPENCODE_DISABLE_AUTOUPDATE=1` and
  `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`. Provider API-key variables are never
  passed through.
- First launch creates the profile (0700) with `config/opencode/opencode.json`
  (the plugin path), `cli.json` (Carthage theme) and `themes/carthage.json`
  (all 0600). Each file is created only if absent; existing configuration,
  sessions and authentication are left untouched. If an existing
  `opencode.json` does not list the plugin, the launcher prints a warning and
  still leaves the file alone.
- `--standalone` is always used, so the CLI starts its own private server on
  a loopback ephemeral port (`--port 0`) that exits with the TUI. `--server`
  is rejected. Without `--`, the workspace (default: current directory) is
  opened. With `--`, the remaining arguments run another CLI command in the
  same profile, for example `-- auth login`.

## Use

- **Folder card** (top of Projects): current folder, abbreviated path (click
  for the full path), Browse, New session and the model action. Narrow layouts
  show compact `⌕` search, `▤` Browse and `◇` model controls.
- **Browse** (`/browse`, palette “Browse folders”): Filter and Path inputs
  (Tab switches), Up/Down select, Enter opens, Alt+Left/Right/Up for
  Back/Forward/Up, Alt+H for Home, Ctrl+S confirms, Escape cancels.
- **New session** (`Ctrl+X N`, `/new`, palette “New session” or “New session
  in folder…”, folder card, compact `+`, folder right-click menu): choose the
  folder, then the model. Global entries start at the folder a plain new
  session would use; project entries start at that project's folder. Nothing
  is created until the first message is sent; cancelling leaves the current
  session, draft and model unchanged. `/model` also works before a session
  exists. The model step inside setup has no integration shortcut; connect
  integrations from the standalone model picker (`Ctrl+X M`).
- **Exit**: `/exit` or palette “Exit the app”. The private server exits with
  the TUI.
- **Resume**: relaunch with the same `--profile` and select the session in
  Projects. Automatic resume is not part of this preview.

## Tests

Run serially. Close the preview first.

```sh
# Product (from this checkout)
node --test --test-concurrency=1 tests/source-preview.test.mjs tests/native-ship-plan.test.mjs tests/native-model-command.test.mjs
npx eslint . && npm run typecheck

# Native (from <source>/packages/tui, using the same isolated variables as the launcher)
bun --no-env-file test --timeout 30000 test/navigation-rail.test.tsx \
  test/component/session-tabs-rail.test.tsx test/context/session-tabs-model.test.ts \
  test/ui/layout.test.ts test/sidebar
```

`tests/source-preview.test.mjs` uses a Bun test double and synthetic profiles,
so it proves argument handling, isolation and config preservation, not a real
launch.

## Limits

- Source preview only. No native binary, package or release includes these
  changes, and the published runtime remains v4.
- Verified on Linux with Bun 1.4.2. No cross-platform launch matrix was run.
- The native type checker (`tsgo`) and native build are not part of this
  workflow; Bun tests compile the changed modules but are not a full static
  type check.
- Some native tests outside the focused list fail in the same way on the
  pre-change sources (for example missing `ToastProvider` in
  `session-tabs-status` harnesses).
