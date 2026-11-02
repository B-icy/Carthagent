# Beta.2 release acceptance

November 2, 2026. Immutable tag `v1.1.0-beta.2` points to
`e14aeb17c213a927a27e9522da65db5928219647`.

## Completed

- Native onboarding PR #238 and first-task guidance PR #239 merged. Release PR
  #240 merged with tag ancestry preserved at `fc5382364f41b1563ed137ed0db0c5711e041a83`.
- Five-platform prebuild [41505735348](https://github.com/B-icy/Carthagent/actions/runs/41505735348)
  passed. Local manifest regeneration verified all archive/executable hashes and
  embedded provenance against the pinned runtime recipe.
- Release CI [41509102387](https://github.com/B-icy/Carthagent/actions/runs/41509102387)
  passed across Linux, macOS and Windows, including installed-package acceptance.
- Final draft acceptance [41511681097](https://github.com/B-icy/Carthagent/actions/runs/41511681097)
  passed against the exact tag, assets and main ancestry.
- GitHub prerelease is public with five runtime archives, the manifest and
  combined checksums. Independent anonymous verification of all five public
  archives passed.
- Release workflow [41512736590](https://github.com/B-icy/Carthagent/actions/runs/41512736590)
  passed anonymous installed-package acceptance and reports successful npm
  publication with signed provenance (transparency log index 3648230788).
- Backend onboarding #178 and retention reporting #179 are deployed. Live
  authenticated account identity and read-only plan terms were verified earlier.

## Registry discrepancy under investigation

After the workflow reported `+ carthagent@1.1.0-beta.2`, public registry requests
from the acceptance environment still returned 404 for that exact version.
Both npm CLI and cache-bypassed package metadata reported `next=1.1.0-beta.1`,
`latest=1.0.7`. Successful workflow publication is not yet public acquisition
evidence. npm tarball/provenance verification and clean `@next` installation are
pending registry visibility; no repeat publication was attempted.

## Remaining acceptance

Verify npm integrity/provenance, clean public acquisition and installed update.
Stripe test-mode access and full paid-task continuation remain unavailable or
incomplete. Screenshot approval is not claimed. Local terminal timing failures
were followed by passing full local, CI and draft acceptance; this does not prove
that every terminal timing issue is resolved.

The normal installed profile and Invest-With-Friends files were not changed by
these release checks. Stable npm `latest` remains 1.0.7.
