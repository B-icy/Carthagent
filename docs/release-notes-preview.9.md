# 1.1.0-preview.9 release candidate

> **UNPUBLISHED — candidate guidance, not a release announcement.** No tag,
> draft creation, asset upload, or publication is part of candidate preparation.
> Published-channel updates cannot install this prebuild. Final-tag acceptance
> and release-owner approval remain required before publication.

## What this candidate contains

- **Native by default**, inherited from preview.8. `ctg native` remains a
  compatibility alias; `CTG_NATIVE` no longer selects another console. Stable
  1.0.7 remains the legacy release. The owned runtime and private CTG profile
  remain separate from regular OpenCode installations and credentials. Legacy
  Pi sessions remain read-only archives, not resumable native sessions.
- **Ship versus Lite:** Ship retains approval, checks, review, repair, recovery,
  and resume delivery workflow; Lite is direct execution. This is not a claim of
  complete behavioral parity across all interfaces or platforms.
- **Native Voyages (PR #225):** `/voyages` exposes profile customization, wallet,
  equipment and shop. Normal `/login` browser device approval binds the CLI to
  the approving user's existing web player, which remains authoritative. There
  is no separate CLI wallet, cookie import, paid-model requirement, or coding
  coin award. Older account-only credentials may need a new device sign-in.
- **Explicit mutations:** customization and equipment changes require
  confirmation. A paid purchase requires a server quote with price and expiry,
  followed by explicit confirmation. Cancel does not purchase. Ownership,
  funds, eligibility and profile version are checked by the server; refresh on
  conflicts rather than overwriting another client. Equip separately after
  purchase. An uncertain purchase retains its pending request across restart:
  recover using the same quote and request key, not a new purchase or deleted
  profile state. Signed-out/unavailable data is not a saved balance.
- **Credential refresh identity and coordination fixes** preserve account
  identity boundaries and coordinate refreshed credentials rather than treating
  unrelated identity or stale state as a successful refresh.
- **PTY and Windows cleanup fixes** preserve full-duplex terminal input and
  coherent paint snapshots, and verify fixture browser cleanup against captured
  process identities. Passing source tests is not proof
  of every physical terminal or operating-system UI interaction.

## Candidate provenance

| Input | Exact value |
| --- | --- |
| Package candidate | `1.1.0-preview.9` |
| Prebuild source | `c51c5ae11293e63b658df297abc732db88d9109a` |
| Prebuild workflow run | `40151970983` |
| Candidate manifest SHA-256 | `aa5de65b633219423d21b1cc645945028a2d5565714b71760cbcc18badc5f4e5` |
| Upstream revision | `843a6c514e606b436a7fe713422ace0a93ad3d61` |
| CTG patch SHA-256 | `b4238d77827d7ccf8f87fb0326551eaa62268d9387cd89e29bd0cf12bd6dafaa` |
| Lock SHA-256 | `9d78379cd264584a495440a217b9d2ecab524c9a56f7f8b4b5bed3926daa330d` |
| Detached runtime version | `0.0.0-ctg.2.0.32` (compatibility `2.0.32`) |

All five native builds (Linux x64/arm64, macOS x64/arm64, Windows x64) and
assembly succeeded. The **original 13-file prebuild bundle** was independently
verified through the production acquirer; manifest regeneration was
byte-identical. Upstream, patch, lock, and detached runtime identity are
unchanged from preview.8. The prebuild source above is not the final release
package commit: package/lock, complete generated manifest, and candidate docs
must be reviewed together before any final tag is selected.

Archive/provenance verification is not execution acceptance. The new Linux
ARM64 bytes passed isolated staged native-host and Ship-model probes, including
plugin/RPC contracts, device-flow start/cancel, model discovery, service stop,
and fixture cleanup. These use an explicit reviewed-artifact selector, not the
installed package's default resolver. Independent execution on the other four
targets and full final-tag installed acceptance remain pending. Earlier preview.8
source and artifact evidence remains historical and is not blanket acceptance
for preview.8 or preview.9.

## Recorded acceptance and its limits

The following supplied source/development-runtime results precede final-tag
release acceptance; they are not a claim that candidate-document edits reran CI.

| Scope | Recorded outcome |
| --- | --- |
| Final source quality, Linux | 934 tests: 929 passed, 5 skipped |
| Windows-only cases | Four of the Linux-skipped cases actually passed Windows CI |
| Python | 28 passed |
| Local ARM full required-owned/default-resolver gate | 28 probes, 0 failures, 0 skips |
| Exact source PR CI and main CI | All eight checks passed in each |

The local ARM result does not establish independent execution of the new
preview.9 prebuild bundle or its future final-tag public assets.

Live **actual TUI development-runtime** testing covered browser device approval,
name cancellation and save, owned Beanie equip, restart, web persistence,
expiry recovery, and revocation. The web player was authoritative. The user's
wallet contained **10 coins**, with no affordable paid quote: **no live paid
debit or paid-request replay was proven**. Do not turn pending-recovery test
coverage into a claim of a real paid purchase.

Actual **60x12** terminal navigation was functional, not model-based visual
approval. Physical clipboard behavior is not proven. Full cross-OS UI and
controlled paired performance remain unknown. There is no full behavior-parity,
lower-token/cost, or paid-model benchmark claim.

## Trying the candidate and remaining release gates

Before publication, use the matching prebuild archives and independently pinned
candidate manifest through the [explicit manual-kit artifact method](native-manual-testing.md).
Do not replace trust hashes to accept other bytes or expect the public default
resolver to find unpublished assets. Provider-free fixtures are scripted, not
model-quality evidence; live provider use requires deliberate credential and
spending authorization.

Only **after** `v1.1.0-preview.9` and its reviewed runtime assets are published:

```sh
npm install -g --install-links=true github:B-icy/Carthagent#v1.1.0-preview.9
# Or, from an installation supporting channels:
ctg update --channel experimental --check
ctg update --channel experimental
```

Experimental selection follows published semantic versions and may select a
later release; use the exact tag when reproducing preview.9. Drafts are never
updates, and prereleases do not advance the stable control-plane pointer.
See the [upgrade guide](native-upgrade.md) for non-destructive source checkout,
profile preservation, and stable-channel recovery.

Still pending: independently execute the other four platform outputs; review the final
package and manifest; obtain separate approval for the tag/draft/upload steps;
run full final-tag required-owned installed acceptance against the draft using
the normal resolver; obtain publication approval; then prove anonymous public
default-resolver installed acceptance. No backend edits or publication actions
are included in this version/pins/documentation candidate update.

The [older native migration draft](release-notes-native-draft.md) is preserved
unchanged as historical planning material, including its old opt-in routing and
unreleased-version assumptions. It is not current candidate installation guidance.
