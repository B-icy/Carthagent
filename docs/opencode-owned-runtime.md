# CTG-owned OpenCode v2.0.32 UI runtime

Published native releases select a CTG-owned, source-pinned runtime through the
packaged `lib/opencode/runtime-release.json`. The default resolver downloads the
exact platform asset for that release, verifies archive and executable checksums
and source/patch/lock provenance, and caches it under Carthagent's private profile.
It never replaces a regular OpenCode installation or rewrites `@opencode/cli`.
Selecting the owned runtime is fail-closed: a missing or invalid release asset is
an error, not permission to fall back to a different executable.

`CTG_OWNED_OPENCODE_RUNTIME` is a separate staging/developer selector, not the
normal end-user installation path. An explicit directory must contain the
matching `ctg-runtime.json`, `SHA256SUMS`, and platform artifact. Native is the
CLI default in the unpublished preview.9 candidate, inherited from preview.8;
`ctg native` remains an alias. The legacy
`--engine-cli` option cannot restore the retired console.

## Current preview.9 candidate (unpublished)

Prebuild run `40151970983` succeeded for all five native targets and assembly
using source `c51c5ae11293e63b658df297abc732db88d9109a` for package
`1.1.0-preview.9`. The original 13-file bundle was independently verified with
the production acquirer; regenerated manifest bytes matched exactly. Candidate
manifest SHA-256:
`aa5de65b633219423d21b1cc645945028a2d5565714b71760cbcc18badc5f4e5`.
Upstream, patch, lock and detached runtime identity are unchanged from preview.8;
the release-bound archive set and manifest must still be treated as preview.9
artifacts, never replaced with preview.8 assets.

The new Linux ARM64 bytes passed isolated staged native-host and Ship-model
probes. Other platforms' independent execution, final-tag/default-resolver
acceptance against a draft, and anonymous public installed acceptance remain
pending. No preview.9 tag, draft, asset upload or publication is included in
this candidate preparation. See the [current notes](release-notes-preview.9.md)
and [explicit unpublished-artifact instructions](native-manual-testing.md).
The older source/build observations below are historical, not claims that all
preview.8 or preview.9 acceptance gates have passed.

## Pinned inputs and reproducible source application

- Upstream: `https://github.com/anomalyco/opencode`
- Tag/revision: `v2.0.32` / `843a6c514e606b436a7fe713422ace0a93ad3d61`
- CTG patch: `docs/patches/opencode-v2.0.32-session-ui-combined-v4.patch` (combined-v3 plus the Projects / Voyages navigation rail, shared dialog resize subscription, and hardened rail/watcher timing tests; published in preview.11 and preview.12)
- Patch SHA-256: `1f2309bb3a31dfb8e8a0827a6a1144a1f76a005abff58f6f48857639ec02478a`
- Previous combined-v3 patch SHA-256 (preview.10): `b4238d77827d7ccf8f87fb0326551eaa62268d9387cd89e29bd0cf12bd6dafaa`
- Lock SHA-256: `9d78379cd264584a495440a217b9d2ecab524c9a56f7f8b4b5bed3926daa330d`
- Historical combined preview.8 source verification: 136 retained TUI rendering/loader/theme/selection
  regressions, 24 core recovery/shell regressions, and core/server/plugin/client/tui
  typechecks passed. Exact five-platform archives and full installed-package
  acceptance remain per-release gates; source tests alone do not satisfy them.
- Historical migration verification: Bun 1.4.2 frozen-lockfile install passed, TUI
  typecheck passed, and glyph/keymap/plugin-theme/real-provider-theme tests
  passed together (19 tests / 188 assertions, one process,
  `--timeout 60000`). Independent review approved exact corrected head
  `0e38142bff30ca2a8b2a66394e5055d541fce489`, including the canonical
  Windows-style checkout-to-recipe handoff and dirty-input rejection.
  At that historical revision, five-platform build and installed-artifact acceptance were still pending.
- Historical workflow registration: independently and parent-approved bootstrap #197
  passed CI and merged on `main` as `bd1292c8c4`. The workflow is registered;
  actual prebuild run `39089640210` was dispatched at reviewed source
  `70882269e25ebcb62c843f9265345342b9e6844d` for planned version `1.1.0`.
  That first run produced Darwin archives but failed the other three targets.
  That initial run was not a complete five-platform candidate; later previews have separate tagged manifests.
- Historical separate parent-quality follow-up: native CLI browser-launch isolation
  `d4983b57328a187e8be6bc0e2c6bd2dda7518920` is not part of this upstream source
  patch and must be integrated in its applicable parent branch before the
  parent's full-quality result is claimed.
