# Simplified Voyages — native UX acceptance, November 3, 2026

## Result

The development implementation passes the automated quality gate and the tested
native quest, customization, purchase-cancellation and restart workflows. Two
real daily quests completed through the Windows Terminal UI. This is development
acceptance, not a published-release certification or completion of every item in
the wider repair checklist. Remaining gaps are listed below.

The original development report preceded the commits on `feat/simple-voyages-quests`.
Beta.6 release preparation is tracked in PR #251. Published beta.5 and its immutable
runtime pins remain separate until candidate artifacts pass release acceptance.

### Release-candidate corrections

The first five-platform prebuild exposed stale test expectations for the simplified
folder picker: the removed `In` prefix and Windows paths displayed with forward
slashes. Only those runtime test assertions changed; the accepted runtime UI source
is unchanged. The corrected combined/development v8 patch SHA-256 is
`506b994ca9399e2b636dbbacd29de2dd82e4e9dbda1fed7162d824d8fa0e892e`.
The full local sidebar suite passed 64 tests and 404 assertions after correction.

Package CI also exposed a missing published dependency for the artwork renderer.
The root package now declares `@resvg/resvg-js`, and installed-package acceptance
renders a small SVG to verify the installed native binding. The help PTY probe now
checks the searchable dialog's current marker instead of the removed alias text.

### Verified beta.6 candidate

Five native targets passed prebuild run `41756279114` from source commit
`ea9986417247abb8993f5e897f324a6e45c38462`: Linux x64/arm64, macOS x64/arm64,
and Windows x64. All five archive checksums and provenance were verified locally.
Regenerating the manifest through the production archive validator reproduced the
workflow candidate byte-for-byte. The beta.6 package version, runtime manifest,
and published patch pin are promoted together from those verified outputs.
Final draft/default-resolver and authenticated upgrade acceptance remain release gates.

## Environment and evidence

The identity and matrix below describe the initial acceptance build. The later
sidebar-color refinement has its own identity and screenshots in the addendum.

- Actual Windows Terminal window, Ubuntu WSL, isolated tmux server `ctg-ux`.
- Native window screenshots include the title bar; no browser renderer or
  reconstructed terminal images were used. Each committed screenshot has a
  paired viewport `.txt` file.
- Exact viewport sizes: 110×36 (1379×908 window), 80×24 (1019×632),
  60×20 (779×540). The final row is blank by layout.
- Dedicated acceptance profile and workspace under
  `~/.local/share/carthagent-acceptance/`; the authenticated backup was retained.
- Runtime source: `843a6c514e606b436a7fe713422ace0a93ad3d61`.
- Development patch SHA-256:
  `bbb58380354bb062c2212da472fcd1f32110cd27b51ee66dde133f0c2f1534f2`.
- Linux executable SHA-256:
  `a4195633087aa5cfa5325e6c5b9282ebe11134ffbd6860242f00716bc9083d37`.
- Runtime `0.0.0-ctg.2.0.32`, Bun 1.4.2, OpenTUI 0.5.17.
- Lock SHA-256:
  `9d78379cd264584a495440a217b9d2ecab524c9a56f7f8b4b5bed3926daa330d`.
- Development patch applied to a clean checkout and reproduced byte-for-byte,
  including added files. Native fixture runs used a separately pinned local
  development manifest and verified executable identity before execution.

## Implemented experience

- `/quests` opens quest cards (`/voyages` now opens the Voyages hub; see VOY-02, 2026-11-14) with concrete conditions, selected
  recorded work, one explicit **Submit**, and clear processing/result states.
- Evidence text, rubric, IDs, retention, editing and recovery are in **Details**.
- Local **recorded** markers never claim semantic acceptance. Completion comes
  from the server. Daily quests award no coins or XP.
- Polling preserves the current quest and selection. Temporary read failures
  retain drafts; account/connection invalidation clears them. Page reopen restores
  drafts within the process after matching-account reads. Application exit does
  not preserve unsent drafts.
- Unknown sends retain stable IDs and exact requests for explicit recovery;
  reads do not replay writes. Known accepted requests discard local raw payloads.
