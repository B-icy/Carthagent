# Native migration PR disposition — November 17, 2026

Reviewed all 26 remaining open CLI PRs against `faef8d5` on main. Review included
PR descriptions, file lists, unmatched commits, added-line comparison against
current files, and inspection of current implementations/tests. A different
commit hash or patch ID alone does not mean useful work is missing. Conversely,
these closures do not assert that each old branch was merged unchanged.

No old runtime manifest, release version, host patch or fixture process runner
is promoted. The current native launcher, owned runtime and CI remain authoritative.
Original PR discussions and local recovery bundles retain the historical proposals.

## Dispositions

| PR | Decision | Current evidence / reason |
| --- | --- | --- |
| [#254](https://github.com/B-icy/Carthagent/pull/254) | Finish as bounded documentation follow-up | Correct beta.7's stale publication checkpoint in `docs/native-e2e-acceptance-2026-11-04.md`. GitHub release and successful workflow conclusions rechecked. Attribute unavailable local authenticated-profile evidence to the original PR rather than presenting it as freshly verified. |
| [#237](https://github.com/B-icy/Carthagent/pull/237) | Finish as bounded documentation follow-up | Correct beta.1's historical publication state in `docs/beta-rewards-e2e-results.md`; preserve the original report by reference. Do not treat its old delivery-reward acceptance as current daily-goal/harbour acceptance. |
| [#220](https://github.com/B-icy/Carthagent/pull/220) | Close superseded | `lib/update-channel.mjs`, `lib/opencode/update.mjs` and `tests/update-channels.test.mjs` implement channels, stable prerelease exclusion, channel-isolated cache and no persistence on failed/check-only updates. Restoring the old launcher and 1.0.7 package version would regress current native routing. |
| [#214](https://github.com/B-icy/Carthagent/pull/214) | Close superseded | `test:native-slash-commands` and both runner files exist. Current slash probe uses observed stats/token counts and corrected guide-toggle dispatch; the old branch's failed experiments and partial proof remain historical, not pending implementation. |
| [#213](https://github.com/B-icy/Carthagent/pull/213) | Close superseded | `bin/ctg.mjs` already routes through `runOpenCodeCli` and `createOpenCodeCliRuntime`; no Pi fallback. Current CLI tests and default CLI acceptance supersede the former mock-error route fixtures. |
| [#212](https://github.com/B-icy/Carthagent/pull/212) | Close integrated | The unmatched commit's added lines are present on main: `tools/native-plugin-readiness.mjs`, its tests, and delivery-host integration. Focused tests rerun. |
| [#211](https://github.com/B-icy/Carthagent/pull/211) | Close integrated/superseded | Session-preference helper/tests and clear host-command dispatch exist. Remaining differences are descriptions/comments; do not restore older command registration over newer collision handling. |
| [#210](https://github.com/B-icy/Carthagent/pull/210) | Discard obsolete release candidate | Draft 1.1.0 manifest pins an early combined-v2 runtime. Current release record and published versions supersede it. No version downgrade, tag rewrite, rebuild or publication warranted. |
| [#209](https://github.com/B-icy/Carthagent/pull/209) | Close integrated/hardened | Current public-repository probe requires explicit `CTG_NATIVE_EXIT_STATUS`, uses `assertNativeShellResult`, correlates tool results and records validator hash. Old regex-only lines have stronger replacements; validator tests pass. |
| [#208](https://github.com/B-icy/Carthagent/pull/208) | Close superseded | Cloud/archive clients, native resume tests and cancellable `runOfflineDemo` exist. Current Cloud terminology and account flow replace old Ship/experiential names; demo cancellation tests pass. |
| [#207](https://github.com/B-icy/Carthagent/pull/207) | Discard obsolete workaround | Current `native-pty-smoke.py` has explicit opt-in completion dismissal plus separate natural submission. Do not force Escape for every initial command: that would weaken proof of natural slash dispatch. |
| [#206](https://github.com/B-icy/Carthagent/pull/206) | Finish useful narrow fix; discard experimental remainder | Picker-only was still incorrectly classified as focused and skipped picker startup. Remove that classification and test the actual open-phase AST for picker/full/focused/layout modes. Also prevent paste/resize unless cancellation passed. Preserve current duplex I/O and synchronized-frame handling. Do not reintroduce candidate-only seeded-selection runner, hard-coded old composer labels, repeated Enter experiments or old timing/clipboard claims. |
| [#204](https://github.com/B-icy/Carthagent/pull/204) | Superseded by narrow current fix | Keep the useful requirement that picker acceptance must pass before prompt entry (finished here). Reject speculative empty-Enter session creation and older screen labels; current coherent snapshot/duplex implementation remains intact. No new full mouse/clipboard acceptance claimed. |
| [#201](https://github.com/B-icy/Carthagent/pull/201) | Close integrated/hardened | `nativePtySmokeArgs` requires a lowercase independently verified digest; `test-native-pty.mjs` rehashes selected bytes; Python preflight and portable skip tests exist and pass. |
| [#200](https://github.com/B-icy/Carthagent/pull/200) | Close superseded | Current review consumer adds exact inbox-admission ordering, `ctg.reviewKickoff`, cancellation/disposal and loop guards beyond this branch. Current review-consumer tests pass. |
| [#199](https://github.com/B-icy/Carthagent/pull/199) | Close integrated/hardened | Digest enforcement is present for both owned/upstream selections via #201's stronger helper, with pre-execution mismatch regressions. Old optional-digest logic is not needed. |
| [#195](https://github.com/B-icy/Carthagent/pull/195) | Close integrated/superseded | Installed runtime contract, glyph helper import and clear proof exist. Current clear probe uses canonical durable snapshots and distinct follow-up assistant markers/positive controls, stronger than the earlier repeated marker assertions. |
| [#192](https://github.com/B-icy/Carthagent/pull/192) | Discard obsolete parallel UI approach | Current model-command adapter delegates native picker selection; `/thinking` uses host variant API, and theme configuration reload/provisioning is the current path. Do not add a second variant picker/theme preview subsystem or restore old PTY labels/candidate assumptions. |
| [#188](https://github.com/B-icy/Carthagent/pull/188) | Close superseded | Current Cloud/archive/resume bridges, executable offline demo and shared updater implement the useful contracts. Old scripted-demo screens, Ship wording, transient checkout implementation and theme restart messages are obsolete. |
| [#186](https://github.com/B-icy/Carthagent/pull/186) | Close integrated/hardened | Environment allowlist and canonical conversation logic were extracted to dedicated helpers. Current clear probe retains an uncleared same-length control, post-clear response and durable-message checks. Do not move those helpers back inline. |
| [#182](https://github.com/B-icy/Carthagent/pull/182) | Close superseded | Host controls probe/observer and installed contracts exist with manifest-based identity. Reject hard-coded October executable hash and older attribution/clear assertions; these are not current-runtime evidence. |
| [#169](https://github.com/B-icy/Carthagent/pull/169) | Discard obsolete launcher/test alternative | Native default already ships. This branch also carries an old bespoke subprocess/service fixture and raw ambient-environment setup; current CLI/runtime/review suites replace it. No need to resurrect it solely for branch parity. |
| [#166](https://github.com/B-icy/Carthagent/pull/166) | Close superseded | Owned runtime acquisition, release manifest, draft acceptance and publication workflows now ship. The branch's opt-in-only architecture, obsolete patch pins and early publishing approaches must not replace current trust roots/workflows. |
| [#157](https://github.com/B-icy/Carthagent/pull/157) | Close superseded | Current performance docs explicitly withdraw invalid character-echo numbers and retain loaded-host failures/quiet-window restrictions. Current parsed-cell measurement and manifest/identity guards are stronger. Do not restore historical performance figures or treat unrun memory proposals as accepted gates. No benchmark run authorized/performed here. |
| [#152](https://github.com/B-icy/Carthagent/pull/152) | Close superseded | Current native workspace, Cloud/archive/update bridges and dedicated model adapter replace this composition. Old theme/model implementations overlap #192 and old literal host versions/palette experiments are not shipping requirements. |
| [#140](https://github.com/B-icy/Carthagent/pull/140) | Close superseded | Current CLI/runtime/service/session-control modules implement the native adapter, isolation, budgets and review. Reject the early unsupported-glyph error, old provider naming and bootstrap variants; current native CLI tests cover the evolved contracts. |

## Validation and limits

The new runtime-test change is in the Python acceptance harness only, not the
product TUI. Behavioral regressions execute its actual predicates/open phase;
no screenshot or live clipboard/title certification is inferred from them.
The existing Python transport and coherent-screen tests remain intact.

Publication workflow conclusions for beta.1 (41406021097, 41413154402) and
beta.7 (41805902929, 41806815554) were fetched through GitHub and were successful.
Old local account evidence was not rerun or copied into the repository.

This review does not certify old performance thresholds, every historical test
proposal, or all production journeys. It makes a disposition for each branch,
retains a small current-code correction, and avoids reverting newer functionality.