- Toolchain: Bun `1.4.2` as pinned by the upstream source
- Compatibility version: `2.0.32`; detached CTG version/channel:
  `0.0.0-ctg.2.0.32` / `ctg.2.0.32`

The patch includes visual-only `/clear` backed by a durable per-session
transcript presentation cutoff (no server message deletion),
`/autocompact` persisted in that session's metadata (manual `/compact` still
works), authoritative shell-origin/session/call correlation and capability
gating, and the terminal title-stack save/restore lifecycle. Native tool,
CodeMode child calls, and explicitly manual shell are distinguished; missing
external shell provenance stays unowned/fail-closed and is never inferred from
cwd or command text. The shell-origin capability is advertised only by a CTG
channel build.

To apply/build, use a clean checkout of the exact revision, install Bun 1.4.2,
copy this patch and `script/ctg/build-owned-runtime.sh` into it, then run:

```sh
script/ctg/build-owned-runtime.sh opencode-linux-x64
```

For a local CTG checkout, copy the artifact contents (not the 180 MB binary
into Git) to a managed directory and opt in explicitly:

```sh
CTG_OWNED_OPENCODE_RUNTIME="$HOME/.carthagent/runtimes/opencode-ctg-2.0.32" npm run ctg -- tui
```

The resolver rejects a wrong source/patch manifest, a different OS/architecture,
an unlisted or modified executable, or an unexpected runtime version before it
starts a service. The TUI is pointed at the already-owned temporary-profile
service just as for the existing package-owned runtime.

Release installation must use only a canonical CTG tag-bound asset/version,
cache under a CTG-owned data directory, validate the asset manifest and exact
runtime binary digest, and fail clearly offline or on unsupported platforms.
It must never silently fall back to `@opencode/cli` after selecting the owned
runtime, nor rewrite that package's binary. The release gate must install the
normal package with no runtime environment override and prove it starts this
owned runtime. Preview.9 assets have not yet been published; historical preview
assets do not satisfy its release gate.

Use a matching native OS/architecture for other upstream-supported targets;
cross-compilation is rejected. The script fails closed on source revision,
Bun version, patch hash, and `git apply --check`; it applies the patch, runs
the affected typechecks/tests, builds with web UI omitted, and writes
`ctg-runtime.json`, `SHA256SUMS`, and the upstream MIT license into the output.
The runtime resolver validates every manifest contract field, the native
platform, executable checksum, and exact detached `--version` before launch.
It does not search PATH or silently fall back when the opt-in is selected.

The CTG workflow has separate `prebuild` and `publish` dispatch modes. Prebuild
uses a reviewed source commit and planned package version, performs five native
builds, records executable digests from the built bytes, and carries the exact
USTAR archives and records through the manifest generator into a reviewable
candidate artifact. It does not require a final tag. Publish accepts only a
successful run of this workflow, downloads that run's candidate bytes,
regenerates and compares the manifest against the final tagged package, and
refuses to overwrite an existing runtime asset on the draft release. Prebuild
may be dispatched from a reviewed branch before product merge, but its explicit
source SHA must equal the dispatch workflow commit; this is non-publishing and
does not constitute product or release approval. Publish remains restricted to
the default branch and verifies again against the final tagged package.

Release sequencing is deliberately split across two manual workflows. First,
build and review the immutable five-platform-archive set, package the final
trusted runtime manifest, tag the exact package commit, create a GitHub draft
release, and upload the identical reviewed release assets. The draft contains
the five `opencode-*.tar.gz` archives plus exactly one `runtime-release.json`
and one `runtime-release-SHA256SUMS.txt` combined checksum file (seven assets
total), as uploaded by the approved publish workflow. Then run
`Accept draft runtime release` for that exact tag. The final acceptance workflow must be dispatched from the
approved `main` branch. Before checking out the release tag or executing any
tag-sourced verifier, a trusted inline bootstrap reads `package.json` from
`origin/main`, checks the exact version tag, and verifies that the peeled
annotated or lightweight tag commit is an ancestor of `origin/main`. The same
main/tag ancestry and exact-SHA relationship is checked again after acceptance.
It requires the release to remain a draft with exactly those seven assets, runs
`npm ci` and full `npm run quality`, and runs the current full,
non-focused installed-package gate with `CTG_REQUIRE_OWNED_RUNTIME=1` and the
normal default resolver. The independently reviewed host-controls, glyph,
controlled-terminal semantics, and visual-clear/reopen probes are now composed
into that gate. Their live final-artifact results remain pending. GitHub
documents that only callers
with push access receive draft releases from the release-list endpoint. The
workflow therefore grants its job `contents: write`, the minimum `GITHUB_TOKEN`
permission that provides the required push capability. This is a write-capable
token, not a read-only token: the workflow deliberately uses it only for
read-only GETs to inspect draft/release metadata and retrieve the runtime assets.
There are no POST/PATCH/PUT/DELETE requests, release creation/publication or
asset-upload commands, or control-plane calls in this gate. The acceptance step
clears `GH_TOKEN` and passes the token only as `CTG_RUNTIME_GITHUB_TOKEN` for
asset reads; checkout credentials are not persisted. The workflow checks the
same draft ID and tag target again after acceptance.