- Native Enter dispatches the selected list/detail action. Priority-30 page
  bindings resolve the host Escape conflict. Completion leads with Back to quests.
- Profile/shop renders bundled Voyages artwork in terminal cells, composited
  onto the theme background. Unsupported artwork shows an update message.
- Customization/equip/buy mutations have explicit confirmation. Unaffordable
  previews explain the shortfall and omit Buy; already-equipped items omit Equip.
- Runtime patch adds actual folder creation, readable compact navigation,
  consistent group terminology, brighter muted text, searchable help and the
  Carthagent product-version footer.

## Live outcomes

| Check | Observed result |
| --- | --- |
| Behavior-change quest | Submission `e075d566-8789-4143-b18d-31190e14647a`: graded / assessed_complete, one attempt |
| Regression, initial evidence | `0fbb2895-8d61-4b30-a0ae-74a337c06b7d`: needs_evidence, one attempt; focus 0.84, outcome 0.98, regression 0.88 |
| Regression, explicitly revised evidence | `307464a7-2668-4133-8c98-13365e915060`: assessed_complete, one attempt; focus 0.97, outcome 0.98, regression 0.97 |
| Earlier unknown submission | `b7ef4097-38e8-4364-83b6-badc141d33b5` recovered using the same ID; assessed once as needs_evidence |
| Independent utility tests | `percentage.test.mjs` and `label.test.mjs`: 10/10 passing |
| Page leave/reopen | Selected regression work and Submit restored (original captures 99–101) |
| Application restart | Both completed quests remained complete; regression reopened successfully |
| Accepted-payload cleanup | Both successful submission records retain IDs and have `request: null` |
| Folder creation | UI-created `native-folder-acceptance` independently verified as an empty directory |
| Customization | Saved deep skin; canceled warm-skin preview retained deep; free braids equipped after testing cancellation |
| Reward | Explicit backend-assisted claim of the real verified Unicode delivery awarded 25 coins / 100 XP / 1 km once; `replayed: false` |
| Purchase cancellation | Native Sandals quote: 30 coins, balance after purchase 5; Escape canceled. Independent snapshot: 35 coins, version 5, identical inventory/configuration, no pending purchase |

The reward was a separate verified **Ship delivery** reward, not a daily-quest
reward. Reward ID: `869e422e-2d0b-4498-8f80-b1003840537f`. No paid item was bought.

The regression task had an initial syntax-error run, then a real assertion failure
on UTF-16 slicing (`'\ud83d…' !== '😀…'`), then five passing tests after code-point
slicing. The initial source projection only included a failed flag and passing
output. The selected change summary was edited through the UI to explain this
sequence truthfully, then explicitly resubmitted. This does not turn the setup
failure into regression proof. Missing-evidence guidance now asks for the actual
assertion/expected/actual result and points to the change-summary editor.

## Curated screenshots

Files are in [`native-ux-acceptance-2026-11-03/`](native-ux-acceptance-2026-11-03/).

| View | 110×36 | 80×24 | 60×20 |
| --- | --- | --- | --- |
| Quest list | [138](native-ux-acceptance-2026-11-03/138-final-quests-110x36.png) | [134](native-ux-acceptance-2026-11-03/134-quests-80x24.png) | [131, after restart](native-ux-acceptance-2026-11-03/131-restart-quests-60x20.png) |
| Open quest | [139](native-ux-acceptance-2026-11-03/139-open-quest-110x36.png) | [135](native-ux-acceptance-2026-11-03/135-open-quest-80x24.png) | Original capture 95; scrollable summary and pinned actions |
| Completion | [116](native-ux-acceptance-2026-11-03/116-final-regression-complete-110x36.png) | [133](native-ux-acceptance-2026-11-03/133-completion-80x24.png) | [132, after restart](native-ux-acceptance-2026-11-03/132-restart-completion-60x20.png) |
| Profile | [137](native-ux-acceptance-2026-11-03/137-profile-110x36.png) | [136](native-ux-acceptance-2026-11-03/136-profile-80x24.png) | [118, before reward](native-ux-acceptance-2026-11-03/118-profile-60x20.png) |

