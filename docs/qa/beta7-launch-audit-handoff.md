# beta.7 launch audit handoff

## Summary

The bounded launch audit and repair work is complete, not a release certification. This branch carries the repairs plus sanitized portable findings. No raw screenshots, logs, profile/runtime state or mission tree is included. Start with the [structured findings](beta7-launch-audit-findings.json) and the existing [README QA instructions](../../README.md#beta7-launch-audit-and-repair-checkout-isolated-qa-clone).

The README already documents v16 and gate prerequisites; it is deliberately unchanged. Its historical “nothing pushed” statement describes the completed audit before this administrative handoff, not this branch publication. Its evidence-safety wording must not be read as permission to upload the artifact tree: that tree also contains sensitive runtime/profile state. This handoff supersedes those portability assumptions.

## Branch and baseline

- Branch: `fix/beta7-tui-launch-audit`, on configured `origin` (`B-icy/Carthagent`). No main change, force push, release or PR.
- Baseline: `v1.1.0-beta.7`, `dcfc4e04aac066b70f4f7f241a0d3c6136f071c1`.
- Tested repair head: `46b594eb61922098e2dbf0e2402d3db0c2148d5a`; 16 linear commits above baseline. The additional handoff commit contains only these two documents; it does not change tested product code.

## Repairs and commits

“Fixed” below means repaired and validated within the stated evidence limits, not shipped. Native fixes require cumulative development-v16. Plugin fixes load from this checkout after restart with the published runtime too.

| ID | Repair / original IDs | Commits | Validation and qualification |
|---|---|---|---|
| D01 | Signed-out `/account` `/usage` `/billing` toast `[object Object]`; raw `authentication_required` in Shop/Character; fixed and retested Original IDs: FL-001, FL-004. | 9cb7968 | plugins/carthagent/tests/commands.test.ts; tests/native-voyages-ui.test.mjs; recorded real UI retest.  |
| D02 | Plugin `/help` list selection does nothing; fixed and retested Original IDs: KB-010. | 9cb7968 | plugins/carthagent/tests/commands.test.ts; recorded real UI retest.  |
| D03 | Workspace/report views have no Escape or Back; fixed and retested Original IDs: FL-002, KB-012. | d7d6ce2 | tests/workspace-report-navigation.test.mjs; recorded real UI retest and historical v15 INT-15.  |
| D04 | Evidence view overlap, no scroll at short heights; fixed and retested Original IDs: LAY-011. | d7d6ce2 | tests/workspace-report-navigation.test.mjs; recorded real UI retest.  |
| D05 | Hardcoded "Incomplete DTO section" on complete sections; fixed and retested Original IDs: WF-001. | d7d6ce2 | tests/workspace-report-navigation.test.mjs; recorded real UI retest.  |
| D06 | "unreviewed" despite recorded Ship self-review; fixed (wording) and retested; review systems not merged Original IDs: WF-003. | d7d6ce2 | tests/workspace-report-navigation.test.mjs; recorded real UI retest.  |
| D07 | Voyages rail click activates the row above; fixed; deterministic regression; live pre-fix did not reproduce in 8 attempts (timing dependent), post-fix clicks open the clicked row Original IDs: FL-003, MO-VOY-rail-unfocused-shop. | 525dd33 | plugins/carthagent/tests/voyages-navigation.test.tsx; recorded real UI retest and historical v15 INT-12. Pre-fix live issue did not reproduce in eight attempts; timing-dependent regression failed deterministically. |
| D08 | Shop/Character five-row lists ignore wheel; fixed and retested Original IDs: MO-007. | 525dd33 | plugins/carthagent/tests/voyages-page.test.tsx; recorded real UI retest and historical v15 INT-13.  |
| D09 | Quest details under scrollbar at narrow widths; fixed and retested Original IDs: LAY-010. | 525dd33 | plugins/carthagent/tests/daily-quests-page.test.tsx; recorded real UI retest.  |
| D10 | Selection/preview reset on background refresh; fixed; identity-safe follow-up fa46e41 (scrutiny round 1 blockers PRF-001/PRF-002). Voyages same-account restore retested live across a real reconnect; quest overview restore proven by renderer regression only (live reload hit a transient load error); changed-account path internal tests only Original IDs: VOY-001. | 525dd33, fa46e41 | plugins/carthagent/tests/daily-quests-page.test.tsx; voyages-page.test.tsx; tests/native-voyages-rpc.test.mjs; recorded real UI retest. Two forced 55-second live quest reload attempts failed with a load error; manual Refresh recovered the first quest. Successful live quest restoration not demonstrated; cause unresolved. Changed/unknown account paths are covered by internal tests only; account switching was not authorized. |
| D11 | Quest detail defaults to Submit after auto-select/Details/reset; fixed and retested (Details default; Submit never activated) Original IDs: VOY-002. | 525dd33 | plugins/carthagent/tests/daily-quests-page.test.tsx; recorded real UI retest.  |
| D12 | Cloud sign-in cue disappears after folder switch; fixed in native dev v10 and retested on isolated candidate Original IDs: FL-011. | 94adcf8 | packages/tui test/sidebar/folder-switch-onboarding.test.tsx (in development-v10+ patch); recorded real UI retest. Requires development-v16 runtime; not in the published beta.7 runtime. |
| D13 | Picker docs overpromise single Enter and open/apply/cancel Settings; documentation fixed and checked live Original IDs: FL-005, KB-003. | cc88645 | none (docs only); recorded real UI retest.  |
| D14 | Mouse workflow gaps: no send, inert model badge, no sidebar restore, no palette/Settings/Help entry; fixed in native dev v11 and retested; authenticated live Send turn on v15; narrow usage-bearing footer entry fixed in v16 and retested live on the authenticated profile at 60x20 Original IDs: MO-001, MO-004, MO-009. | 9036882, a7b18c1 | packages/tui test/mouse-workflow-routes.test.tsx; test/feature-plugins/prompt-footer.test.tsx (narrow usage case); recorded real UI retest and historical v15 INT-03, INT-04, INT-06, INT-07. Requires development-v16 runtime; not in the published beta.7 runtime. |
| D15 | Divider hit zone 2-3 cells left of border; fixed in native dev v11 and retested Original IDs: MO-003. | 9036882 | packages/tui test/mouse-workflow-routes.test.tsx; recorded real UI retest. Requires development-v16 runtime; not in the published beta.7 runtime. |
| D16 | Stale New-folder error after Escape; raw model IDs after folder error; fixed in native dev v10 and retested Original IDs: KB-006, KB-007. | 94adcf8 | dialog-folder-browser.test.tsx; new-session-preflight.test.tsx; recorded real UI retest. Requires development-v16 runtime; not in the published beta.7 runtime. |
| D17 | Folder field left-truncates with no indication; fixed in native dev v10 and retested Original IDs: LAY-002. | 94adcf8 | new-session-preflight.test.tsx; util/locale.test.ts; recorded real UI retest. Requires development-v16 runtime; not in the published beta.7 runtime. |
| D18 | `/clear` listed twice; fixed (plugin) and retested Original IDs: PER-007. | cc88645 | plugins/carthagent/tests/commands.test.ts; recorded real UI retest.  |
| D19 | Unsent new-session tab unreachable after Alt+Down/Up; fixed in native dev v12 and retested; close-last-real-tab draft location fixed in v16 and retested in an isolated offline profile (before on v15, after on v16) Original IDs: KB-008, PER-001. | 5798e18, a7b18c1 | test/sidebar/draft-tab-reachability.test.tsx (incl. close-last-real-tab with send destination); recorded real UI retest. Requires development-v16 runtime; not in the published beta.7 runtime. |
| D20 | Permissions under "Session" heading but global; label/help wording fixed in native dev v12; policy unchanged Original IDs: PER-006. | 5798e18 | test/config-v2.test.tsx; recorded real UI retest. Requires development-v16 runtime; not in the published beta.7 runtime. |
| D21 | Dialog selection lost after resize (LAY-005); LAY-005 fixed in native dev v13 and retested; LAY-004 reclassified harness-attributed (unscaled pointer) after scaled recheck on original beta, no product change Original IDs: LAY-004, LAY-005. | 90d4282 | test/cli/tui/dialog-select.test.tsx; recorded real UI retest and historical v15 INT-11. Requires development-v16 runtime; not in the published beta.7 runtime. LAY-004 wheel finding was harness-attributed, not a product fix. |
| D22 | Context menu stays open detached after resize; fixed in native dev v14 and retested Original IDs: LAY-008. | 60f5223 | test/navigation-rail.test.tsx (context menu closes…); recorded real UI retest and historical v15 INT-08. Requires development-v16 runtime; not in the published beta.7 runtime. Mission-added navigation-rail Rename/frame-wait timing debt remains unresolved. |
| D23 | Typed combining marks dropped (paste kept); fixed in native dev v15 (JS layer workaround for OpenTUI EditBuffer) and retested Original IDs: LAY-001. | 105c25a | test/util/combining-input.test.ts; recorded real UI retest and historical v15 INT-10. Requires development-v16 runtime; not in the published beta.7 runtime. |
| D24 | Workspace Filter ignored pointer and Tab; fixed and retested Original IDs: GAP-001. | d7d6ce2 | tests/workspace-report-navigation.test.mjs; recorded real UI retest.  |
| WRBN-NEW-01 | Workspace action rows did not activate on pointer release; fixed and retested (found during D03 repair; present in beta.7) Original IDs: WRBN-NEW-01. | c492bbf | tests/workspace-pointer-actions.test.mjs; recorded real UI retest and historical v15 INT-15.  |

### Scrutiny follow-ups

- **PRF-001** (fa46e41): Restore a preview only after the same verified account binding returns. Deterministic page/RPC cases and live same-account Voyages reconnect.
- **PRF-002** (fa46e41): Preserve the overview quest ID through reorder; invalidate removed, changed or unknown bindings. Deterministic renderer/RPC cases only; live quest restoration failed.
- **SCR-NMWR-01** (a7b18c1): Keep pointer commands entry at 60 columns with usage; preserve full hint at wide geometry. Pre-fix regression failed; v16 authenticated 60x20 pointer palette/settings and keyboard retests passed.
- **SCR-NSS-01** (a7b18c1): Reopen draft in its folder/model and avoid disposed composer consuming text; no draft still opens plain Home. Pre-fix regression failed; v15/v16 offline before/after and exactly-one-session send destination checks passed.

### Linear history

```text
9cb7968 fix: readable signed-out plugin errors and working /help selection
d7d6ce2 fix: navigable, scrollable and truthful workspace report views
c492bbf fix: activate workspace pointer actions on primary release
525dd33 fix: stable Voyages pointer targets, wheel lists and refresh selection
94adcf8 fix: keep folder onboarding cues and new-session labels truthful (native dev v10)
9036882 fix: pointer routes for send, model, palette, sidebar restore and divider (native dev v11)
cc88645 fix: single /clear slash entry and accurate picker docs
5798e18 fix: keep unsent new-session draft reachable and label global Permissions (native dev v12)
90d4282 fix: keep dialog selection visible after resize (native dev v13)
60f5223 fix: close session context menu when its rail anchor moves (native dev v14)
105c25a fix: keep typed combining marks on their base character (native dev v15)
187ebae docs: describe beta.7 audit checkout, gates and coverage limits
fa46e41 fix: restore Voyages and quest positions only for a verified account binding
b0de968 docs: note account-bound refresh preservation in QA summary
a7b18c1 fix: keep narrow footer commands and parked draft location (native dev v16)
46b594e docs: point QA summary at native dev v16 and the full gate prerequisites
```

## Remaining findings and UI suggestions

**AUTH-001** remains historical/open: first login hit a local OAuth-method registration failure shortly before plugin reconciliation; retry succeeded, without a deterministic reproducer. **AUTH-002** remains historical/not reproduced: approved device sign-in left the terminal signed out without visible error; cause unknown. Later successes do not fix either. Fresh authorization requires approval.

**D10 / PRF-001 / PRF-002:** deterministic page/RPC tests cover same binding, overview ID, reorder, removed and unknown cases. Live Voyages preview restoration passed across a real reconnect. Neither forced 55-second quest reload succeeded (load error, then manual Refresh recovered the first quest). Successful live quest highlight restoration is not demonstrated; cause unresolved. Changed-account paths are internal-test-only because account switching was not authorized. The original 90-second idle sample saw no refresh event.

**Native timing debt:** navigation-rail Rename/frame wait failed in v15 recipe attempts 1/2, then passed attempt 3; baseline v14 failed 1/50 and isolated v15 1/30. v16 passed first attempt, not a resolution of timing debt. Session-panel had one loaded-run timeout, then passed alone, three full-file reruns (48/48) and full suite. Command-selection also times out at Bun's default 5 seconds on baseline; 30/60-second suite timeouts preserve expectations. **OpenTUI z-order** remains a generic unaudited overlay risk beyond D15's local stable-wrapper repair.

The following are report-only recommendations, not implemented redesigns:

| Original IDs | Recommendation / latest status |
|---|---|
| FL-006 | **Cloud sign-in entry:** Consider explicit sign-in choices or confirmation instead of starting real device auth on one click. |
| FL-007 / MO-002 | **Hint affordances and keyboard-only actions:** Clarify inert labels and unavailable Start. D14 repairs commands/model/Send/sidebar entry, not all hints. Favorite, worktree refresh/new/delete, directory scope and Right-to-complete remain keyboard-only. |
| FL-008 | **Console cancellation:** Clarify Escape unfocus versus closing and reduce repeated toggles. |
| FL-009 | **Open docs feedback:** Show a URL or failure feedback when no browser opens. |
| FL-010 / KB-004 | **Settings activation semantics:** Consider explicit chooser/confirmation UX. Enter cycles the focused value immediately; Escape closes. D13 documentation is fixed, not a runtime redesign; no approval bypass was proven. |
| FL-012 | **Narrow onboarding:** Improve Cloud cue and connect-hint clipping at 90x30. |
| KB-001 | **Navigation pane focus:** Clarify pane selection versus keyboard focus and expose the focus shortcut. |
| KB-002 | **Control-A consistency:** Explain composer line-start versus Sessions search scope toggle. |
| KB-005 | **Folder shortcuts:** Expose New folder and location shortcuts. |
| KB-009 | **Shop Escape route:** Consider consistent back navigation; current explicit route returns to Coding. |
| KB-011 | **Sidebar naming:** Distinguish the two panels called sidebar. |
| LAY-003 | **Dialog backdrop fragments:** Consider padding/masking for backdrop words adjacent to short dialogs. |
| LAY-006 | **Truncated row labels:** Consider ellipses for right-edge truncation. |
| LAY-007 | **Model loading empty state:** Distinguish loading from transient no-models state. |
| LAY-009 | **Compact rail labels:** Clarify compact Character/Captain naming and split Friends label. |
| PER-002 / WF-010 | **Unsent model/mode persistence:** Committed selections survive restart; only unsent overrides are lost. Optional persistence enhancement, not durable corruption. |
| PER-003 | **Exit with unsent draft:** Drafts are process-local; consider an exit warning. D19/v16 do not add disk persistence. |
| PER-004 | **Existing export error:** Replace raw EEXIST wording; no overwrite was observed. |
| PER-005 | **Session search scope:** Make current-folder scope clearer in resume and rail search. |
| PER-008 | **Unknown command feedback:** Explain unknown slash commands instead of silent no-op. |
| WF-002 | **Permissions expectation:** Prompt displays only policy-generated asks; ordinary calls may be allowed. D20 fixes scope/help wording only; no proven bypass or policy change. |
| WF-004 | **Transient JSON toast:** Replace transient raw preview/review JSON with readable durable feedback. |
| WF-005 | **Collapsed tool failures:** Expose error count in collapsed tool summaries. |
| WF-006 | **Per-agent model memory:** Explain intentional model memory/recent-model fallback when switching mode. |
| WF-007 | **Plan enforcement evidence:** Only model refusal was observed; enforcement path remains unproven. |
| WF-008 | **Failure-heavy Ship transcript:** Investigate only with a reproducible case; one model-dependent run does not isolate a product bug. |
| WF-009 | **Permission/question dialog coverage:** No live dialog was reachable; Allow/Reject remain untested. |
| VOY-003 / ACC-001 / GAP-002 | **Consequential confirm defaults:** Consider Cancel focus for Equip, billing/logout and customization Save. No final confirm/save was activated. |
| VOY-004 | **Locked free item wording:** Show unlock reason in the list, not only in preview. |
| ACC-002 | **Account privacy:** Consider optional masking of account identity for screen sharing; no identity values are included here. |
| ACC-003 | **Usage navigation:** Clarify static Usage view or offer discoverable navigation beyond Escape. |
| MO-006 | **Copy feedback:** Provide completion feedback; no clipboard failure proven because no clipboard reader was available. |
| MO-008 | **Slash pointer completion:** Click completes rather than executes by design; D14 Send resolves the pointer workflow. Optional affordance polish. |
| GAP-003 | **Workspace Refresh feedback:** Consider loading/updated feedback. Original unchanged-data observation was qualified; WRBN-NEW-01 fixes activation, not a promised feedback redesign. |
| CDD-S1 | **Duplicate command names:** Consider deduplicating plugin/native autocompact, stats, resume and thinking. Only clear was deduplicated in D18. |
| CDD-S2 | **Palette help alias search:** Make palette search discover ctg-help alias; descriptive handoff ID only, original report supplied no canonical ID. |

MO-005 had one early blank-rail right-click miss after a drag; later context-menu and integrated retests had no miss. Cause remains unisolated; no speculative fix is claimed.

## Validation

Coverage counts executions, not distinct controls: **732 rows = 576 passed + 103 defect-observed + 21 blocked + 32 excluded**. Of the passes, 573 are native single-modality; 10 blocked rows are historical and later closed, 11 current. The 103 original defect executions collapse to D01–D24, plus the separately discovered WRBN-NEW-01. Original audit: 681 rows; gap closure: 51. Fix-feature records: 181 rows (132 positive, 36 before-fix defect reproductions, 1 blocked, 10 excluded, 1 not applicable, 1 not reproduced live). Historical integrated v15 retest: 15/15, including a genuine authenticated pointer Send turn, model/palette/sidebar routes, resize/context/combining input, Voyages wheel and workspace Back. This is historical v15 evidence, not a claim that all 15 were rerun on v16.

Final mission outcome: **12/12 assertions passed, 28/28 features completed** at repair head. Assertion success means honest bounded audit/repair deliverables, not every original flow passed:

| Assertion | Accepted scope |
|---|---|
| VAL-NAV-001 | Reconciled first-launch and visible-control audit |
| VAL-NAV-002 | Independent mouse-only safe navigation audit |
| VAL-NAV-003 | Independent keyboard-only discovery, focus and cancellation audit |
| VAL-NAV-004 | Layout, input and bounded accessibility observations |
| VAL-NAV-005 | Projects, sessions and restart persistence audit |
| VAL-NAV-006 | Normal, cancel, error and cross-route recovery audit |
| VAL-LIVE-001 | Four-mode live work has traceable outcomes |
| VAL-LIVE-002 | Composer, models, tools and session recovery are exercised |
| VAL-LIVE-003 | Voyages is exhaustive within read-only boundaries |
| VAL-LIVE-004 | Account, usage, settings and help are inspected safely |
| VAL-REPORT-001 | Coverage and findings preserve failures and uncertainty |
| VAL-REPORT-002 | Confirmed bugs are repaired, retested and honestly reported |

Final VAL-REPORT-002 user testing recorded 34 genuine grim captures; scrutiny round 2 reused the current-head sequential gate. Close-last-real-tab before/after evidence was reviewed/reused, not rerun in the inherited multi-session authenticated profile. Fresh safe representatives were tested. Owned launcher/service/UI, compositor, foot and private tmux were stopped at final cleanup; no candidate is currently running.

Recorded gates (not rerun for this docs-only handoff):

- `npm run typecheck`: exit 0 at `105c25a` (legacy + native).
- Sequential services test at v16 changes and again accepted current head: lint/build passed (180 JavaScript files); Node **1171 total: 1166 passed, 0 failed, 5 skipped**; Python **28 OK**.
- v16 native candidate recipe: exit 0 on first attempt, five single-threaded typechecks, focused tests, two 10-iteration stress gates and build. Affected native suites: 240 passed/0 failed across 45 files; related tab/draft/footer suites: 385 passed/2 skipped/0 failed. Focused regressions: before 4 passed/2 failed; after 27 passed/0 failed.
- Earlier full native suites: v10 1620/1620; v11 1626/1626; v12 1629 of 1631 with zero failures. These are historical counts, not v16 full-suite counts.
- Original `TERM=dumb` gate remains recorded as **1145 passed / 1 failed / 5 skipped**: 4-bit colour collapses the legacy comet assertion, a test false positive. System Python lacked Pillow; its import failures remain historical failures, not silently relabelled passes.

Reproduce repository gates sequentially with installed dependencies and Python requirements:

```sh
npm ci
npm run typecheck
env -u NO_COLOR TERM=xterm-256color CARTHAGENT_NO_TRUECOLOR=0 CARTHAGENT_TRUECOLOR=1 \
  PYTHON=/path/to/python-with-game-requirements/bin/python3 sh -c \
  'npm run lint && npm run build && node --test --test-concurrency=1 tests/*.test.mjs && npm run test:python'
```

Install [game requirements](../../scenarios/game/requirements.txt) into that interpreter. Do not put `--test-concurrency` in `NODE_OPTIONS` (Node rejects it).

## Native runtime build

Authoritative input is the **cumulative** [development-v16 patch](../patches/opencode-v2.0.32-session-ui-development-v16.patch), SHA-256 `e02b2e5cd6fbfba4a0c526bb141bb491290c00061077a1e1c6c2ffc26d84da43`. Apply it directly to upstream, never stack v10–v15 or combined-v9 beneath it. Historical v10–v15 patches remain for traceability. [Runtime resolver](../../lib/opencode/runtime.mjs) accepts v16 as development only. Release hash, combined-v9 and [release manifest](../../lib/opencode/runtime-release.json) remain unchanged.

Pinned inputs: OpenCode `https://github.com/anomalyco/opencode` at `843a6c514e606b436a7fe713422ace0a93ad3d61`; `bun.lock` SHA-256 `9d78379cd264584a495440a217b9d2ecab524c9a56f7f8b4b5bed3926daa330d`; **Bun 1.4.2**. Install/verify that exact toolchain independently; do not copy auth/profile state. Node, Git, Bash and sha256sum/shasum are also required. The audited host was Linux ARM64 with one CPU and limited memory.

### Source preparation only

From this repository, with a newly cloned clean upstream checkout:

```sh
git clone https://github.com/anomalyco/opencode /path/to/opencode-source
git -C /path/to/opencode-source checkout 843a6c514e606b436a7fe713422ace0a93ad3d61
script/ctg/prepare-development-runtime.sh /path/to/opencode-source
(cd /path/to/opencode-source && /path/to/bun-1.4.2 install --frozen-lockfile)
```

[prepare-development-runtime.sh](../../script/ctg/prepare-development-runtime.sh) verifies source/hash/clean state and applies v16; it does **not** compile or publish. The [source preview guide](../source-preview.md) describes the separate source launcher. Do not run the pristine candidate recipe on this already-patched tree.

### Candidate build (separate pristine tree)

[build-owned-runtime.sh](../../script/ctg/build-owned-runtime.sh) still pins **combined-v9** and will not automatically select development-v16. Make a candidate-only copy in a separate pristine checkout of the exact upstream revision. Do not edit the tracked release recipe in this handoff branch.

1. Copy the v16 patch into the upstream tree at `docs/patches/opencode-v2.0.32-session-ui-development-v16.patch`, the recipe at `script/ctg/build-owned-runtime.sh`, and [run-native-test-stress.mjs](../../tools/run-native-test-stress.mjs) at `tools/run-native-test-stress.mjs`. These are the only permitted untracked build inputs (the original combined-v9 path may also remain allowed). Keep other files outside that tree until the pristine gate passes.
2. In the **copied** recipe, set `EXPECTED_PATCH` to the full v16 digest above; set `patch_file` to `$ROOT/docs/patches/opencode-v2.0.32-session-ui-development-v16.patch`; add that same relative path to `expected_inputs`. Preserve source, lock, toolchain, clean-state, host-target, manifest and checksum checks.
3. Apply the readiness recipe's five low-memory typecheck substitutions (often called the lowmem5 adaptation), replacing the five `bun run --cwd ... typecheck` lines exactly:

```sh
(cd packages/core && ../../node_modules/.bin/tsgo -b tsconfig.json tsconfig.tests.json --singleThreaded)
(cd packages/server && ../../node_modules/.bin/tsgo -b --singleThreaded)
(cd packages/plugin && ../../node_modules/.bin/tsgo --noEmit --singleThreaded)
(cd packages/client && ../../node_modules/.bin/tsgo --noEmit --singleThreaded)
(cd packages/tui && ../../node_modules/.bin/tsgo -b --singleThreaded)
```

Unmodified parallel typechecks stalled/thrashed on the audit host; `GOMAXPROCS=1 GOMEMLIMIT=1800MiB` alone did not solve it. Single-threading preserves the checks, not a waiver.

4. Match the audited v16 recipe's additional gates: after `test/util/renderer.test.ts`, add `bun test --cwd packages/tui --timeout 30000 test/util/combining-input.test.ts test/util/selection-keys.test.ts`. In the existing final `--timeout 60000` test command, add `test/feature-plugins/prompt-footer.test.tsx test/mouse-workflow-routes.test.tsx`. Keep all other original gates, including sidebar tests and both 10x navigation-rail/seascape stress gates. Do not suppress observed failures or weaken assertions.
5. Put Bun 1.4.2 first on PATH and run from that **pristine** upstream root:

```sh
PATH=/path/to/bun-1.4.2-bin:$PATH bash script/ctg/build-owned-runtime.sh opencode-linux-arm64
```

The recipe itself applies v16, installs the frozen lock, checks, compiles and writes `packages/cli/dist-ctg/` with the binary, LICENSE, SHA256SUMS and `ctg-runtime.json`. The target must match the host; this is not cross-platform proof. Preserve the whole output in a new candidate directory; never overwrite the published cache. Reject missing manifests or mismatched digests.

6. After a controlled exit and `node bin/ctg.mjs service stop` for the same explicitly isolated profile, launch from this checkout with `CTG_OWNED_OPENCODE_RUNTIME=/path/to/candidate node bin/ctg.mjs`. Preserve that profile's HOME/config/environment across restart without reading or copying credentials; no new auth is authorized by these instructions. Omitting the override selects the published runtime, which lacks the native repairs.

Historical local candidate: `/tmp/ctg-native-candidate/runtime/narrow-draft-v16`, Linux ARM64 binary SHA-256 `1c6716d500181c83619f832eef99b6bcdbc1fc08e55238420db39a7e7bb8619c`. It is **not on the branch**, not promised available elsewhere, unsigned and not bit-for-bit reproducible against release assets. A new build must record its own digest. Installed-package/platform validation and release packaging are future separately authorized work.

## Evidence locations and limitations

The two documents here are portable summaries; relative links point only to tracked source/docs/tests, not missing evidence. Optional local evidence root, available only in the original environment: `/home/factory-droid/projects/Carthagent/artifacts/beta7-launch-audit`. It is ignored and contains sensitive profile/runtime state: **never stage or upload that tree or the mission tree**. No raw evidence is necessary for this handoff.

Within that local root, historical references are `final/final-report.md`, `final/original-audit.md`, `final/findings.json`, `final/fix-retest-map.json`, `final/coverage.json`, `final/history/`, `final/integrated-retest/`, and `fixes/<feature>/report.md`. The v16 and identity follow-ups are `fixes/native-narrow-commands-draft-fallback/report.md` and `fixes/plugin-refresh-reconciliation-fix/report.md`; readiness is `fixes/candidate-native-runtime-preparation/report.md`. These are plain local references, not portable links or public attachments. Mission assertion records were inspected but are not copied. Without this environment, regenerate bounded evidence or request separately scrubbed necessary excerpts.

**LAY-004 correction:** the original helper mapped pointer input against a fixed 1440x1000 extent even at reduced output sizes. Scaled rechecks on original beta scrolled model/settings both ways at 60x20, 90x30 and 158x24. No product change: LAY-004 is harness-attributed. LAY-005 selection loss was independently reproduced keyboard-only and fixed by D21/v13. Other reduced-output pointer records from unscaled helpers are unreliable unless rechecked. Baseline-size pointer, keyboard, pixel/overlap and resize geometry observations are unaffected. WRBN-NEW-01 is the canonical separate pointer-action repair, not the Back repair that found it.

- Linux ARM64 only; software sway/foot/private tmux, virtual pointer and wtype keyboard; no other-platform/terminal/physical-input certification.
- PNG dimensions, OCR, ANSI and pane text support objective findings; no direct image perception or pixel-perfect aesthetic certification.
- Clipboard, IME/dead keys, live permission/question dialog and 111 off-screen Voyages items were not individually validated.
- Purchases, quotes, claims, quest submission, equip, customization saves, logout and new sign-in were excluded from bounded repair retests; publication was excluded from the audit and is separately authorized only for this handoff branch.
- Raw artifact/profile/runtime/mission trees are not portable and must not be published.
- Native candidate is unsigned, local and not bit-for-bit release-reproducible; release pins and combined-v9 unchanged.
- Historical auth failures, D10 live quest reload failures, test timing debt and unscaled pointer corrections remain explicit.

## Next-agent checklist

- Fetch/checkout `fix/beta7-tui-launch-audit`; verify baseline and repair head above, then review the docs-only handoff commit separately.
- Read the structured findings and README QA section; keep suggestions distinct from fixed bugs and unresolved evidence gaps. Do not reinterpret assertion passes as release approval.
- Review the complete linear history, preserving cumulative v10–v16 patches. Use v16 directly against pinned source for current native work; do not change release pins as a side effect.
- If implementation is newly authorized, reproduce only the selected issue with a fresh regression and real bounded UI retest. Prioritize decisions on historical auth, D10 live quest restoration and timing debt; do not initiate fresh auth or account-changing actions without approval.
- For UI work, choose report-only recommendations explicitly; preserve D06 self-review/independent-review separation and D20 permission policy. Do not silently expand the mission.
- Rebuild a local candidate using the recipe adaptation above; verify manifest/digests, isolated profile and active runtime. Use scaled pointer coordinates and truecolor/Python prerequisites for new evidence.
- Treat all raw artifact/profile/mission state as private and local. Share only separately reviewed sanitized excerpts if necessary; do not upload the tree.
- No PR, release, main update, force push or further publication is implied by this handoff. Future installed-package/platform/release gates require separate scope.
