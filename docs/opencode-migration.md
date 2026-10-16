# Native OpenCode migration

## Product contract

Carthagent is moving to OpenCode 2's native terminal host and agent runtime.
The supported workflow is CTG-only and local: project, task, worktree, session,
evidence, independent review. Agent of Empires informs the workspace workflow;
its Rust/tmux runtime is not a dependency. Existing Pi sessions are read-only
archives. New sessions use a CTG-owned OpenCode service and state namespace.

The delivery contract, required validators, fingerprints, check evidence,
standard/strict workflow distinctions, budget admission and review receipts
remain Carthagent domain behavior. A completed model response is not a verified
delivery. Events invalidate cached state; snapshots restore authoritative state
after reconnect.

## Baseline

- Source baseline: `599a8ad19836788a6aaa8a4ce24865e20c211388`.
- Development package: 1.0.3; local installed package at discovery: 1.0.1.
- Target host: OpenCode 2.0.32.
- Authoring/client packages: `@opencode/plugin` and `@opencode/client` 2.0.32.
- Authoring renderer peer baseline: OpenTUI 0.5.17, Solid 1.9.12 (the exact
  Solid peer required by the published OpenTUI package). The host owns runtime
  module resolution; installed-package tests must prove compatibility.
- The user's original checkout contains unrelated in-progress work and is not
  the integration checkout. Title and copy/paste fixes are in the baseline.
- Baseline quality passed: lint, typecheck, syntax build, 474/474 tests.
- Executable host probe: `npm run test:native-host` launches a disposable,
  authenticated 2.0.32 server, loads CTG, validates its health RPC and tears down
  the owned process. It does not test complete product isolation or native UI.
- Local directories on 2.0.32 require root `index.ts` and `tui.ts` entrypoints;
  package `exports` alone did not load. Keep both forms for packaged/local use.
- Plugin inventory can initially be empty during activation. Readiness must
  wait for the actual CTG plugin, not just a healthy HTTP listener.
- Packaged-artifact probe passed after `npm pack` and a clean
  `npm install <tarball> --omit=dev`: server plugin discovery, authenticated RPC,
  rejection of unauthenticated requests and invalid RPC input. The TUI feature
  is discoverable; rendering and interaction still need their separate gate.
- Linux PTY diagnostic passed with the native `/ctg-status` command rendering
  its RPC result. Global commands need `mode: 'global'` in the keymap layer;
  omitting it registered a plugin but left its slash command undiscoverable.
  This is a bootstrap test, not approval of the upcoming full product UI.

## Delivery ledger

Each row requires executable evidence, independent review and an exact-head
integration check before its PR merges. In-progress does not mean shipped.

| Workstream | State | Acceptance |
| --- | --- | --- |
| Baseline/build contracts | In progress | Existing checks recorded; new TS/TSX included in checks |
| Runtime/isolation | In progress | CTG and normal OpenCode coexist; authenticated persistent service |
| Native plugin host | In progress | Installed package loads server and TUI entrypoints |
| Providers/auth/telemetry | In progress | Concurrent requests/refreshes maintain credential and session identity |
| Delivery/policy/budgets | In progress | Native execution preserves evidence, validators and recovery |
| Native theme/commands/panels | In progress | CTG commands work; host owns input/rendering; semantic themes |
| Workspace/worktrees | In progress | Independent worktrees and durable task/session mappings |
| Review | In progress | Fresh-context findings bound to source and PR head; bounded admission |
| Legacy archive | In progress | Read-only searchable transcripts; no implicit continuation |
| CLI/headless/dashboard | Pending | Output/exit/locking behavior verified against native runtime |
| Packaging/upgrade | Pending | Fresh installation and migration tested from packaged artifact |
| Terminal/performance | Pending | PTY, interaction, streaming and reconnect evidence |
| Default switch/retirement | Pending | No supported default execution path depends on Pi |

## Review workflow

Implementation uses `lattice/gpt-6-luna#high` in separate worktrees. A different
fresh-context Luna session reviews each PR. The parent integrator checks the
actual diff, tests, integration contracts and exact head before merging. New
commits invalidate the previous head's approval. No implementation agent merges
its own work. Required CI remains authoritative; failures are not converted to
success by documentation or model verdicts.

## Important compatibility decisions

- Preserve CTG slash names, aliases and arguments through one command manifest.
- `/raw` bypasses prompt framing, not execution policy.
- `/restart` must not restart every session's shared service.
- `/clear` must not delete durable transcript history.
- Existing `--isolate` means extension/skill discovery isolation, not a worktree.
- `.harness` state remains per worktree; project views aggregate it.
- Independent worktree tasks use explicitly located sessions. Native child
  sessions inherit their parent's location and are not assumed isolated.
- Ship telemetry must be request/session scoped, never one process-global
  current session. Rotating credentials require serialized atomic refresh.
- CTG runtime XDG overrides must not leak into workspace command environments.
- Theme names remain compatible; V1 token objects must be converted to V2.
- Legacy transcripts are archives. No experimental transcript import is needed.

## Evidence policy

Use deterministic offline provider fixtures for automated integration and PTY
tests. External repository fixtures are pinned and isolated. Paid model
comparisons require a separately recorded spending cap and are not necessary to
prove deterministic runtime integration. Record native terminal/platform gaps
explicitly. Saved screenshots or recordings are not visual approval by
themselves.
