# Draft release notes: native OpenCode migration

> **UNRELEASED — draft only.** No version has been selected or published.
> This document is not a release announcement and does not imply that the
> native default switch or full product acceptance is complete.

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

- Native execution remains opt-in with `CTG_NATIVE=1` until the migration's
  acceptance gates are approved. Without the variable, the existing CLI remains
  the default. Do not set it persistently unless that routing is intentional.
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

After a release owner selects, accepts, and publishes an actual version, the
documented exact-tag installation form is:

```sh
npm install -g --install-links=true github:B-icy/Carthagent#vX.Y.Z
```

Replace the placeholder only with the real published release tag. No version
or tag is chosen in this draft. `ctg update` updates the Carthagent package using
its validated release resolver; it does not upgrade a user's regular OpenCode
installation, and it does not change the native opt-in default.
