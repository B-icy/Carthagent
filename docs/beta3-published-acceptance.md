# Beta.3 release acceptance

November 2, 2026. Immutable tag `v1.1.0-beta.3` resolves to
`ee2fa3f039c296aa4ca613c474eb460e27a23ff2`. Release PR #243 merged at
`0964ce7331eb749183131d6031823137d068afa9`, preserving tag ancestry.

## Verified release gates

- Five-platform prebuild [41537249365](https://github.com/B-icy/Carthagent/actions/runs/41537249365)
  passed from reviewed main `c11103f8b57c6b3254473a78d535a404bea9a84a`.
  Local regeneration verified archive/executable hashes and embedded provenance;
  the candidate, packaged and uploaded manifests match exactly.
- Local quality passed lint/build and 1,132 tests, five skipped. An initial run
  before candidate installation correctly rejected the temporary package/manifest
  version mismatch.
- PR CI [41539253388](https://github.com/B-icy/Carthagent/actions/runs/41539253388)
  passed on attempt 2 across Linux, macOS and Windows, browser and package gates.
  Initial failed jobs ran before draft asset uploads completed.
- Local installed-package acceptance passed all 28 probes/scenarios with the
  default isolated acquisition path. Earlier local acquisition attempts used an
  unsupported `gh auth token` command; the acceptance shell was corrected to use
  this older CLI's supported credential lookup. No product workaround was used.
- Final draft acceptance [41541394653](https://github.com/B-icy/Carthagent/actions/runs/41541394653)
  passed against the immutable tag, assets and main ancestry.
- The GitHub prerelease is public. Anonymous downloads of all five archives
  matched the packaged checksums.
- Release workflow [41542206810](https://github.com/B-icy/Carthagent/actions/runs/41542206810)
  passed anonymous installed-package acceptance and reported npm publication
  with signed provenance (transparency log index 3652108243).

## Public npm availability

The first public exact-version requests returned 404 after the workflow reported
successful publication. Registry visibility subsequently converged without repeat
publication. Verified tags are `next=1.1.0-beta.3`, `latest=1.0.7`.

The public tarball's SHA-512 matches npm integrity and the provenance subject.
Sigstore verification passed for the GitHub Actions issuer and repository
`release.yml@refs/heads/main` identity. The statement identifies workflow
41542206810; package `gitHead` equals the immutable tag. Private receipt:
`/tmp/opencode/beta3-npm-acceptance.json`.

## Public install and update

`npm install -g carthagent@next` installed beta.3 into a disposable Linux x64
profile. A separate beta.2 installation detected and upgraded to beta.3 using
`ctg update --channel beta`. Both acquired the CTG-owned runtime with executable
SHA-256 `f9ad13d8aad76bf1d16334712f0060b886757f5cdabddacce42f9805d4482c1c`,
preserved profile sentinels, displayed `--reset-budget` and billing-refresh help,
and reported beta.3 as current. Private receipt:
`/tmp/opencode/beta3-public-acceptance/evidence.json`.

The continuation-budget regression passed when run from the publicly installed
package: exhausted continuation reports the reason, ordinary continuation does
not reset/retry, and explicit reset targets the same session before prompting.
This is an offline regression, not another real-model/payment journey.

The first public-install script used an overly literal help assertion expecting
`billing refresh`; actual help correctly lists `billing [checkout|portal|refresh]`.
The assertion was corrected and both complete install/update scenarios passed.

## Journey evidence and boundary

Backend PRs #180–181 are deployed. Fresh sandbox evidence covers automatic
partial-refund revocation, initial and upgrade 3DS2, declined-upgrade recovery on
the same invoice and preserved renewal anchors. Scheduled cancellation retains
paid access and displays the end date accurately. Backend PR #182 records these
results in `docs/stripe-sandbox-acceptance.md`.

The real production Cloud task and exact-session continuation with the source
launcher passed five independent project tests. A single task crossing a real
payment boundary remains unverified: model execution used production credit,
while payments used the isolated sandbox without a model upstream.

Normal installed profile and Invest-With-Friends work were preserved.