Only after that gate succeeds and the release owner approves should the release
be published. The existing `Release` workflow is the post-publication gate. Its
installed-package acceptance uses `CTG_RUNTIME_GITHUB_TOKEN` explicitly empty,
proving the ordinary anonymous public resolver path. Its stable-only
`publish-release-manifest` job verifies the published asset set and five-platform
manifest before publishing the control-plane manifest. Prerelease tags such as
preview.9 skip that job and never advance the stable control-plane pointer;
experimental selection reads published prereleases from GitHub. Neither workflow creates a release,
uploads assets, publishes a release, or dispatches another workflow. This
sequence still requires separate approval and execution against the final
preview.9 release artifacts; candidate prebuild verification is not that gate.

When a release is still a GitHub draft, CI may opt in to authenticated asset
retrieval by setting `CTG_RUNTIME_GITHUB_TOKEN` for the resolver/verifier
process. This transport is optional: without it, installed products use the
normal anonymous public release-download URL. With it, the token is used only
for read-only `GET` requests to the fixed `api.github.com/repos/B-icy/Carthagent`
release and asset APIs. The transport requires one exact `v<packaged-version>`
release and one exact expected asset name; it does not fall back to public
downloads if the requested draft release or asset is absent or ambiguous.
GitHub asset redirects are followed without forwarding the credential. The
token is removed from OpenCode, workspace, and runtime identity-check child
environments, and the
existing packaged runtime-release manifest remains the sole source of archive,
executable, and provenance trust pins. The normal no-token installed-package
acceptance remains required after publication.

## Historical source-level full-TUI glyph evidence

The pending-build statements in this section describe the original composition
checkpoint, not the current preview.9 prebuild status above. They do not establish
complete acceptance of any later release.

The approved glyph-v4 patch is composed into the reviewed `81e` base patch. A
combined candidate adds the separately approved spinner test-isolation
follow-up and real-provider theme integration test. Exact-digest source review
and independent combined-suite reproduction passed; the final build and live
acceptance remain pending. The host patch adds
a centralized host-chrome registry to the full TUI while preserving arbitrary
user text. The glyph author reports independent source approval and 11 focused
tests/146 assertions passing on the author worktree. This is source evidence,
not final-binary evidence; the exact composed binary must still be built and
tested before claiming compatibility.

The source patch centralizes host-chrome glyphs (borders, selection/status
markers, spinners, and structural tree/connector marks) for the full TUI. It maps
only registered chrome tokens to readable ASCII alternatives, preserves theme
colors and typography, and does not sanitize or transliterate arbitrary user
text, filenames, diffs, shell output, or code. The exact final binary still needs
the reviewed full-TUI terminal matrix and unknown/legacy-terminal proof.

Any source-patch change invalidates prior binary, manifest, and title evidence;
rebuild and revalidate the exact resulting artifact before making
terminal-compatibility claims.

The approved `/help` patch gives bare `/help` deterministic extension-over-native
dispatch and restores native help when an extension claim is removed. The help
author reports the parent’s full keymap suite passed 5/5. The exact final binary
still must demonstrate the agreed bare-help UI behavior before release claims.

## Historical artifact and bounded title evidence

At this historical checkpoint, no binary had been built from the final composed
patch yet. Earlier Linux
artifact and PTY title observations used the pre-composition patch and are
superseded for release acceptance. Build, executable digest, runtime manifest,
full-TUI glyph/help/theme proofs, and title restore/readback must all be recorded
against the exact reviewed composed patch before release.

No paid provider traffic or real profile was used. Core compaction and shell
retention tests passed 16/16, server shell HTTP-provenance passed 1/1, renderer
tests passed 5/5, and the clear UI test reported 3 passing assertions with a
cleanup lock warning. The native build recipe includes all focused source
gates; Bun's upstream provenance verification was independently reviewed but
could not be rerun in the review environment. Full two-session state isolation
across restart, visual clear preservation in a real service, auto-compaction
on/off through overflow, manual compact, concurrent authoritative shell
attribution, final title restoration, glyph/help behavior, approved artifact
distribution, and installed default selection remain release gates.
