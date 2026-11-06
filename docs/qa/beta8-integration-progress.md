# Beta.8 integration evidence (in progress)

This is development evidence, not release certification. The published beta.7
tag, assets, combined-v9 patch, and release resolver pins remain immutable.

## Integration

- Main base: `2a975faef5b4296c07008b7a47ccdf30bdb769c9`.
- Latest main through `3dc9818614` (#256, uncertain Cloud token-refresh recovery)
  was merged locally before final integration checks. Draft integration PR: #257.
- Audit branch imported through `2571cdb2ecdecc8705b779fdf55da175a2852ee2`.
- Runtime base: `843a6c514e606b436a7fe713422ace0a93ad3d61`.
- Development-v17 is cumulative: apply it directly to clean pinned upstream.
- Main's `carthagent-cloud` provider rename is carried through the native patch.

## Reproduced defects and repairs

1. **Cold-location OAuth startup:** holding plugin activation made the direct
   OAuth connect request return HTTP 500. Awaiting activation in the handler
   passed the startup and provider-discovery regressions (2 tests, 10 assertions).
   This supports, but does not establish, the historical AUTH-001 cause.
2. **Stale native plugin client:** a mounted context retained the old client after
   service replacement. The failing-before regression passes with a client getter;
   related native tests passed 8/8.
3. **Stale plugin RPC wrappers:** Quests, Voyages, DailySource, Workspace,
   SessionControls, PullRequests, Ship, and Archive retained the old RPC client.
   Each reproduced before changing operation-time client resolution. The expanded
   page/client retest passed 47/47; the complete plugin suite passed 84/84.
4. **Account-bound selection:** synthetic disconnect/reconnect tests reproduced
   selection loss in Quests and Shop. Same/changed/unknown/switched identity cases
   pass after preserving only identity-bound position through the offline branch.
   The native runtime emits `server.connected`, not `server.disconnected`; the
   synthetic two-event sequence alone is not evidence of the historical live bug.
5. **Explicit-server replacement:** reproduced in the real terminal. The launcher
   creates a new authenticated service at a new URL, while the mounted terminal
   retries the old URL indefinitely. A profile-scoped registration rediscovery
   repair passes an authenticated two-server regression (including wrong-password,
   changed-runtime, and missing-registration rejection). Client getters alone do
   not repair this path. CLI single-threaded typecheck passes after the repair.
6. **Cold plugin inventory:** holding activation reproduced an inventory response
   before registration completed. Waiting for activation in the plugin-list HTTP
   handler passes the startup regressions (2 tests, 6 assertions); server
   single-threaded typecheck passes. The final live replacement retest preserves
   quest 2 and keeps the Carthagent plugin loaded.

## Live evidence

The Linux x64 direct development binary was launched in a real Windows Terminal
window attached to a private tmux session, using the existing acceptance profile.
Screenshots are actual window captures; raw profile and runtime trees remain local.

- Authenticated Quests loaded, showing 35 coins and Friends marked WIP.
- Selected quest 2, then paused only the verified acceptance service for 55 seconds.
- Client logs recorded `Event stream stalled` followed by a new connected stream.
- Quest 2 remained highlighted after recovery without manual Refresh.
- Replacing the service changed its process, URL, and password; the terminal
  remained stuck on Connection lost. This is distinct from same-endpoint recovery.
- After endpoint rediscovery, the terminal reconnected automatically to the new
  authenticated service. However, its plugin inventory temporarily dropped from
  13 to 12 and returned to 13, remounting the page and losing quest 2's highlight.
  The endpoint repair alone therefore does **not** pass selection preservation.
- With the inventory activation wait added, another real replacement changed
  process, URL, and password. The same terminal run reconnected automatically,
  kept quest 2 highlighted, and retained all 13 plugins through reconciliation.
  Local capture sequence: `beta8-inventory-quest2-before` / `beta8-inventory-quest2-after`.
  These raw captures remain local; no account/profile/runtime tree was uploaded.
- Shop's Cropped preview also survived a real process/URL/password replacement;
  coins remained 35 and no Equip/Buy confirmation was activated. A separate rail
  defect remains: background refresh resets the left highlight to Quests while
  the Shop preview stays open (`voyages-navigation.tsx` calls `resetSelection()`
  for every non-ignored event). A regression reproduced this (25 passed, 1 failed);
  preserving static destinations on `server.connected` passes the complete plugin
  suite (85 passed). Identity/location invalidation continues to reset selection.
  Its live follow-up remains pending, so this is not full navigation acceptance.
- The screenshot host's local date and runtime UTC date differ; correlate captures
  by sequence and client run identifier rather than assuming identical dates.

## Completed gates before the endpoint rediscovery repair

| Gate | Result |
| --- | --- |
| Repository lint, build, sequential Node tests | 1,166 passed, 5 skipped |
| Full native TUI suite | 1,641 passed, 2 skipped |
| Full plugin suite | 84 passed |
| Python suite | 28 passed |
| Cumulative v17 clean application | Passed at intermediate digest `36fbe7ea4bba19053127bb5240eb644ad52de6002dd5dc6d3c0d6a25a1bb51dd` |

Before Quick's native label repair, the v17 digest was
`ed179239a80d436529f88ff6de1eb0503fb5d5d2581fd1b2be77cec97dce75e8`;
clean application was checked again against pinned HEAD using an isolated index.
The direct development executable digest is
`f00659a925a4c6cc0851fcc669394df4fb61e838cd50b5bb00f4a49241b9b2b6`.
It has not passed the pristine recipe or release acceptance.

After endpoint rediscovery, repository lint/build/sequential tests passed again
(1,166 passed, 5 skipped), as did the authenticated endpoint tests (3 tests,
16 assertions). The final patch-integrity test also passed after inventory repair.

Read-only ID comparison after reconnect testing found no missing projects,
sessions, or messages in either original profile. Acceptance profile counts
remain 7 projects / 3 sessions / 61 messages. The normal profile has concurrent
activity (messages grew from 282 to 328); it was not launched by this retest.
Stable account and remote profile comparison remains outstanding.

The first repository run failed because its integrity test still read v16; it now
reads the recipe-selected v17. Python initially failed because Pillow was absent;
the successful run supplied Pillow 11.3.0 from a temporary directory (wheel SHA-256
`cc3e831b563b3114baac7ec2ee86819eb03caa1a2cef0b481a5675b59c4fe23b`).

## Any-mode quests and Quick

- Quick is the displayed name of the direct-execution mode. The persisted `lite`
  ID remains compatible with saved sessions, native colors, and ordering.
- Live inspection caught ID-derived native labels still displaying Lite after the
  server rename. Native mode strip, picker, and agent-event labels now map the
  persisted ID to Quick. Native label/session-ownership tests passed 14/14.
- Current cumulative v17 digest:
  `dfadb7a4eb0a30160da5665f726e6a39b2dc280f926ef498f8bc17bf85af17d3`.
- Repository lint/build and sequential tests after any-mode quests passed:
  1,167 passed, 5 skipped.
- After merging latest main, lint/build and sequential tests passed again:
  1,174 passed, 5 skipped.
- DailySource can explicitly offer an owned session when no Ship report exists.
  Its stable reference binds to the session and source fingerprint; its summary,
  checks, and findings start empty. No transcript is imported or result invented.
- The quest picker accepts that session and collects selected change/check/review
  evidence. Opening a quest does not launch prompts or send anything. Details
  remains the default preview action; submission requires an explicit Submit.
- The separate verified-reward boundary still requires fresh Ship receipts.
- Focused source/parity tests: 72 passed. Full plugin suite: 90 passed, including
  Quick/change, Build/tests, and Plan/review composition through explicit Submit.
- Cancel and account-change during evidence entry revoke unfinished drafts without
  uploading. Python rerun passed 28 tests; final repository lint passed.
- Bundled-browser module execution, click, Unicode input, screenshot, and expected
  broken-module failure passed with local browser libraries supplied. The first
  run failed to launch because the host lacked libnspr4; that failure is retained.
- Latest read-only preservation comparison again found zero missing IDs. The
  acceptance profile remains 7 projects / 3 sessions / 61 messages; the concurrently
  used normal profile remains 5 / 3 / 328 compared with the original 5 / 3 / 282.
- Real-window pointer clicks opened Quests and a quest detail. The live picker
  offered non-Ship sessions, opened goal entry, and cancelled cleanly without a
  submission. Captures stay local. This used the preceding development binary;
  the final Quick binary and complete live rail-recovery retest remain pending.
- A pristine candidate build is being run with the separate development recipe.
  It has not yet passed; release pins remain on the published beta.7 recipe.
- The first candidate was stopped when live inspection exposed missing native
  Quick labels. The next candidate failed TUI typecheck on a test-only matcher
  overload in the reconnect regression. Identity assertions now use Object.is;
  TUI typecheck passes and a new pristine candidate run is in progress.
- That candidate passed typechecks and focused core/server/CLI/theme gates, then
  full TUI ended 1,641 passed / 2 skipped / 1 failed: the wrapped Markdown-link
  test indexed a missing rendered row after its roughly 500 ms parser wait.
  The isolated test passed. The fixture now waits on rendered content with a
  bounded 5-second deadline and explicit prerequisite assertion; all pointer
  behavior assertions remain. This is test-readiness repair, not a product fix.
- Focused Rename stress passed 42 repetitions, then failed on repetition 43 at
  plugin readiness, before the Rename interaction. Reconciliation took 9.655 s
  and the page still displayed Loading workspace at the 10 s readiness boundary.
  Another worktree's concurrent `npm run quality` was consuming substantial CPU.
  This is a failed run, not proof of either a Rename regression or its resolution.

## Pending-tab navigation repair

- The next pristine candidate ended at 1,641 passed / 2 skipped / 1 failed:
  the parked-draft first-send test could not cycle back to its newly created tab.
  Build and stress stages did not run. The original focused file then passed
  30/30 repeated tests, so an isolated pass did not establish resolution.
- Holding the real tab-layout file lock reproduced the navigation failure:
  after visiting a newly opened session, cycling away and back stayed on the
  original session because the new tab's asynchronous registration was pending.
- Pending route registrations now participate in tab cycling until their write
  settles. Closing a pending tab removes it from that cycle and retains the
  existing cancellation guard against a late write resurrecting it.
- The deterministic lock regression failed before the repair. The focused
  tab-context and draft-reachability suites passed 29 tests after the repair;
  ten repetitions then passed 290 tests / 710 assertions, including closing a
  pending tab without resurrection. A new pristine candidate run is underway.
- Cross-platform CI for pushed commit `45f40658f6` completed successfully. It
  does not cover this subsequent native repair or certify the candidate binary.
- Native repository `bun run check` passed: lint completed with warnings and all
  35 typecheck tasks succeeded (32 cached). Development-patch integrity checks
  also passed after regenerating the cumulative patch.

## Remaining acceptance

- The tab-fix pristine run failed: 1,634 passed / 2 skipped / 5 failed, with
  9 errors. Local logs showed requests for live acceptance-profile sessions and
  Voyages pages reaching temporary test servers. The old disconnected acceptance
  terminal was still running; it has now been closed. Raw logs remain private.
- Investigation found that failed managed endpoint validation still fell through
  to another event-stream connection on the old URL. A regression reproduced
  this stale-endpoint retry deterministically. The loop now retries resolution
  until a validated replacement is returned, rather than using the old endpoint.
  This is a product repair; closing the stale terminal alone is not the fix.
- Connection-suite verification passed 70 repeated tests / 150 assertions after
  the failing-before regression. The pristine recipe now includes that suite.
- The subsequent canonical native `bun run check` failed after 32 of 35 tasks:
  the SDK compiler exited on SIGKILL without a TypeScript diagnostic. The host
  also recorded an out-of-memory `tsgo` kill. A bounded rerun using
  `GOMAXPROCS=2 GOMEMLIMIT=512MiB` also failed with SDK SIGKILL. Inspection found
  Turbo's strict environment allowlist excluded those limits. Lint completed;
  the corrected rerun used `--concurrency=1 --env-mode=loose` and verified both
  compiler limits reached child processes. All 35 typecheck tasks passed with
  zero cache hits (13m09s). The earlier failed runs remain part of the evidence.
- The validated-endpoint pristine run passed 1,642 TUI tests / 2 skipped and
  failed one obsolete useEvent test that explicitly expected the removed stale
  transport fallback. Stress/build did not run. The test now holds replacement
  resolution pending, asserts reconnecting status without another transport
  attempt, then verifies delivery through the validated replacement. Its first
  revision incorrectly expected a transport-history entry during resolution;
  that assertion failed and was corrected to match the transport-only history.
  The corrected useEvent suite passed 80 repeated tests / 160 assertions;
  development-patch integrity checks passed. The fresh pristine recipe passed:
  1,643 TUI tests / 2 skipped / zero failures, ten navigation stress repetitions
  (150 tests), ten seascape-render repetitions (30 tests), focused core/server/
  CLI/client/theme gates, and the Linux x64 binary build. Final-binary native
  probes and signed-in live acceptance are underway.
- Cross-platform CI passed through `8f62ed51ad`; the test-contract follow-up and
  fresh pristine candidate are still pending.
- A fresh read-only comparison before final-candidate live testing again found
  zero missing project, session, or message IDs in both original profiles:
  acceptance 7 / 3 / 61; normal 5 / 3 / 328 versus original 5 / 3 / 282.
  This verifies local record preservation, not stable remote account state.
- Final Linux x64 candidate native host/model/product/quest/control/outcome/
  runtime/review/report/task/delivery/slash probes passed. PTY initially rejected
  the developer selector before running; rerunning with the manifest-pinned
  artifact selector passed its seven command checks.
- Real-window pointer testing on that binary confirmed Quick, any-mode session
  selection and goal-entry cancellation, and the signed-in 35-coin wallet.
  Process/URL/password replacement retained Cropped preview and wallet, but the
  rail still reset Shop to Quests: this final-binary live test failed.
- Capturing event types showed cold activation emits `integration.updated` and
  `provider.updated` after `server.connected`. Reproducing that delayed sequence
  failed the rail regression (26 passed / 1 failed). Static destinations now
  survive these inventory refreshes; summaries still clear, and credential/
  location invalidation still resets selection. Verification passed 270 repeated
  renderer tests / 1,190 assertions and repository lint/typechecks. Full plugin
  verification passed 91 tests / 1,634 assertions. The real-window replacement
  retest then retained both Shop highlight and Cropped preview at 35 coins after
  PID/URL/password changed, without Equip/Buy activation. Resizing the desktop
  terminal and matching tmux to 100x25 also passed actual-pointer Quests and
  second-quest detail navigation.
- Read-only authenticated snapshots across another verified service replacement
  matched the non-secret account binding, complete remote profile, and catalog/
  inventory exactly; wallet remained 35 coins. Snapshot bodies stayed private.
- After the final rail repair, repository build and the complete sequential Node
  suite passed again: 1,174 passed / 5 skipped / zero failures. The raw slash
  probe report was moved outside the repository and is not part of published
  evidence. Latest CI confirmation remains pending before merge.

- Final-candidate rail-highlight recovery and scaled pointer navigation passed
  as recorded above. Release-artifact/default-resolver acceptance remains pending.
- Navigation stress passed 38 complete repetitions (570 tests), then repetition
  39 failed at plugin readiness and exceeded the external 90-second deadline.
  Logs show reconciliation taking 13.4 seconds. This does not reproduce the
  historical Rename click failure; both readiness and Rename timing debt remain
  unresolved. The run overlapped other local gates/builds.
- AUTH-002 remains unreproduced; AUTH-001 has no matched historical live reproducer.
- Local/remote preservation, the pristine Linux candidate, and native probes
  passed as recorded above. Five-platform release builds and installed/default-
  resolver acceptance remain pending.
- No beta.8 release or npm publication is authorized by these test results alone.