Purchase: [confirmation at 60×20](native-ux-acceptance-2026-11-03/129-purchase-confirm-60x20.png),
[after cancellation](native-ux-acceptance-2026-11-03/130-purchase-cancelled-60x20.png).

The full local capture archive remains at
`~/.local/share/carthagent-acceptance/beta5-ux-review/native/`. Captures 85, 88,
96, 104, 109, 115, 117, 123 and 127 are intermediate or inaccurately named.
Judge them by their contents; they are not final acceptance evidence for the
views named in their filenames. Capture 115 is a quest list and 117 is completion.

## Automated checks

- Final `npm run quality`, including the regression-guidance change:
  **1,144 passed, 5 skipped, 0 failed**, plus lint/build/typechecks.
  Log: `/tmp/opencode/ctg-ux-quality-final-guidance.log`.
- Real OpenTUI quest/navigation/shop renderer tests: **21 passed, 140 assertions**
  at the three target sizes.
- Native product fixture: entrypoint, workspace, archive, controls,
  event invalidation, reconnect snapshot and reconnect events passed.
- Native Ship walkthrough: strict approval, failed-check repair, review,
  verified finish, service restart/resume and Lite switch passed.
- Native daily boundary: registration, six authentication failures, actual
  source output schema and stale projection passed. This fixture made zero
  cloud submissions or provider requests; live results above are separate.
- `git diff --check` passed before documentation finalization.

Fixture logs are `/tmp/opencode/ctg-ux-{product,ship,daily}-final.log`.

## Remaining gaps and limitations

1. The original `request_failed` transport cause is unknown. Recovery is proven;
   a specific network diagnosis and new safe transport instrumentation are not.
2. The source picker only exposes the exact active report per session. Historical
   completed-run browsing is not implemented.
3. Baseline projection lacks original failure output. The first failed check can
   be setup-related; truthful summary editing remains necessary in that case.
4. Oversized-evidence whole-record budgeting and notices pass automated checks;
   a live oversized-evidence native submission was not exercised.
5. Same-ID recovery has live evidence and durable-journal tests, and completed
   results survive native app restart. A new forced mid-upload app termination
   was not injected in this final pass.
6. At 60×20, long catalog names can truncate in the list and longer summaries
   require scrolling. Item detail shows the selected item's price and shortfall.
7. The original lost profile remains unrecovered; replacement profile backups
   are preserved. Existing-project migration and the whole earlier 44-item list
   are not recertified by this report.
8. This pass did not publish, change billing prices, or test payment completion.
   Explicit continuation after payment remains a separate existing requirement.

Release readiness still requires reviewing these gaps and the complete runtime
patch, then deliberately committing, packaging and publishing the accepted work.

## Sidebar color refinement

Following visual feedback, persistent navigation now uses its own semantic
`background.navigation` token. Carthagent sets it to charcoal-plum `#15121d`;
message cards retain the lighter raised-surface purple. The current session's
warm indicator remains visible. Both the Projects rail and session sidebar use
the navigation token. Older/custom themes without the token fall back to their
existing raised-surface color; light and dark fallback checks passed.
Pixel sampling of the native chat capture confirmed sidebar `#15121d`, chat
canvas `#1d1430`, and message card `#2a1f3e`.

Native captures from the rebuilt runtime:

- [Chat and sidebar, 110×36](native-ux-acceptance-2026-11-03/141-sidebar-chat-110x36.png)
- [Compact chat and sidebar, 80×24](native-ux-acceptance-2026-11-03/142-sidebar-chat-80x24.png)
- [Home, 110×36](native-ux-acceptance-2026-11-03/140-sidebar-color-home.png)

