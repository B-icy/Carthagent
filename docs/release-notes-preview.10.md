# 1.1.0-preview.10 release candidate

> **NOT YET PUBLISHED — candidate guidance, not a release announcement.**
> Published preview.9 remains immutable. This candidate still needs its final
> tag, draft/assets, exact-tag installed default-resolver acceptance, public
> release, and anonymous public default-resolver acceptance. No stable release
> or stable control-plane update is part of this candidate.

## What changes

Native remains the default `ctg` interface; `ctg native` is a compatibility
alias. Ship retains approval, checks, review, repair, recovery and resume; Lite
remains direct execution. Stable 1.0.7 retains the legacy console, and legacy
Pi transcripts remain read-only archives. The owned native profile remains
separate from other coding-tool credentials and sessions.

**Native daily coding quests (PR #227)** are available through `/voyages` →
**Daily coding quests**, using normal Carthagent Ship device sign-in:

- Select a server assignment and individual evidence from an owned session's
  exact active Ship report, or supply a clearly labeled manual claim. Nothing
  is selected by default. Edit/redact sensitive text yourself; there is no
  automatic secret-scrubbing guarantee or whole-project/transcript upload.
- Inspect the complete canonical outbound JSON. Editing invalidates that exact
  preview. Submission requires fresh, explicit consent for this request and
  disclosure of external **JEV** processing. Login or completing local delivery
  is not consent; cancel does not send. Identity/connection/location invalidation
  clears the draft/consent and returns the action selection to **Refresh**.
- The exact request and stable submission ID are durably journaled before send.
  Recover an uncertain send by **GET/status first**; read-only refresh/poll never
  replays. Any explicit replay uses the saved ID and exact body, not a new ID.
  Journal failure fails closed; accepted IDs remain usable across restart.
- Acceptance is not completion. Local raw payloads are erased on known
  acceptance; unknown-send payloads expire after up to 24 hours on journal
  access, not a background timer. Explicit local erasure retains polling IDs
  and cannot withdraw evidence already sent. Backend raw evidence is erased
  on terminal processing (pending up to 24 hours; outages can delay cleanup);
  metadata retention is 90 days. Immediate provider/backup deletion is not promised.
- Graded decisions assess submitted evidence, **not independent verification**.
  Scores are not calibrated confidence. There are **no coins, XP, distance,
  inventory or other rewards**; personal quests remain separate.

See [native daily quest guidance](native-daily-quests.md) for schema, privacy,
retention, consent and recovery details.

## Candidate provenance

| Input | Exact value |
| --- | --- |
| Package candidate | `1.1.0-preview.10` |
| Feature source head | `5e759c4c4d21b1df10ecdcd130ad59cd377bcc15` |
| Original prebuild source | `7a9d49fe7e2dcc8358a4c28e3539479df5be55a1` |
| Prebuild workflow run | `40950483282` |
| Full manifest SHA-256 | `2d4adee543f5dec37abf8a67c677cecfc5de294031a1c37d23fea43bc90fe757` |
| Upstream revision | `843a6c514e606b436a7fe713422ace0a93ad3d61` |
| CTG patch SHA-256 | `b4238d77827d7ccf8f87fb0326551eaa62268d9387cd89e29bd0cf12bd6dafaa` |
| Lock SHA-256 | `9d78379cd264584a495440a217b9d2ecab524c9a56f7f8b4b5bed3926daa330d` |
| Runtime / compatibility | `0.0.0-ctg.2.0.32` / `2.0.32` |

All five prebuilds succeeded: Linux x64/arm64, macOS x64/arm64 and Windows x64.
The original **13-file bundle** was independently verified through the
production acquirer, with byte-identical manifest regeneration. Runtime,
upstream, patch and lock identities are unchanged, but this manifest pins the
**fresh five-platform archive and executable hashes**, not preview.9 hashes.
Prebuild provenance is not final package identity or installed acceptance.

## Recorded evidence and limits

These are supplied source/development-runtime results, not tests rerun by this
version/docs preparation and not exact-candidate installed acceptance.

- **Source quality at `5e759c4`: 1,069 passed, 0 failed, 5 skipped.** The first
  historical quality run had 1,068 passed, 1 failed, 5 skipped: a legacy
  dashboard 401-versus-403 assertion of unknown cause. Isolated and serial runs
  passed; that does not establish a causal fix. Feature-head normal
  [PR CI40951839410](https://github.com/B-icy/Carthagent/actions/runs/40951839410)
  and [push CI40951831992](https://github.com/B-icy/Carthagent/actions/runs/40951831992)
  both passed all eight jobs. Release-candidate CI remains a separate gate.
- **Actual native daily flow:** one authorized provider attempt reached graded
  `needs_evidence`, not quest completion or rewards. Raw-payload erasure and
  read-only polling after an actual client restart passed. Genuine background
  cancellation notice, reset to Refresh, and delayed Enter behavior passed.
  Unknown network-send replay was not forced live; that coverage is offline only.
- **Actual native wallet flow:** fresh normal device approval; cancel made no
  purchase and left 50 coins. One explicitly authorized 40-coin `bottoms:shorts`
  purchase left 10 coins, owned items 9 → 10 and profile version v1 → v2.
  Actual client restart preserved it; equipment was unchanged. This is not a
  daily-quest reward or proof of live unknown-response purchase replay.
- **Website browser E2E blocked:** Chrome was missing and one install attempt
  failed because Linux ARM64 was unavailable. Public Voyages HTTP 200 is not
  signed-in browser proof.
- **Native-host CI caveat:** the initial `7a9d49f` PR macOS Node 24 service-stop
  5,000 ms timeout is not causally fixed. New failure-only diagnostics leave
  deadlines and assertions unchanged; review returned no findings (`[]`) and
  Linux native-host passed. Both later feature-head CI runs passed, including
  macOS Node 22/24; that is gate evidence, not a causal shutdown fix or full
  cross-platform interactive UI proof.

## Trying it and remaining gates

Before publication, use only reviewed artifacts with the
[explicit manual-kit method](native-manual-testing.md); do not weaken hashes or
expect the public default resolver to find unpublished assets. No claim is made
that this exact candidate has passed installed-package acceptance.

Only **after publication** of the final tag and reviewed assets:

```sh
npm install -g --install-links=true github:B-icy/Carthagent#v1.1.0-preview.10
# Or select published experimental releases (possibly a later preview):
ctg update --channel experimental --check
ctg update --channel experimental
```

Drafts are not updates. Experimental releases never advance the stable pointer.
Final package/manifest review, final CI, tag/draft/assets, exact-tag installed
acceptance with the normal resolver, publication and anonymous public installed
acceptance remain release gates. See the [upgrade guide](native-upgrade.md) for
profile preservation and stable-channel recovery. Historical
[preview.9 notes](release-notes-preview.9.md) are retained unchanged, not current
candidate status or evidence that immutable preview.9 gains these changes.
