# Draft release notes: native OpenCode migration

> **UNRELEASED — draft only.** Planned version: **1.1.0**. No tag or release
> has been published.
> This document is not a release announcement and does not imply that the
> native default switch or full product acceptance is complete. The packaged
> five-platform runtime manifest is a reviewed candidate; publishing assets
> and passing release gates are still pending.

## Proposed highlights (subject to acceptance)

- Native OpenCode project, task, worktree, and session workflow with Carthagent
  delivery status and workspace context.
- Carthagent-owned OpenCode runtime and profile, isolated from the user's normal
  OpenCode configuration, service, credentials, data, and sessions.
- Headless execution with text output or selected-session JSONL lifecycle
  events, plus workspace delivery status in JSON.
- Read-only access to legacy Pi transcripts through archive list, search, read,
  and export commands. No transcript import or continuation is provided.
- Existing command names and aliases retained where supported by the native
  CLI compatibility layer.

## Migration and compatibility notes

- In this candidate, native execution remains opt-in with `CTG_NATIVE=1`.
  Without the variable, the existing CLI remains the default. Making native
  execution the default is pending UI tests and the remaining migration and
  release acceptance gates; do not set the variable persistently unless that
  routing is intentional.
- The native runtime uses the package-owned OpenCode 2.0.32 executable and CTG's
  isolated profile. It does not update or reuse regular OpenCode installations
  or credentials.
- Legacy Pi session files are read-only archives; they cannot be resumed,
  continued, or imported as native OpenCode sessions.
- Unsupported options fail closed. In the current adapter, `--bash-cap` and
  `--isolate` are unsupported, and budget or policy options require advertised
  enforcement capabilities.
- Acceptance is not complete. See the [migration ledger](opencode-migration.md),
  [compatibility matrix](native-compatibility.md), and
  [terminal evidence status](native-terminal-semantics.md#evidence-status-pr-162)
  for unresolved gates. Do not describe this migration as generally available
  until release ownership confirms those gates and the installed product.

## Install/update (for a future published release only)

After the planned release passes acceptance and is published, the
documented exact-tag npm installation form is:

```sh
npm install -g --install-links=true github:B-icy/Carthagent#vX.Y.Z
```

Replace the placeholder only with the real published release tag. Version
`1.1.0` is planned, but no final tag has been created. This candidate packages
the reviewed immutable owned-runtime manifest for five platforms, pinned to
OpenCode source revision `843a6c514e606b436a7fe713422ace0a93ad3d61` and runtime
identity `0.0.0-ctg.2.0.32`. The assets still need to accompany a draft release
and pass final release verification and installed acceptance. The composed
preview resolves upstream `@opencode/cli@2.0.32` through Node's package resolver,
including npm-hoisted layouts; that preview dependency is distinct from CTG's
owned runtime identity. Performance, UI tests, native-default acceptance, and
full installed acceptance remain open in the
[migration ledger](opencode-migration.md#delivery-ledger).
The shared native update operation supports npm-installed packages and clean
source clones: for a clone it fetches the selected origin tag into a private ref
before checking out its resolved commit, and refuses dirty clones. Do not infer
that every native command surface is wired to this operation. `ctg update`
updates Carthagent, not a user's regular OpenCode installation, and does not
change the native opt-in default. See the
[upgrade guide](native-upgrade.md#release-installation-and-update) for the
current command-path distinction. Native migration acceptance remains open; do
not infer completion of unrelated CLI, UI, or transport follow-ups not yet
composed here.
