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
- Runtime package: pinned `@opencode/cli` 2.0.32. Its platform-specific optional
  package is installed/materialized by npm postinstall; CTG must invoke this
  package-owned binary, never replace or upgrade a user's global OpenCode.
- Authoring renderer peer baseline: OpenTUI 0.5.17, Solid 1.9.12 (the exact
  Solid peer required by the published OpenTUI package). The host owns runtime
  module resolution; installed-package tests must prove compatibility. The npm
  lock pins transitive `seroval` to patched 1.6.9 (compatible with Solid's
  `^1.0` range) while the required Solid peer is still 1.9.12.
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
- `npm run test:native-package` verifies the npm tarball excludes `node_modules`,
  contains the server and TUI entrypoints, installs with production dependencies
  into a clean prefix, resolves the platform binary from
  `node_modules/@opencode/cli/bin/opencode.exe`, and starts the isolated server
  using that exact binary. CI also runs the owned binary server test on each
  supported OS/Node matrix row; the PTY check is explicitly Unix-only.
- Linux PTY diagnostic passed with the native `/ctg-status` command rendering
  its RPC result. Global commands need `mode: 'global'` in the keymap layer;
  omitting it registered a plugin but left its slash command undiscoverable.
  This is a bootstrap test, not approval of the upcoming full product UI.
- `node tools/test-native-controls.mjs` exercises two concurrent sessions through
  a local deterministic provider on the real 2.0.32 host: delivery framing,
  explicit raw bypass, successful terminal outcomes and compaction notes in the
  actual summary request. Compaction notes use a queued synthetic message because
  the native compact API has no notes parameter; the host can process that
  message in a primary turn before summarizing it.

## Delivery ledger

Each row requires executable evidence, independent review and an exact-head
integration check before its PR merges. In-progress does not mean shipped.

| Workstream | State | Acceptance |
| --- | --- | --- |
| Baseline/build contracts | Merged #137 | Existing checks recorded; TS/TSX included in checks |
| Runtime/isolation | Merged #139 | CTG and normal OpenCode coexist; authenticated persistent service |
| Native plugin host | Bootstrap merged #137; integration in progress | Installed package loads server and TUI entrypoints |
| Session framing/controls | Merged #144, #145, #147, #148 | Per-session defaults, raw bypass, compaction notes, declared ownership errors, restart recovery |
| Providers/auth/telemetry | Merged #141 at `e969e44` after independent review and 16 green CI checks | Concurrent requests/refreshes maintain credential and session identity |
| Delivery/policy/budgets | In progress | Native execution preserves evidence, validators and recovery |
| Native theme/commands/panels | In progress | CTG commands work; host owns input/rendering; semantic themes |
| Workspace/worktrees | Backend merged #138, #146; terminal integration in progress | Independent worktrees and durable task/session mappings |
| Review | Backend merged #146; terminal integration in progress | Fresh-context findings bound to source and PR head; bounded admission |
| Legacy archive | Merged #150; launcher discovery integration in progress | Read-only searchable transcripts; no implicit continuation |
| CLI/headless/dashboard | CLI/headless in progress; dashboard lease fix merged #142 | Output/exit/locking behavior verified against native runtime |
| Packaging/upgrade | #151, #143, #149 merged; #159 installed renderer passes but clean source `npm ci` has a peer conflict under repair | Fresh installation and migration tested from packaged artifact |
| Terminal/performance | Pending | PTY, interaction, streaming and reconnect evidence |
| Default switch/retirement | Pending | No supported default execution path depends on Pi |

### Combined-product acceptance (#155)

The integration branch composes the real server and terminal entrypoints. A
passing domain fixture alone does not satisfy these gates:

| Probe | Evidence and remaining gate |
| --- | --- |
| `test:native-product` | Workspace, archives, controls, execution-event invalidation, disconnected-turn snapshot recovery, and fresh events after reconnect passed through the production entrypoint on 2.0.32 |
| `test:native-host` | All four archive methods, output schemas, declared errors, and unchanged transcript bytes passed through production registration |
| `test:native-controls` | Concurrent framing settings and compaction notes reach the real provider; settings persist across service restart |
| `test:native-outcomes` | Failed/interrupted/succeeded outcomes, HTTP disconnect, neighboring-session isolation, and recovery passed; interruption explicitly uses `resume: false` and leaves a queued prompt pending |
| `test:native-tasks` | Two real Git worktrees, concurrent isolated turns and framing settings, independent root sessions, and restart reconciliation passed |
| `test:native-review` | Configured-model independent review, receipt persistence, source-change invalidation, and three-review admission cap across restart passed |
| `test:native-runtime` | Service reuse, repeated turns, provider rejection, recovery, unavailable-provider failure, final response after tools, correct success metadata, active cancellation, neighbor isolation, pre-aborted invocation isolation, and persisted-session continuation after service restart passed |
| `test:native-pty` | Installed production status, workspace, help, and CTG compact precedence passed after plugin readiness and slash-completion confirmation |
| `test:native-package` | Clean production tarball at integration `2b300c0` passed host, controls, outcomes, product reconnect, runtime, tasks, review, and PTY gates with shared renderer resolution; real native SWE passed its separate evaluation-guard fixture, pending composed CTG delivery coverage |
| `test:native-performance` | Cached workspace RPC: 30 samples, p95 64.8 ms, maximum 181.6 ms; input and session-switch latency require separate terminal measurements |

PR #157 adds a real-terminal measurement harness. Initial input measurements
exceed the 50 ms target, but its echo detector can mistake unrelated redraws for
editor input and requires correction before those values are acceptance evidence.
Warm session switching remains unmeasured. Short idle observations showed no PTY
output; they do not establish long-running memory bounds.

Native runtime-wrapper acceptance, delivery enforcement, provider authentication,
command compatibility, installed SWE workflows, reconnect behavior, and performance
remain release gates. PR #154 removes per-stream shared-dispatcher destruction and
uses captured-dispatcher cleanup at print-mode shutdown. Parent verification of
`46c9ae9` reproduced the pristine patch exactly; seconds and repairs tests passed,
while tool-mode startup hit its total watchdog. The subsequent `d85579b` fixture
separates a bounded startup phase from its 15-second post-stop shutdown deadline.
A controlled clean exact-head parent run passed all three modes and all twelve
natural exits, including successful requests after reset; initial stop-to-close
times were 36–102 ms. Independent review and all fifteen CI checks passed, and
#154 merged. Earlier contended failures remain recorded rather than treated as
passing evidence.
Native execution remains opt-in until these gates pass.

Pinned-host extension gaps remain for visual-only transcript `/clear` and
per-session `/autocompact`. The 2.0.32 plugin interface exposes neither a
transcript presentation boundary nor a per-session automatic-compaction policy.
CTG-owned host extension work must prove these behaviors without deleting history
or mutating shared compaction settings. Theme acceptance also requires installing
the semantic JSON theme in the owned profile and verifying actual rendered colors.

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
