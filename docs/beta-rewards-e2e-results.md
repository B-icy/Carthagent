# Beta reward acceptance results

## Production earned reward — passed

Tested November 2, 2026 UTC through the normal installed profile, authenticated
as the owner's Beshir Aissi account. The initial earned-claim checks used
preview.13 with labelled local launch/reward patches. Published-beta installation
and persistence acceptance subsequently passed, as recorded below.

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

## Authenticated browser acceptance — passed

On November 2, 2026, the normally authenticated browser account matched the
owner's terminal identity. The browser's delivery-reward lookup returned the
identical receipt, including its run, policy, amounts and award timestamp.
The complete browser profile deep-equaled the saved terminal profile: version
15, 45 coins, 100 XP, 1 total/weekly km, identical configuration and inventory.
The Shoes UI showed **Sandals — Equipped** and disabled
**Boots — 80 coins · Need 35**. Evidence:
`/tmp/opencode/rewards-browser-accepted.json`.

The account page's Cloudflare email-decoding script is blocked by its CSP,
so its visible email is obfuscated. Identity was compared using the page's
encoded email attribute; no login or browser protection was bypassed.

## Release acceptance

- Live browser identity, receipt and full-profile comparison passed.
- Live terminal rendering, cancellation and confirmed replay passed.
- Five-platform runtime prebuild 41398315323 succeeded on attempt 2. Exact
  provenance, all archive checksums, embedded metadata and executable hashes
  passed the production acquisition parser; regenerating the manifest produced
  the identical candidate. The packaged beta manifest now matches those bytes.
   Published installed-beta acceptance subsequently passed below.

Pre-manifest full native quality run: lint/build passed; 1,124 tests passed, five
skipped, six failed solely because the package version is beta.1 while the
runtime manifest still pins preview.13. These remain release-blocking failures
until the verified beta candidate was integrated. The post-integration quality
run passed: **1,130 tests passed, five skipped, zero failures**, plus lint,
typecheck and build. Exact candidate/packaged manifest equality and
`verify-release-version.mjs v1.1.0-beta.1` also passed. No trust assertion was relaxed.

Native PR CI passed all jobs after retrying one Windows Node 24 process-query
timeout. Native navigation also passed locally: 12 tests / 65 assertions.

The immutable tag `v1.1.0-beta.1` points to
`81f5e4542abf1368b6f3baeb5ce5aa48d14bb6de`, preserved as an ancestor of main
after [PR #236](https://github.com/B-icy/Carthagent/pull/236) merged.
[Final draft acceptance](https://github.com/B-icy/Carthagent/actions/runs/41406021097)
passed full quality, installed-package default runtime resolution, immutable
tag/assets checks and main ancestry. The
[GitHub prerelease](https://github.com/B-icy/Carthagent/releases/tag/v1.1.0-beta.1)
was published at `2026-11-02T08:26:59Z` with all seven verified assets.
[Public release acceptance and npm publication](https://github.com/B-icy/Carthagent/actions/runs/41413154402)
passed. Anonymous fresh-cache acquisition verified all five native runtime
archives, executable digests and provenance. The public release manifest exactly
matches the packaged manifest. npm published the package with signed provenance
([transparency entry](https://search.sigstore.dev/?logIndex=3638038408)). Public
registry acceptance passed: exact version and gitHead, npm `next=1.1.0-beta.1`,
unchanged `latest=1.0.7`, tarball SHA-512 matching the attestation subject, and
cryptographic Sigstore verification against the expected GitHub Actions issuer
and release-workflow identity. This follow-up evidence does not move or rewrite
the beta tag.

## Published beta installed acceptance — passed

`ctg update --channel beta` upgraded the normal global installation from
preview.13 to **1.1.0-beta.1**. `ctg --version` reports the beta; the persisted
channel is `beta`, and `ctg update --check` reports it current.

- All **604 installed package files** exactly match the provenance-verified
  public npm tarball. The local-patch marker is absent.
- The normal registered service reports launcher `1.1.0-beta.1`, uses the
  beta-owned Linux x64 runtime, and its executable hash matches the packaged
  trust manifest.
- Owner credentials and the original Ship session survived the service upgrade.
  The session reopened in the published TUI with its previous delivery output.
- The complete profile matches both the earlier terminal and authenticated
  browser evidence: version 15, **45 coins / 100 XP / 1 km**, equipment and all
  inventory unchanged. The published TUI visibly displays the same values.
- Preview recovers the exact original run and snapshot. Claim replay returns
  the original receipt with `replayed:true`; no duplicate award or profile
  version change occurs.
- All **106 tracked/untracked Invest-With-Friends files** retained their saved
  hashes across the upgrade. Disposable PostgreSQL and the test browser session
  were cleaned up.

Evidence: `/tmp/opencode/beta1-npm-acceptance.json`,
`/tmp/opencode/beta1-installed-acceptance.json`,
`/tmp/opencode/beta1-installed-tui.txt`, and
`/tmp/opencode/beta1-public-runtime.log`.

The reward backend relies on authenticated local-harness attestation. It does
not independently execute repositories or prove authorship. Daily classifier
assessment and personal quest checkmarks remain unrewarded.

Local evidence: `/tmp/opencode/rewards-live-claimed.json`,
`/tmp/opencode/rewards-live-restarted.json`, and
`/tmp/opencode/rewards-installed-backup/provenance.json`.
