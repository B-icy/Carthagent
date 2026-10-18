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
| UI/readiness follow-up at `c5a3f33`, codegraph at `7da8186` | Staged after restart; eight focused workspace/live/codegraph tests plus composed lint and both typechecks pass. Independent review finds coverage metadata visible but presentation truncation incorrectly changes authoritative completion/gate to incomplete/locked. The author is separating partial view coverage from server readiness; `/help` remains unresolved |
| UI/readiness correction at `11a3650` | Independent delta review approves the bounded readiness fix, and parent ten focused workspace/live/RPC tests pass. Capped display coverage no longer changes authoritative completion or gate; stale evidence beyond the cap still blocks via the report DTO, and missing metadata is shown as unknown. Bare `/help` and shared CLI/UI operations remain open |
| Parser dependency split #164 at `f62e420` | Independent scoped review finds no topology blocker: native renderer resolves `web-tree-sitter@0.25.10`, while codegraph explicitly resolves the `0.22.6` legacy alias. After an initial install timeout, the parent clean packed-install retry passes all seven codegraph behavioral tests using the installed artifact (580 ms), alongside parser resolution and owned OpenCode 2.0.32 identity checks. Targeted harness lint also passes. This is a focused result; full product acceptance and green composed CI remain required |
| Delivery composition at `f27b5e8` | Product entrypoint now registers native delivery and codegraph by default; combined lint/typechecks and real-host product entrypoint/workspace/archive/controls/reconnect checks pass. #163 `e8c93e0` remains under changes requested: independent review reproduced two concurrent same-session calls admitted with a one-tool limit while the stored counter remained one. Atomic admission and composed delivery/SWE acceptance are required |
| `test:native-package` | Clean production tarball at integration `2b300c0` passed host, controls, outcomes, product reconnect, runtime, tasks, review, and PTY gates with shared renderer resolution; real native SWE passed its separate evaluation-guard fixture, pending composed CTG delivery coverage |
| Expanded installed gate at `fdf3aa8` | Host, controls, and outcomes passed; product probe failed because the new delivery RPC output schema uses a `pattern` keyword rejected by the pinned host. Subsequent probes did not run; #160 correction and fresh installed proof are required |
| `test:native-report` with #160 `18c87cb` | Production RPC passes real-host output validation, freshness, false-verified rejection, and session ownership. A separate test-only handler proves the pinned host rejects incomplete `verified` output and accepts the complete active/status-only unavailable/invalid variants. Merged after independent review, parent approval, and all 16 CI checks passed; fresh composed installed proof remains pending |
| Composed SWE at `d07f4c0` | Run succeeded and external final test passed, but only one native shell call was recorded: the fixture incorrectly accepted the failing baseline's “tests 1” text as success. This does **not** prove post-edit native verification; #153 must require baseline shell failure → edit → a second successful shell check → final response |
| Composed SWE with #153 `315356a` | Corrected parent real-host run passes native failing shell → completed edit → distinct passing shell → final response: 4 productive turns, 2 shell calls, 1 edit, succeeded outcome, and external verification passed. Independent review found a remaining benchmark tool-admission race: concurrent ledger read/check/write operations can exceed the cap. #153 remains under changes requested; production delivery-policy enforcement remains a separate gate |
| Delivery-enabled SWE after `f27b5e8` | Fails before tool execution because the fixture expects `edit` while the production planning gate correctly withholds implementation tools. The earlier four-turn proof does not cover enforced delivery. The fixture must follow the real planning, evidence, review, and handoff workflow before full composed acceptance |
| Delivery/SWE follow-up at `ef6efb1` / `1c781c4` | Parent composed SWE passes 11 productive turns through planning, native failing shell → edit → distinct passing shell, declared check, model-authored review receipt, and verified finish. Independent approval covers atomic delivery admission and the SWE-proof delta, not independent review assurance or full policy enforcement. Parent 11 delivery tests and standard real-host scenario pass. #163 CI remains blocked by legacy disabled-extension budget validation; #153's unapproved product ancestry cannot enter main |
| Delivery/review assurance composition | `tools/test-native-swe-host.mjs` drives production native calls in one disposable Git project. In the evaluation session, native `shell` is not advertised before planning; no unadvertised call is fabricated and no policy-hook rejection is claimed. The valid planned shell is positively exercised for red/edit/green. Verified finish is attempted with no plan and again before progress; each exact call result must reject, including the unfinished step. The completed planned check/progress/model-authored review then finishes verified. `carthagent.workspace.startReview` runs on the same workspace's delivery session: a fresh root reviewer has persisted read-only permissions and its receipt binds exact source/HEAD. A source mutation makes the receipt stale; the separate stale-source finish probe is asserted against its own tool-call ID and its result shows invalidated required evidence (not a claim that `delivery_finish` consumes the workspace review receipt). Reviewer admission is driven to its cap. Offline 2.0.32 run passed, 14 productive turns. This establishes only the participating paths above—not OS sandboxing or reviewer quality; the verdict is deterministic loopback output, and permission configuration is checked without a prohibited-write probe. The required fixture test passed before the deliberate source mutation and failed afterward. Standard mode permits implementation after a valid required plan; strict design approval remains a separate mode. The evaluation budget plugin applies its handshake only to marked evaluation sessions. |
| Installed delivery with `ef6efb1` | Parent clean packed install on owned OpenCode 2.0.32 passes all six scenarios: standard (16.295 s), strict (13.999 s), budget (10.725 s), raw (6.288 s), mixed (6.467 s), and concurrent identical-shell calls (7.486 s). This is a focused installed delivery result; the full installed product gate and #163's legacy CLI CI fix remain pending |
| Delivery compatibility follow-up at `b0f162e` | Restores legacy disabled-extension budget rejection while explicitly allowing native session budgets with `delivery:false`. Parent CLI/budget/session-options tests pass 20/20; independent delta review found no regression and passed 31 focused tests plus native typecheck. Unix CI now reaches the older PTY helper but fails because `/ctg-status` remains at slash completion without submission; a strict post-submit probe correction is pending |
| Delivery PTY follow-up at `406314a` | Independent review and a real PTY run confirm command submission and post-submit runtime response; all eight exact-head CI checks pass. Merge is blocked by conflicts with approved main after #165; conflict resolution requires fresh exact-head review and CI |
| Delivery approved-main resolution at `959f11d` | #163 merged as `171c215` after independent review, parent exact-head approval, and all 16 CI checks passed, including both installed-package gates and macOS/Ubuntu/Windows Node 22/24 matrices. Independent checks also passed 39 focused tests, native typecheck, syntax, and post-submit PTY smoke. Product integration retains its fuller fixtures and installed gate. Superseded #156 was closed without merging or deleting its branch. Broader product acceptance and the native default switch remain open |
| CLI follow-up at `cf098d9` | Parent focused CLI/updater tests pass 55/55; independent review finds release-tag binding and isolated offline demo sound. Review still requests a real consumer for the saved codegraph cap and correct resumed `--no-guide` precedence over saved framing toggles. Native budget/disabled-delivery option wiring remains open |
| CLI follow-up at `5eec4bf` | Composed lint, legacy/native typechecks, and 44 focused CLI/session-control/codegraph tests pass. Parent host smoke passes print/repeated-turn/failure/workspace and exact resumed no-guide payload, then fails an obsolete missing-budget-capability assertion against the now-capable production plugin; that call also lacks an explicit fixture model. Review requests an actual consumer for saved `--review`, plus `--bash-cap` and `--isolate` behavior. Real capable-host budget enforcement, remaining JSONL probes, and registration-level codegraph-default regression coverage are assigned |
| Evaluation follow-up #165 at `af124ca` | Merged after independent review, parent approval, and all 16 exact-head CI checks passed. The clean evaluation-only branch avoids #153's unapproved product ancestry; #153 was closed without merging and its branch retained. Its four-turn runtime proof is separate from the product's reviewed eleven-turn composed delivery proof |
| Owned runtime #166 at `6b816a6` | Changes requested: independent review found client-controlled shell provenance, omitted provenance classified as manual, missing pristine-source enforcement, and an unconditional macOS-incompatible checksum command. Patch hash/application and 22 runtime tests pass. Parent also found mismatched service reuse and Windows artifact naming. The recorded binary predates the final title change; corrected attribution/build/identity, exact-patch binary proof, two-session restart isolation, automatic-overflow compaction, and final title verification remain open |
| `test:native-performance` | Cached workspace RPC: 30 samples, p95 64.8 ms, maximum 181.6 ms; input and session-switch latency require separate terminal measurements |
| Terminal semantics #162 at `608ea09` | Author reports exact 18,047-byte Unicode paste received by the loopback provider. Review found picker cancellation and usable 40×12 layout insufficiently asserted, clipboard actions insufficiently correlated to emitted payloads, and title/exit capture incomplete. These checks remain unverified; corrected assertions and an exact-run artifact with executable identity and exit status are required before acceptance |
| Terminal probe follow-up at `1a79b48` | Independent bounded review finds the six assertion/provenance concerns addressed; static checks pass. Model-only checks are labeled separately, and old-binary title results are superseded. Narrow layout, exact native selection/copy, and final-binary title restoration remain unverified pending the corrected owned-runtime artifact. Product-base CI also exposes a pending CLI login-cancellation promise, assigned to the CLI author |
| Terminal harness composition | The reviewed #162 commits are staged by cherry-pick so staging does not auto-close the unmerged PR. Parent model self-test passes and explicitly reports `NOT_RUN` for native acceptance. Exact final-binary terminal proof remains required |
| Composed CI at `f40a176` | Run `39057797799` fails on pending login-cancellation promises (Windows Node 22/24 and Ubuntu Node 22) and the post-submit `/ctg-workspace` assertion (remaining Unix jobs). The packed job passes host, controls, outcomes, product, runtime, tasks, review, and SWE-host probes before the same workspace PTY failure. Browser checks pass. Fixes are assigned; this is not full acceptance |
| CLI cancellation at `268b544` | Independent exact-head approval covers late OAuth-attempt capture, ordinary/masked prompt cancellation, and SIGINT cleanup. Parent stages the two implementation commits; the intervening budget-expectation change is already present from approved delivery integration. Parent CLI/session-option tests pass 42/42 on Node 22.19.0, 24.21.0, and 26.7.0. Composed quality also passes: lint, syntax build, legacy/native typechecks, and 624 tests with one skip and no failures/cancellations. Whole CLI compatibility, supported-platform CI, and full release acceptance remain separate |
| Default packed runtime discovery | Parent added a no-override `resolveOpenCode()` check to the fresh installed-package gate. It reproduces a real launcher failure: npm hoists `@opencode/cli` beside `carthagent`, while the resolver searches only `carthagent/node_modules`. Earlier probes explicitly set `CTG_OPENCODE_BIN` and did not cover default discovery. The runtime author owns the correction; the new gate intentionally remains failing until it lands |
| Follow-up CI at `bd50603` | Run `39058700753` confirms the pending-login-promise failure is gone. Windows Node 22/24 now fail only two updater assertions that expect Unix npm argv instead of the Windows `cmd.exe /d /s /c` wrapper. Unix jobs pass the unit suite and reach the known workspace PTY failure; the packed gate exposes default runtime discovery. These remaining corrections are assigned |
| Release documentation #167 at `34bf9a9` | Independent and parent scoped approval; staged by cherry-pick. Native preview, read-only archives, owned profile, headless JSONL, exact-tag installation, and current updater limits are documented; the legacy install/provider/Ship/console guide remains linked. Release notes stay explicitly unreleased. Parent Python checks pass 13/13 with pinned Pillow 11.3.0 supplied from a disposable dependency directory |
| Windows updater assertions at `b8453c1` | Independent and parent scoped approval; staged as `f1adae0`. Both focused tests pass while retaining exact release-tag assertions and allowing the Windows npm command wrapper. The unrelated rejected theme and budget-smoke changes are not staged |
| Windows plugin startup after `f1adae0` | CI `39060207929` passes the unit suite on Windows Node 22/24, then fails native host startup because the fallback archive root mixes path separators. Parent correction `a6a4290`, independently approved, replaces string concatenation with platform-native `resolve()`. Targeted lint, native typecheck, four archive tests (one Windows-only skip), and the offline native host/archive RPC probe pass locally. Follow-up CI `39061162244` passes both complete Windows Node 22/24 jobs; Unix PTY and packed-install failures remain separate |
| Owned runtime #166 at `57f2e71` | Independent exact-checkout runtime tests pass 27/27 and syntax checks pass. Earlier Windows artifact-path, dead-registration recovery, and bare-PATH identity defects are corrected. Explicit Windows executable extensions and release-workflow draft/tag/checksum handling still require changes. This head is not staged or approved for release; full clear/autocompact/overflow/provenance behavior and the final installed artifact remain pending |
| Terminal evidence #162 at `ad15830` | Binary `85bb44a…` has bounded controlled-terminal evidence for Unicode paste, focused selection/copy, and normal-exit title restoration. The full run retains incomplete selection. Ctrl+O covers the recent-sessions menu, not model-picker navigation/cancellation; 40×12 rendering alone does not prove input interaction. Independent review requests those missing checks. Physical OS clipboard behavior remains unverified |
| Benchmark readiness #157 at `ced188d` | Independent review passes 16 paired guards, three detector tests, and shell syntax checks. Null-plugin provenance and composer detection are corrected in source. Real non-timed readiness must pass before any newly authorized quiet-window run; neither performance nor sustained-memory acceptance is established |
| Shared updater #171 at `92ed5f0` | Independent and parent scoped approval; staged through `31b1aa4`. Twelve focused tests and lint pass. Clean-clone updates fetch the selected origin tag into a private ref and check out its resolved commit, preserving local tags and dirty files; cancelled/timed-out commands cannot report success. CLI/UI wiring remains a separate gate |
| Runtime acquisition #172 at `2ae5755` | Independent and parent scoped approval; staged through `263d613`. Twelve focused tests and lint pass, including actual system-tar USTAR extraction, exact archive/executable digests, redirects, offline cache validation, tamper rejection, and cleanup. Producer archives must explicitly use USTAR; platform artifact validation, trusted release-manifest generation, and default-resolver wiring remain pending |
| Composed quality at `0824cbd` | Parent `npm run quality` passes lint, syntax build, legacy/native typechecks, and 648 tests with one skip, zero failures, and zero cancellations. This includes the reviewed shared updater and artifact acquisition modules; it is not the full installed/native-terminal release gate |
| CLI budget proof through `f8e1a52` | Independent scoped approval of `32d6296` and `f8e1a52`; staged as `a3d39de` and `2388b65`. Parent composition correction `7068e40`, independently approved, reconciles the native validator option name and isolated diagnostic-plugin RPC contract. Full offline CLI host smoke passes against packaged 2.0.32, including admitted-write positive control, rejected over-limit write, persisted stopped counter, session-bound terminal outcome, repeated turns, provider errors, and workspace isolation. Changed-file lint and native typecheck pass. Previously rejected theme/glyph changes are excluded |
| Runtime identity helper #173 at `6f067a5` | Independent and parent scoped approval; staged through `f661454`. Seven tests and changed-file lint pass. Owned binary path, bytes, and provenance are checked against trusted release metadata before execution; runtime identity remains distinct from compatibility version. Integration into host, terminal, and installed-package probes remains pending |
| Owned resolver #166 through `c8b05db` | Independent source and composition review; staged through `1ae6cfc`. Parent runtime/acquisition suite passes 45/45 and changed-file lint passes. Default resolution handles npm hoisting, rejects invalid packaged release manifests, binds service identity to executable bytes, and revalidates automatically selected caches on repeated resolution. Existing product package probe and lifecycle-locked theme provisioning are preserved. Five-platform prebuild/manifest sequencing and final help/theme/glyph acceptance remain pending |
| Combined assurance #168 through `05090ce` | Staged through `35fa6b0` after independent and parent review. Parent actual offline host run passes 14 productive turns, native red/edit/green, specifically correlated premature/stale finish rejections, and source-bound review receipt invalidation. Parent evaluation regression passes. Pre-plan shell is withheld rather than tested through an execution-hook rejection; reviewer read-only permissions are configured, and deterministic verdicts establish receipt plumbing rather than review quality |
| Benchmark admission #174 at `4a0c98a` | Independent and parent scoped approval, staged through `6be3e27`. Parent five-test runner suite passes: eight advertised workspace-local reads yield one marker-bearing result and seven call-ID-correlated budget rejections. This isolated benchmark-plugin probe does not establish combined delivery-policy or direct durable-storage behavior. Separate benchmark evaluator/startup/diagnostic regressions remain assigned |
| Exact picker identity #162 through `167d0df` | Staged through `118a179` after independent review. Parent rerun passes against independently supplied exact owned version and `85bb44a…` executable digest, verified before execution. Selection styling moves from A to B; cancellation preserves A for the subsequent unique provider request. The footer observation is correctly labeled rendered state. This remains bounded evidence, not full terminal acceptance |
| Bounded terminal follow-up #162 through `dc71da6` | Independent review and parent inspection of the model-picker/40×12 evidence; staged through `7a8eea0`. Parent independently reran the actual model-picker probe on the hash-bound `85bb44a…` binary and observed a bounded pass: A/B navigation, cancellation without provider traffic, restored composer, retained rendered model label, and a subsequent unique request using A. Full-run selection remains incomplete and physical OS clipboard behavior is unverified. Final help/glyph artifacts require fresh evidence |
| Composed quality at `7a8eea0` | Lint, syntax build, and both typechecks pass. Unit run reports 654 passed, one skipped, and one failure: the legacy budget-engine reset-follow-up child exceeds its 15-second total watchdog while startup alone takes about 17 seconds; it records a budget stop and closes 856 ms later. An isolated run also fails the tools case, this time at the reset command's 15-second watchdog (18.4 seconds observed); seconds and repairs pass. Both failures are retained, and native process-fixture migration remains assigned. An earlier attempted quality run was contaminated by an author's transient edits to two host probes; those edits were removed from the product worktree and are not attributed to committed source |
| Fresh packed preview at `1ae6cfc` | Parent clean npm-pack/install focused codegraph gate passes, including default runtime discovery without `CTG_OPENCODE_BIN`, parser topology, and installed codegraph behavior. The selected binary is the hoisted upstream-compatible 2.0.32 dependency. This closes the discovered hoisting defect; it does not establish final owned-runtime acquisition or full installed acceptance |
| Fixture and probe identity composition through `5eece55` | Stages independently reviewed #157 `916610a`, #175 `6aefd61`, #178 `d1bb126`, and #179 `8fe21dd`. Independent conflict-resolution review preserves the product fixture helper, additional-plugin options, debug transport, and build-agent default. Parent focused fixture/guard/identity tests pass 26/26, Python PTY unit tests pass 6/6, and artifact/identity/fixture tests pass 26/26 after composition. Changed-file lint and actual offline host/product probes pass against the preview runtime. Reports distinguish exact runtime from compatibility version. No timed performance or memory run was performed |
| Portable executable-mode validation #179 | Unix-target execute bits are validated from USTAR headers on every host; cached filesystem execute bits are checked only on POSIX hosts. Parent artifact tests pass 15/15, including simulated Windows checks. Actual Windows CI remains queued; this does not yet close the platform acceptance gate |
| Composed quality at `5eece55` | Lint, syntax build, and both typechecks pass; 690 tests pass, one is skipped, and none fail. The legacy budget watchdog cases pass in this run; earlier failing runs remain recorded above. This result predates the manifest generator composition |
| Prebuilt manifest generator #177 through `e05dc50` | Independently reviewed source staged through `dfc50ea`. Parent composition initially fails five tests because the current acquisition API also requires a pinned channel. Independently reviewed correction `66f79b3` supplies that channel from the recipe-derived compatibility version. Parent generator/acquisition tests then pass 27/27 and changed-file lint passes. The generator validates five archives, their actual bytes/provenance, allowed members, and platform package metadata, including Windows `os: ["win32"]`. No real five-platform asset set or production manifest has been generated |
| Live theme API #166 at `c84300e` | Standalone patch `0bcb146…` staged at `26957f6` after independent and parent source review. Exposes current selected theme/active mode and validates requested theme/mode before applying live changes. Author focused tests pass 2/2; independent syntax checks pass, but reviewer dependencies prevented test execution. Real ThemeProvider and final-binary command/rendering acceptance remain pending |
| Installed default-runtime gate #176 at `1be5904` | Staged through `c08ed61` after independent source and positive loopback acquisition/identity review. Gate strips runtime/test/profile overrides, uses the installed trusted manifest, independently verifies the selected executable/provenance, and requires an isolated cache. Parent packed codegraph check passes in explicitly labeled preview mode. Required-owned acceptance rejects preview and focused runs; final real-asset installed acceptance remains pending |
| Natural `/help` #180 at `7d238db` | Standalone patch `c1ce7d9…` staged through `e2a8e4e` after independent source review. Parent rerun of the entire upstream keymap test file passes 5/5 with 11 assertions against clean implementation `242cbb79`. Tests cover natural one-Enter autocomplete dispatch, later extension precedence, and native-help restoration after deactivation. The intermediate existing-test fixture regression is corrected and recorded. Final combined-binary PTY verification remains pending |
| Owned assurance and identity reporting | Independently reviewed `98479a1` is staged as `a0dd81b`, keeping actual runtime and compatibility versions separate. Parent preview evaluation passes. Parent explicit-staging product and 14-turn SWE probes pass against independently pinned owned binary `85bb44a…`, including source mutation invalidating completion evidence. These diagnostics do not exercise default release acquisition or verify a release archive |
| Portable path fixtures #181 and owned wrapper preflight #157 | Independently reviewed `65c9fe8` and `2649dd9` are staged through `2556723`. Parent runtime/environment/identity tests pass 46/46. Canonical path assertions cover macOS path normalization; the PATH fixture is portable. Actual shell-child tests verify owned-root/hash binding before execution and selector handoff before seeding. No readiness, timed ABBA, or memory run was performed; the stale retained snapshot was not used |
| Actual Windows archive validation #179 | CI run `39066364339` passes the archive/acquisition cases on Windows Node 22 and 24, including Unix USTAR mode validation and cache checks. Both jobs still fail the separate PATH fixture now corrected by #181; overall platform CI is not yet green |
| Release verifier #170 at `0904202` | Independently approved source staged through `42e515a`. Parent verifier/workflow/acquisition tests pass 22/22, including all five loopback USTAR artifacts through the production acquirer and rejection of an embedded channel mismatch. Required-owned installed gate is an effective dependency, and the tag is rechecked immediately before control-plane publication. Real draft-asset access and final release acceptance remain unresolved; no release action was executed |
| Owned controls #182 at `f0d83b1` | Independently approved proof staged through `36844d3`; parent actual offline run passes against trusted-preflighted staged binary `85bb44a…`. Per-session auto-compaction settings survive a same-database service restart; disabled overflow makes one failed request, enabled overflow follows summary then successful retry. Concurrent identical shell commands correlate provider call IDs, session IDs, hook events, and successful durable tool results. This is Linux staging evidence, not default acquisition or visual `/clear` acceptance |
| Full-TUI glyph source #183 at `46cdb55` | Standalone v4 patch `37d93c0…` and inventory `8727e2c…` are staged as `858fcb5`, byte-identical to independent source approval. Parent full focused tests pass 11/11 with 146 assertions. The three missing-import regressions are corrected; base and candidate typechecks report the same existing context-shape diagnostic. Final combined-host build and binary-bound ASCII/Unicode rendering remain pending |
| Composed quality at `f004955` | Lint, syntax build, and both typechecks pass; 713 tests pass, one is skipped, and none fail. This includes the release verifier/generator, wrapper preflight, owned-control probe source, and published glyph review artifacts; the combined runtime and later UI/CLI corrections are not yet included |
| Focused follow-ups through `5982c88` | Independently reviewed Windows canonical-path assertions `6cb693a`, Windows review-module file-URL loading/CI timeout `7382074`, and native captured-request diagnostics `9fdaac6` are staged. Parent benchmark runner/diagnostic tests pass 8/8. The broader native-default process fixture remains blocked; none of these changes switches the default runtime |
| Combined host source `9930492` | Patch `81e86a4…` has scoped independent source approval. Parent isolated combined glyph/help/theme run passes 17/18; the remaining glyph test assumes an uncached spinner module and fails when other suites import it first. Test isolation, a new exact combined patch review, and a green recipe run are required before building. The subsequent typecheck was cancelled by a server restart and has no completed result |
| CLI #140 cumulative review at `ba40d0b` | The isolation/bash-cap delta has scoped approval, but cumulative compatibility composition is not approved. Preserve the product's lifecycle-locked theme provisioning; the author branch lacks it. The isolated smoke must configure its offline provider and require a successful, correlated request through a real CLI `--isolate` invocation before claiming instruction suppression. Automatic self-review remains separately incomplete |
| Readiness portability #157 at `049afbd` | Independent review requests canonical filesystem containment: a lexically contained import can escape the snapshot through a symlink. Linux focused tests pass 24/24 and PTY units 6/6; these do not establish Windows execution. Follow-up source remains unstaged; no readiness, timed ABBA, or memory workload ran |
| Runtime workflow #166 at `bc6c57b` | Source fixes address candidate paths and reviewed-branch prebuilds. Independent workflow approval remains blocked because the claimed executable positive/tamper/stale-tag fixture is not committed and reproducible from this revision. No build, workflow dispatch, or release upload is approved by this result |
| Restart recovery at `5982c88` | The pushed product commit was restored to a clean worktree after temporary checkouts and staged runtime artifacts disappeared. Prior completed results remain historical evidence; the lost binary and cancelled checks cannot establish fresh final-artifact acceptance. Author work is recovered from surviving files or saved commits without modifying the original dirty checkout |
| Readiness containment follow-up #157 at `f7b7192` | Independently approved cumulative portability and canonical-containment fixes are staged through `6439c3f`. Parent focused fixture/wrapper/guard tests pass 25/25, including actual symlink escape rejection, in-root symlink acceptance, traversal/cross-drive cases, and pre-execution hash rejection. Dependencies were restored with `npm ci`. Windows execution, real readiness, performance, and release acceptance remain separate pending gates |
| Restored composed quality at `2efdb60` | Lint, syntax build, and both typechecks pass. Full tests report 714 passed, one failed, and one skipped. The repair-budget restoration/reset test fails its second child at the child-exit watchdog after 22.152 seconds, with no provider-start or budget-stop phase recorded for that child. The first repair child completed naturally after a recorded budget stop. Process-fixture investigation remains open; this run is not green and does not supersede the earlier passing run at `f004955` |
| Draft transport #185 at `808ebb5` | Cumulative independent and parent source approval; staged through `47b2a7c`. Parent runtime, credential-boundary, transport, identity, and release-verifier tests pass 60/60, including five fixture draft assets through production acquisition and wrong-digest rejection. Changed-file lint passes. Mixed-case download-token keys are removed from npm, runtime, version-check, and PTY children. Actual authenticated GitHub draft acquisition and final installed acceptance remain pending |
| Glyph PTY harness #187 at `f2475f6` | Cumulative independent and parent source approval; staged through `71d8a11`. Parent portable helper tests pass 3/3 and lint passes. The harness requires the exact ordered Unicode payload in the rendered composer, with separate startup-logo chrome assertions; mutation tests reject altered payloads. Unix PTY imports are isolated from portable helper tests. The historical `85bb44a…` result is a negative control only; no positive final-binary rendering result exists yet |
| Benchmark startup/evaluator #189 at `7cc2292` | Cumulative independent source approval and parent review; staged through `045f189`. Parent guard/runner/startup checks pass 9/9, including a real offline native startup sequence with 17 productive turns, checkpoint, declared check, review receipt, and verified finish. Ambiguous repeated same-tool Code Mode invocations fail before execution with an attribution error and no extra reservation. Independent Firefox/HTTP reference and mutant checks passed; no performance, ABBA, or memory acceptance is claimed |
| Real theme-provider proof #190 through `afd820e` | Independently reproduced test-only patch `1afe790…` and parent-reviewed documentation are staged through `483ab54`. The actual ThemeProvider, ConfigProvider, and plugin context show live palette/mode changes and invalid-request rejection; five independent runs pass 18 assertions each, with TUI typecheck passing. The injected in-memory config service proves settings updates, not filesystem or restart persistence. Final combined-binary acceptance remains pending |
| CI at `1419592` (run `39063828436`) | Browser job passes. Unix jobs fail the existing natural workspace PTY gate; package job fails the pre-resolver-fix hoisting check. Windows Node 22/24 fail acquisition tests because Unix-target executable bits are checked on a Windows filesystem. A focused cross-target archive-validation correction is assigned; prior Windows passes do not cover this newer acquisition module |
| Persistent recovery and spinner isolation | Product and active author checkouts are restored under persistent OpenCode worktree storage. Independently approved test-only #194 `5b8020d` is staged as `a0822b5`; patch SHA-256 remains `651f4d08959ed657c94fc77fb6af48992b928f2b63eb922719f34dcb38cd8f26`. The combined runtime source still requires all 19 focused tests in one process and its TUI typecheck before build. |
| Exact canonical selectors #157 through `6fdcbbe` | Independent exact-head approval and parent review; staged through `612a9e2`. Parent wrapper tests pass 4/4, requiring exactly two ordered canonical path lines. Actual macOS CI remains pending at this correction. |
| Portable pure terminal helpers #157 at `b67f08e` | Independent exact-head approval and parent review; staged as `f7ba91c`. POSIX imports occur only inside PTY execution. Parent pure-helper tests pass 6/6; actual Windows CI remains pending. No performance, readiness, ABBA, or memory workload ran. |
| CI at `73e308a` (run `39076427693`) | Browser passes. Windows Node 22 passes the Node suite and host/controls/outcomes checks, then fails Python helper import with missing `fcntl`, now addressed by `b67f08e`. macOS Node 22 fails the selector canonicalization assertion now addressed by `6fdcbbe`. Ubuntu Node 22 reaches the existing workspace PTY failure (`CARTHAGENT` not rendered). These results do not establish green composed CI. |
| Release workflow integration review | Parent found the draft consumer required five total assets while the approved producer uploads five archives plus manifest and checksums (seven assets). Correction and exact-head review are pending. Draft visibility also requires push-capable credentials in metadata-checking jobs, including the producer's validation job; GET-only behavior must not be described as a read-only token capability. No runtime release workflow was dispatched. |

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
The author reports ten passing offline guard tests for the follow-up changes. Select
the intended current product commit explicitly for the run: the earlier `f5bf070`
snapshot predates production delivery and later CLI composition and cannot stand
in for current-product acceptance.
The follow-up is published at `18e8642`. Parent and independent review found a
preflight blocker: double-quoting the JSON-encoded checkout status makes the
generated manifest invalid for both clean and dirty checkouts. Cleanup is also
registered too late to cover setup failures. Source staging, plugin observations,
and failure aggregation appear improved, but actual runner-path regressions are
required alongside these fixes before a timed run can proceed.
At `e6d401b`, independent source review confirms typed manifest serialization is
wired into the runner and cleanup precedes staging. Eleven author guard tests
pass, including the real JSON generator. Review still requires rejecting a
selected source commit that differs from current integration HEAD. Parent also
requested portable test-path handling and offline coverage of actual runner
failure/cleanup paths. No controlled measurement or performance approval exists.
The `d5ad57c` follow-up adds current-HEAD validation and shared ABBA/cleanup tests
(14 author tests pass), but parent inspection found the early validator's exit
code is ignored before `set -e`, and a callback's nonzero exit can be hidden by
an already-recorded zero status. Actual shell-exit regressions and corrections
are assigned; independent review is in progress and ABBA remains on hold.
At `198e66b`, independent review approves the harness for a scheduled run. Parent
isolated execution passes all 15 guard tests, including actual stale-source
rejection, cleanup, and conflicting callback-status/nonzero process-exit cases.
A quiet measurement window is being coordinated; no timed result or performance
acceptance is established by these harness checks.
The authorized attempt ran on 2026-10-17 from 18:15:41 to 18:16:54 UTC using
source `38ad06f` and harness `198e66b`, then exited 1 with no valid samples.
Both baseline seeders failed on a null plugin path; CTG inventory was active,
but both CTG measurements failed to locate the editor placeholder. Artifacts
remain at `/tmp/opencode/ctg-native-terminal-paired-approved-20261017T181325Z`.
These are setup failures, not latency measurements. The quiet window ended;
baseline startup and actual PTY readiness fixes need review before another run.
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
