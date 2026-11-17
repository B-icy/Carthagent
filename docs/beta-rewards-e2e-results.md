# Beta reward acceptance results

## Production earned reward — passed

Tested November 2, 2026 UTC through the normal installed profile, authenticated
as the owner's Beshir Aissi account. The installation is still preview.13 with
labelled local launch/reward patches; these results are not installed-beta
release acceptance.

- Backend PR [#176](https://github.com/B-icy/Carthagent-Backend/pull/176), merged
  revision `ec40fdb9b053e64b820adb18e7d35da927468149`.
- [Production deployment](https://github.com/B-icy/Carthagent-Backend/actions/runs/41401836218)
  passed migration/readiness, public-site and service checks.
- Native preview accepted the real required-check Ship delivery
  `903d3ed5-88db-41ca-b72d-f5699fa5ae7f`, source snapshot
  `cea9b1d71e113d0b876cec4d3a2eef38f16e14decb519d033fb7d9325508b8bb`.
- Claim receipt `9d44cf4b-0a70-40e5-90ce-d68a7718fe21`, awarded
  `2026-11-02T06:49:23.538Z`, policy `verified-delivery-beta-v1`.

| Check | Before | After |
| --- | --- | --- |
| Coins | 20 | 45 |
| Total XP | 0 | 100 |
| Total / weekly km | 0 / 0 | 1 / 1 |
| Profile version | 14 | 15 |
| Equipment / inventory | Sandals equipped | Identical, sandals retained |

Immediate replay returned the identical receipt with `replayed:true` and no
additional grant. After stopping and restarting the registered native service,
preview, replay and profile all matched the saved post-claim result exactly.
Sessions and credentials persisted. No debug issuance was used.

The live TUI displayed 45 coins / 100 XP / 1 km, rendered the digest-only claim
confirmation, accepted cancellation, and then confirmed the existing receipt
with “This delivery was already rewarded. No duplicate grant.” The wallet and
version stayed unchanged. Captures: `/tmp/opencode/rewards-ui-preview.txt` and
`/tmp/opencode/rewards-ui-replayed.txt`.

## Repeatable new-user acceptance — passed locally

Disposable PostgreSQL 17.11: 117 tests passed before the additional bearer
scenario; the complete six-test bearer group also passed. Backend CI ran the
updated suite successfully. Backend unit tests: 521 passed, one skipped.
Syntax, assets and navigation checks passed.

Coverage includes one welcome grant, cookie and device-approved bearer access,
reward claims and browser/CLI agreement, token refresh/new CLI session, owner
isolation, concurrent daily caps, run/snapshot deduplication, changed-evidence
rejection, transaction and wallet-overflow rollback, level/week progression,
milestone shop/quote/equip agreement, purchase replay, database reconnect and
restricted deployment/application-role permissions.

Native build/lint and 76 focused tests passed, including explicit confirmation,
account/session binding, current source gates, privacy of digest-only uploads,
lost-response recovery, restart and receipt recovery after source changes.

## Historical release follow-up (reviewed November 17)

The pending-release statements below describe the original November 2 checkpoint,
not the current publication state. Beta.1 was subsequently published:

- [Draft acceptance 41406021097](https://github.com/B-icy/Carthagent/actions/runs/41406021097)
  and [release acceptance/publication 41413154402](https://github.com/B-icy/Carthagent/actions/runs/41413154402)
  both have successful GitHub Actions conclusions.
- [v1.1.0-beta.1](https://github.com/B-icy/Carthagent/releases/tag/v1.1.0-beta.1)
  is a public, non-draft release, published November 2 at 08:26:59 UTC.
- [PR #237](https://github.com/B-icy/Carthagent/pull/237) retains the original
  author's additional account/browser, installed-profile, provenance and reward
  replay report. Its local evidence paths were not independently revalidated in
  the November 17 backlog review; those assertions are not new acceptance results.

Publication status and workflow conclusions were rechecked through GitHub. No
release tags/assets were changed, and old npm dist-tag observations must not be
read as current channel state. This historical delivery-reward record is not
acceptance of today's daily-goal or crew-harbour journey.

## Remaining acceptance gates at the original checkpoint

- Live browser comparison awaits normal user sign-in in `voyages-rewards-e2e`.
- Live terminal rendering, cancellation and confirmed replay passed.
- Five-platform runtime prebuild 41398315323 succeeded on attempt 2. Exact
  provenance, all archive checksums, embedded metadata and executable hashes
  passed the production acquisition parser; regenerating the manifest produced
  the identical candidate. The packaged beta manifest now matches those bytes.
  Installed beta acceptance remains pending.

Pre-manifest full native quality run: lint/build passed; 1,124 tests passed, five
skipped, six failed solely because the package version is beta.1 while the
runtime manifest still pins preview.13. These remain release-blocking failures
until the verified beta candidate was integrated. The post-integration quality
run passed: **1,130 tests passed, five skipped, zero failures**, plus lint,
typecheck and build. Exact candidate/packaged manifest equality and
`verify-release-version.mjs v1.1.0-beta.1` also passed. No trust assertion was relaxed.

Native PR CI passed all jobs after retrying one Windows Node 24 process-query
timeout. Native navigation also passed locally: 12 tests / 65 assertions.

The reward backend relies on authenticated local-harness attestation. It does
not independently execute repositories or prove authorship. Daily classifier
assessment and personal quest checkmarks remain unrewarded.

Local evidence: `/tmp/opencode/rewards-live-claimed.json`,
`/tmp/opencode/rewards-live-restarted.json`, and
`/tmp/opencode/rewards-installed-backup/provenance.json`.
