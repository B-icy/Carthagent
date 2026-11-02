# Launch-readiness live checks

These checks use the user's existing preview.13 profile and real account. The active installation has a labeled local patch; this is not a new published release.

## Fixed from real testing

| Finding | Repair | Evidence |
| --- | --- | --- |
| Review rejected a Next.js app below its Git root | Canonical containment, workspace-relative diff, explicit untracked scope, disabled cross-boundary rename detection | Same nested-workspace regression fails on released code and passes on patched code; scope, symlink and freshness assertions |
| DeepSeek searched for withheld write tools instead of planning | Guidance explains plan-gated direct tools, standard/strict prerequisites, and `shell` outside code mode | Fresh live Ship run created its plan and began editing without the previous search loop |
| Long headless run crashed on HTTP headers timeout while its session kept executing | Reattach only the observation request on `UND_ERR_HEADERS_TIMEOUT`; keep the admitted prompt and deadline | Repeated-timeout regression verifies one prompt and final result; admission and unrelated errors are not retried |
| Unaffordable shop selection displayed generic failure/sign-in advice | Distinguish insufficient coins, invalid quote and expired quote | Same regression fails before/passes after; live TUI shows insufficient coins with wallet unchanged |
| Daily evidence Ctrl+P conflicted with the global command palette | Move preview to Ctrl+G, including editor binding and instructions | Live editor rejects incomplete evidence with `invalid_daily_evidence`, without opening the palette; draft discarded, still three submissions and unchanged wallet |

## Account transaction checks

- Starting balance: **50 coins / 0 XP**.
- Purchased sandals for **30 coins**, then equipped them.
- Ending balance: **20 coins / 0 XP**; sandals owned and equipped after service restart.
- Rejected: unowned equip, milestone-locked scenery, duplicate purchase, already-owned quote, stale profile version, insufficient funds.
- Quote creation did not debit. No pending purchase remained.
- Temporary ship-name customization persisted, then original name was restored.
- Native UI customization cancellation left profile version, name and wallet unchanged.

## Daily quests

Three distinct actual outcomes exercised submission, grading, detail, polling and native status display:

| Kind | Outcome | Assessment |
| --- | --- | --- |
| Change | Nested-workspace review repair | `needs_evidence`; focus 0.47, outcome 0.96, validation 0.95 |
| Tests | Unaffordable-purchase regression | `assessed_complete`; focus 0.93, outcome 0.95, regression 0.95 |
| Review | Headless observation-timeout finding | `needs_evidence`; focus 0.89, finding 0.95, outcome 0.96 |

The rubric requires every criterion to meet 0.90 for completion. These are classifier assessments of submitted evidence, not independent code verification. No thresholds were weakened and no result was repeatedly submitted to seek a better score.

An attempted cross-quest claim of the same outcome was rejected with `daily_outcome_claimed`. Accepted/terminal records erased their local raw payloads; retry after erasure was rejected with `no_pending_payload`, while IDs remained pollable. Each accepted submission had one provider attempt.

**The current `daily-outcomes-v1` policy has rewards disabled.** Successful assessment did not grant coins, XP, distance or equipment. This matters if launch messaging promises earning through daily quests.

## Validation and remaining scope

- Full Carthagent lint/typecheck passed.
- Full unit suite after the first four fixes: **1,127 passed, 5 skipped**.
- Native Voyages navigation: **12 passed**, 65 assertions.
- After the shortcut change, native typecheck, focused lint and the complete daily-quest test group passed; live keyboard verification passed.
- DeepSeek completed a **verified** Ship handoff for the real application's build/type/lint repairs. Independent reruns confirmed: **32 tests passed** (27 existing + 5 auth regressions), typecheck passed, lint exited 0 with **13 warnings**, and production build passed.
- Receipt audit confirms all four checks and final review bind to the current fingerprint `cea9b1d71e113d0b876cec4d3a2eef38f16e14decb519d033fb7d9325508b8bb`, with no pending checks, unverified requirements, missing artifacts/outputs or incomplete steps. Run: `903d3ed5-88db-41ca-b72d-f5699fa5ae7f`.
- Fresh Ship run reported cost: **$0.8724045**; earlier three-mode total: **$0.6963048**. Combined reported total: **$1.5687093**, excluding any unreconciled transport-failed usage.
- Native friends/badges views are not implemented. Authenticated Invest-With-Friends Google/database/Alpaca flows have not been exercised.
- Daily-quest summary text occasionally overlaps the actions heading in live terminal captures; this rendering issue remains open.
- Live evidence and exact requests/results are retained under `/tmp/opencode/launch-account/`; regression before/after logs under `/tmp/opencode/launch-*-regression/`.

## Independent production smoke checks

- Production HTTP server rejected all **25 invalid trade payloads** with 400 after the final build.
- Browser navigation from the public home page to Login succeeded. The initial production session request returned 500 because this local environment has no `NEXTAUTH_SECRET`; server logs explicitly reported `NO_SECRET`.
- A second test process with an ephemeral, process-only secret and localhost `NEXTAUTH_URL` returned 200 with an anonymous session. Login rendered without console/page errors; unauthenticated `/home` redirected to `/`. No project credentials or environment files were changed.
- `/api/matches/current` and `/api/trades/my` returned 401 unauthenticated.
- A valid unauthenticated trade request returned **503, not the test's expected 401**: the existing route calls the Alpaca market clock before authenticating, and that clock lookup failed. No trade/database write was reached. This check is recorded as failed, not counted as a passing authentication test. Full authenticated Google/database/trading behavior remains unverified.
- Evidence: `/tmp/opencode/iwf-independent-{tests,typecheck,lint,build}.log`, `/tmp/opencode/iwf-production-http-results.log`, `/tmp/opencode/iwf-production-auth-results.json`, and `/tmp/opencode/iwf-launch-ship/verified-receipt-audit.json`.

## Delivery state

The Carthagent fixes and this report are on `fix/launch-readiness-ship-voyages`. Invest-With-Friends changes remain local on `test/preview13-deepseek-modes`, preserving its existing work. Published preview.13 assets and stable npm `latest` have not been replaced. The installed local patch is explicitly labeled; these live results alone do not constitute a new release.
