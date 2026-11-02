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

## npm publication verified

After the workflow reported `+ carthagent@1.1.0-beta.2`, public registry requests
from the acceptance environment still returned 404 for that exact version.
Both npm CLI and cache-bypassed package metadata initially reported
`next=1.1.0-beta.1`, `latest=1.0.7`. Registry visibility subsequently converged;
no repeat publication was attempted.

The public beta.2 tarball's SHA-512 matches registry integrity and the provenance
subject digest. Sigstore verification passed for the GitHub Actions issuer and
the repository's `release.yml@refs/heads/main` identity. The statement identifies
release workflow 41512736590, and package `gitHead` matches the immutable tag.
Verified tags: `next=1.1.0-beta.2`, `latest=1.0.7`.
Evidence: `/tmp/opencode/beta2-npm-acceptance.json`.

## Installed update verified

The website command `npm install -g carthagent@next` installed beta.2 into an
isolated Linux x64 home/prefix. Default runtime acquisition resolved the pinned
CTG-owned executable with SHA-256
`8a34735274c0b62049f6ae882dc955016fde54458efc18822fbcedb2e8eddeda`.
The beta update check reported the installed version as current.
Evidence: `/tmp/opencode/beta2-clean-install-acceptance.json`.

An isolated npm installation of beta.1 detected beta.2 with
`ctg update --channel beta --check`. Running `ctg update --channel beta` upgraded
it to beta.2; a profile sentinel remained byte-for-byte intact. This used a
disposable home and global npm prefix, not the user's normal installation.
Evidence: `/tmp/opencode/beta2-update-acceptance.json`.

## Remaining acceptance

Stripe test-mode access and full paid-task continuation remain unavailable or
incomplete. Screenshot approval is not claimed. Local terminal timing failures
were followed by passing full local, CI and draft acceptance; this does not prove
that every terminal timing issue is resolved.

The normal installed profile and Invest-With-Friends files were not changed by
these release checks. Stable npm `latest` remains 1.0.7.
