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
| Packaging/upgrade | #151, #143, #149 merged; #164 parser split passes parent plain `npm ci`, codegraph tests, lint and typechecks; green composed CI remains required | Fresh installation and migration tested from packaged artifact |
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
| `test:native-tasks` | Two real Git worktrees, concurrent isolated turns and framing settings, independent root sessions, and restart reconciliation passed; composed PR tracking also passes cached-list schema and typed cross-task ownership rejection without exposing paths. PR #161 merged at approved `d61fb8a` after atomic lock-publication fixes, independent review, and all 16 CI checks passed |
| `test:native-review` | Configured-model independent review, receipt persistence, source-change invalidation, and three-review admission cap across restart passed |
| `test:native-runtime` | Service reuse, repeated turns, provider rejection, recovery, unavailable-provider failure, final response after tools, correct success metadata, active cancellation, neighbor isolation, pre-aborted invocation isolation, and persisted-session continuation after service restart passed |
| `tests/native-cli-host-smoke.mjs` | Composed CLI at `65b5b9f` passes print, repeated turns, provider failure after prior success in print/JSONL, workspace-isolated continuation, and JSONL tool/failure events against the owned 2.0.32 binary; admitted-but-nonterminal cancellation JSONL remains a separate review finding |
| CLI follow-up at `b69d30c` | Composed lint/typechecks and 59 focused CLI/runtime/Ship/archive tests pass, with one platform-specific skip. Review finds the admitted-turn JSONL and OAuth prompt issues addressed, but requests updater validation binding the installed Git ref to the advertised release version, including under `--force`. Demo and remaining delivery-option/UI parity are still open |
| `test:native-pty` | Installed production status, workspace, help, and CTG compact precedence passed after plugin readiness and slash-completion confirmation |
| UI follow-up at `ad9b3fc` | Composed lint/typechecks and 44 runtime/PR tests pass, but the pinned-host PTY still opens native Help for `/help`; Unix CI also fails binary-path resolution. Independent review additionally found workspace event payload filtering drops updates and inventory refreshes lack a generation guard. #152 remains under changes requested |
| UI follow-up at `db79377` | Composed lint/typechecks and 25 PR/live-refresh tests pass. Parent PTY still opens native Help for `/help`: the author's helper retains pre-submit slash-completion text, allowing “Carthagent commands” to satisfy its assertion before actual command output. Post-submit help rendering and the refreshed UI implementation require fresh review/proof |
| Delivery composition at `f27b5e8` | Product entrypoint now registers native delivery and codegraph by default; combined lint/typechecks and real-host product entrypoint/workspace/archive/controls/reconnect checks pass. #163 `e8c93e0` remains under changes requested: independent review reproduced two concurrent same-session calls admitted with a one-tool limit while the stored counter remained one. Atomic admission and composed delivery/SWE acceptance are required |
| `test:native-package` | Clean production tarball at integration `2b300c0` passed host, controls, outcomes, product reconnect, runtime, tasks, review, and PTY gates with shared renderer resolution; real native SWE passed its separate evaluation-guard fixture, pending composed CTG delivery coverage |
| Expanded installed gate at `fdf3aa8` | Host, controls, and outcomes passed; product probe failed because the new delivery RPC output schema uses a `pattern` keyword rejected by the pinned host. Subsequent probes did not run; #160 correction and fresh installed proof are required |
| `test:native-report` with #160 `18c87cb` | Production RPC passes real-host output validation, freshness, false-verified rejection, and session ownership. A separate test-only handler proves the pinned host rejects incomplete `verified` output and accepts the complete active/status-only unavailable/invalid variants. Merged after independent review, parent approval, and all 16 CI checks passed; fresh composed installed proof remains pending |
| Composed SWE at `d07f4c0` | Run succeeded and external final test passed, but only one native shell call was recorded: the fixture incorrectly accepted the failing baseline's “tests 1” text as success. This does **not** prove post-edit native verification; #153 must require baseline shell failure → edit → a second successful shell check → final response |
| Composed SWE with #153 `315356a` | Corrected parent real-host run passes native failing shell → completed edit → distinct passing shell → final response: 4 productive turns, 2 shell calls, 1 edit, succeeded outcome, and external verification passed. Independent review found a remaining benchmark tool-admission race: concurrent ledger read/check/write operations can exceed the cap. #153 remains under changes requested; production delivery-policy enforcement remains a separate gate |
| Delivery-enabled SWE after `f27b5e8` | Fails before tool execution because the fixture expects `edit` while the production planning gate correctly withholds implementation tools. The earlier four-turn proof does not cover enforced delivery. The fixture must follow the real planning, evidence, review, and handoff workflow before full composed acceptance |
| Delivery/SWE follow-up at `ef6efb1` / `1c781c4` | Parent composed SWE passes 11 productive turns through planning, native failing shell → edit → distinct passing shell, declared check, model-authored review receipt, and verified finish. Independent approval covers atomic delivery admission and the SWE-proof delta, not independent review assurance or full policy enforcement. Parent 11 delivery tests and standard real-host scenario pass. #163 CI remains blocked by legacy disabled-extension budget validation; #153's unapproved product ancestry cannot enter main |
| Installed delivery with `ef6efb1` | Parent clean packed install on owned OpenCode 2.0.32 passes all six scenarios: standard (16.295 s), strict (13.999 s), budget (10.725 s), raw (6.288 s), mixed (6.467 s), and concurrent identical-shell calls (7.486 s). This is a focused installed delivery result; the full installed product gate and #163's legacy CLI CI fix remain pending |
| Delivery compatibility follow-up at `b0f162e` | Restores legacy disabled-extension budget rejection while explicitly allowing native session budgets with `delivery:false`. Parent CLI/budget/session-options tests pass 20/20; independent delta review found no regression and passed 31 focused tests plus native typecheck. Unix CI now reaches the older PTY helper but fails because `/ctg-status` remains at slash completion without submission; a strict post-submit probe correction is pending |
| CLI follow-up at `cf098d9` | Parent focused CLI/updater tests pass 55/55; independent review finds release-tag binding and isolated offline demo sound. Review still requests a real consumer for the saved codegraph cap and correct resumed `--no-guide` precedence over saved framing toggles. Native budget/disabled-delivery option wiring remains open |
| Evaluation follow-up #165 at `af124ca` | Merged after independent review, parent approval, and all 16 exact-head CI checks passed. The clean evaluation-only branch avoids #153's unapproved product ancestry; #153 was closed without merging and its branch retained. Its four-turn runtime proof is separate from the product's reviewed eleven-turn composed delivery proof |
| Owned runtime #166 at `6b816a6` | Changes requested: independent review found client-controlled shell provenance, omitted provenance classified as manual, missing pristine-source enforcement, and an unconditional macOS-incompatible checksum command. Patch hash/application and 22 runtime tests pass. Parent also found mismatched service reuse and Windows artifact naming. The recorded binary predates the final title change; corrected attribution/build/identity, exact-patch binary proof, two-session restart isolation, automatic-overflow compaction, and final title verification remain open |
| `test:native-performance` | Cached workspace RPC: 30 samples, p95 64.8 ms, maximum 181.6 ms; input and session-switch latency require separate terminal measurements |
| Terminal semantics #162 at `608ea09` | Author reports exact 18,047-byte Unicode paste received by the loopback provider. Review found picker cancellation and usable 40×12 layout insufficiently asserted, clipboard actions insufficiently correlated to emitted payloads, and title/exit capture incomplete. These checks remain unverified; corrected assertions and an exact-run artifact with executable identity and exit status are required before acceptance |

PR #157 adds a real-terminal measurement harness. Its corrected editor-cell input
detector still needs a controlled paired assessment against the 50 ms target.
At `22109cb`, a 30-switch diagnostic reports p95 573.526 ms and maximum 696.095 ms,
above the 150 ms target. Independent review found both destinations warmed and no
intentional delay inside the timed interval. The measurement is an Enter-to-parsed-
PTY-screen proxy, including terminal read/parse overhead, not a compositor
presentation timestamp. A controlled, alternating baseline/CTG comparison remains
pending; this diagnostic neither establishes acceptance nor attributes latency to CTG.
The prepared ABBA runner at `08d8bf8` remains under changes requested: its CTG
staging omits required runtime files, it does not verify observed plugin activation
or baseline absence, artifact identities are missing, and failed conditions do not
propagate a failing runner exit status. Correct these before the controlled run.
Short idle observations showed no PTY output; they do not establish long-running
memory bounds.

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