Updated development patch SHA-256:
`3da3b74636f1f52c3903b1b6d6a43c047f2c291ac0c5d752b4d790ea5fb52035`.
Updated executable SHA-256:
`a33cfe2fcb8f989bc43e5df83d679c5804b4e7f1b3aadfe11bb4a65302f1183d`.
Source/lock/runtime versions are unchanged. The patch again applied to a clean
checkout and reproduced byte-for-byte. Two compact-rail tests still assumed the
old five-cell width; their viewport and mouse assertions now use the shared
11-cell compact-width constant. This final patch differs from the compiled
source only by those test corrections.

Theme checks: 3 passed / 11 assertions. Runtime TUI typecheck passed. Runtime
navigation/sidebar run: 75 passed, two stale-width failures; the two affected
files then passed all 5 tests / 30 assertions after correction. Logs:
`/tmp/opencode/ctg-sidebar-theme-{typecheck,tests,retest}.log`.

The final `npm run quality` after the sidebar refinement passed: 1,144 tests
passed, 5 skipped, zero failures. Log: `/tmp/opencode/ctg-sidebar-quality.log`.

## Simplification and Friends WIP follow-up (November 3–4)

- Active quests exclude server-completed quests. `Completed (N)` / `c` opens the
  completed subset of the current slate. Completion details remain visible until
  the user leaves; the empty active board says `All quests complete`.
- Quest details lead with the goal, `What counts`, selected work, and the primary
  action. Diagnostics remain in Details. The action list fits its contents.
- Voyages navigation shows coins, Quests, Shop, Character, and Coding. Individual
  quest rows, profile biography, and routine refresh instructions were removed.
  Compact navigation uses `Captain` to avoid truncating `Character`.
- Friends is a disabled `Friends · WIP` destination (two lines in compact mode).
  It has no route, mutation, or keyboard-selectable action. Native clicking kept
  the quest page open. Friends implementation is future work.
- Projects shows the folder name with its full path available on hover/click,
  Browse/New session, Search/More, and sessions. Idle Ready/Current session text,
  repeated model text, and permanent shortcut instructions were removed.
  Working/approval/error/unread statuses remain. Empty groups are hidden by
  default and accessible through More → Show empty groups; no groups are erased.

Native verification used the preserved authenticated profile (35 coins). Before
the UTC reset, the active board showed only the unfinished review quest and
Completed (2) showed both previously accepted quests. Opening a completion and
returning worked. After reset/reopening, the new slate appeared. No new grading
submission or purchase was performed in this follow-up.

Screenshots:

- [Active board and simplified Voyages sidebar](native-ux-acceptance-2026-11-03/146-simple-active-quests.png)
- [Completed quests](native-ux-acceptance-2026-11-03/147-simple-completed-quests.png)
- [Completion detail](native-ux-acceptance-2026-11-03/149-simple-completion-detail.png)
- [Compact Voyages navigation](native-ux-acceptance-2026-11-03/154-simple-voyages-compact.png)
- [New slate, 80×24](native-ux-acceptance-2026-11-03/155-simple-quests-80x24.png)
- [Quest board, 60×20](native-ux-acceptance-2026-11-03/156-simple-quests-60x20.png)
- [Quest detail, 60×20](native-ux-acceptance-2026-11-03/157-simple-detail-60x20.png)
- [Shop](native-ux-acceptance-2026-11-03/158-simple-shop.png)
- [Simplified Projects sidebar](native-ux-acceptance-2026-11-03/159-simple-chat-projects.png)

Validation: plugin renderer tests 23 passed / 166 assertions; runtime navigation
and hierarchy retest 22 passed / 112 assertions; runtime TUI typecheck passed.
The broader runtime run had 71 passes and six stale-layout assertions before
the two affected files were corrected and retested. Final `npm run quality`:
1,144 passed, 5 skipped, zero failures. The first quality run overlapped patch
regeneration and caught the changing development hash; the final run used the
consistent pins. Logs: `/tmp/opencode/ctg-simplify-{plugin-verified,runtime2,typecheck2,quality-final}.log`.

Development patch SHA-256:
`e57dd66e28645748e608dbf2929db256d77896cad06b584209dd52396d880d08`.
Executable (`dist-ux-simple`) SHA-256:
`c31521e7c652c7c5cbdb1549d9060ea514a28823a2319d523923fa15bf5eb7f5`.
Patch application to clean pinned source reproduced byte-for-byte. These changes
are local development work, not a new published release.

## Folder picker and button affordances follow-up

**Superseded styling:** the bracket-button pass documented below was reverted
at the user's request. Ship/Lite/Plan/Build again use their original colored-pill
appearance; sidebar, quest, shop and dialog controls use their pre-bracket
styling. The folder-picker cleanup remains. The restored runtime patch matches
the pre-button bytes exactly:
`3fa9c71b87209ab12729c44f2dea5ca21b08ce18cea447d1c1c8169fe0b4838b`.
The development launcher now selects `dist-ux-folder-final` again. Screenshots
of bracketed controls below are historical, not the current design.

The folder picker now shows one location line and one field at a time. Search is
the default; Path and New folder open dedicated editing modes. Escape cancels
editing before closing the picker. The selected folder has a visible `›` marker;
the footer distinguishes opening a child from explicitly selecting the current
folder. Short lists no longer leave a large empty list area.

Shared dialog headers/footers and folder controls now use compact `[button]`
boundaries, semantic action backgrounds, hover feedback, and disabled styling.
Primary dialog actions are bold. The same visible boundaries cover Projects/
Voyages tabs, Browse/New session/Search/More, compact rail controls, coding-mode
switches, quest actions, and shop actions. Friends stays a disabled WIP label.
Compact Voyages labels are Quest, Shop, You, and Code to preserve complete
boundaries within the narrow rail.

Native terminal checks covered folder search, path entry, Back, Up, cancelling
creation, creating `workspace/picker-layout-review`, and explicit selection.
The selected folder returned to the workspace afterward. Existing sessions and
the signed-in profile remained available; the shop displayed 35 coins. Button
and folder layouts were inspected at 110×36, 80×24, and 60×20. The server restart
closed the original terminal; a new actual Windows Terminal window was opened
for the button checks. No simulated terminal screenshots are used.

Evidence:
- [Folder picker with button boundaries](native-ux-acceptance-2026-11-03/190-buttons-folder-final.png)
- [Compact folder controls](native-ux-acceptance-2026-11-03/180-buttons-folder-compact.png)
- [Creating a folder](native-ux-acceptance-2026-11-03/175-folder-create-final.png)
- [Created folder](native-ux-acceptance-2026-11-03/176-folder-created.png)
- [Explicit folder selection](native-ux-acceptance-2026-11-03/191-folder-selection.png)
- [Quest navigation and buttons](native-ux-acceptance-2026-11-03/186-buttons-quests-final.png)
- [Compact quest board](native-ux-acceptance-2026-11-03/187-buttons-quests-60x20.png)
- [Compact quest actions](native-ux-acceptance-2026-11-03/188-buttons-quest-detail.png)
- [Shop actions](native-ux-acceptance-2026-11-03/189-buttons-shop.png)

Checks: `npm run quality` 1,144 passed / 5 skipped / zero failures. Runtime
`bun run check` completed successfully (35 typecheck tasks; lint warnings remain
in the broader checkout). Plugin renderer suite: 23 passed / 166 assertions,
followed by a passing navigation retest for the shorter compact labels. Runtime
folder, caller, navigation, hierarchy and shared dialog tests: 66 passed plus one
old glyph assertion, corrected and retested (hierarchy: 8 passed). Compact rail
tests also passed after updating their glyph expectations (2 tests / 21 assertions).
The standalone folder renderer suite passed 7 tests / 42 assertions before the
button pass. Logs are `/tmp/opencode/ctg-buttons-*.log`.

Final development patch SHA-256:
`0ed03f4a94ce40f170f146d2695e1aea0670d358edacc95af7a69a7d474c74f9`.
Final executable (`dist-ux-buttons-final`) SHA-256:
`ee26e1610ed8b332fe3fd4c7d85181497c9bb77049edfad357b34b1148b1efdc`.
The patch applies to the pinned upstream tree and reproduces byte-for-byte using
an isolated Git index. Published release pins are unchanged. Still local/unreleased.
