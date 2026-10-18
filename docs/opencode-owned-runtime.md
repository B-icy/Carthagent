# CTG-owned OpenCode v2.0.32 UI runtime (opt-in)

This change defines a source-pinned, CTG-owned OpenCode runtime. The explicit
`CTG_OWNED_OPENCODE_RUNTIME` directory selector is a staging/developer override,
not an end-user release path. A complete release must bundle or install a
platform artifact pinned to its exact manifest and verify its checksum before
launch, without replacing an upstream OpenCode install or mutating the
package-owned `@opencode/cli`. Until that delivery path is implemented and the
installed-package default resolver selects the owned artifact, ordinary CTG
installs continue to use the compatibility runtime and do not receive the UI
features in this patch. This branch does not commit a large executable. The
staging opt-in can be selected by setting
`CTG_OWNED_OPENCODE_RUNTIME` to an extracted artifact directory containing
`ctg-runtime.json`, `SHA256SUMS`, and the platform-specific CLI artifact.
Without that variable, current code resolves the package-owned `@opencode/cli@2.0.32`
dependency with Node's package resolver and reads its `bin.opencode` entry,
working for both nested and npm-hoisted installs. An explicit
`CTG_OPENCODE_BIN`/`--engine-cli` continues to use the exact compatibility-version
path. The packed-install test checks this default path before setting any
override.

## Pinned inputs and reproducible source application

- Upstream: `https://github.com/anomalyco/opencode`
- Tag/revision: `v2.0.32` / `843a6c514e606b436a7fe713422ace0a93ad3d61`
- CTG patch candidate: `docs/patches/opencode-v2.0.32-session-ui-combined-v1.patch` (approved session/runtime + `/help` + live-theme + glyph-v4, spinner test-isolation fix, real-provider theme integration proof)
- Candidate patch SHA-256: `94a18eece950da260213e66168583f83e44923638f014efa2e58ff74f315bae7`
- Candidate verification: Bun 1.4.2 frozen-lockfile install passed, TUI
  typecheck passed, and glyph/keymap/plugin-theme/real-provider-theme tests
  passed together (19 tests / 186 assertions, one process,
  `--timeout 60000`). Independent review approved exact head
  `70882269e25ebcb62c843f9265345342b9e6844d` and reproduced the frozen install,
  TUI typecheck, and all 19 tests / 186 assertions in one process. Parent
  workflow/runtime/transport checks pass 48/48. The full Linux recipe build is
  authorized and in progress; final artifact acceptance remains pending.
- Workflow registration: independently and parent-approved bootstrap #197
  passed CI and merged on `main` as `bd1292c8c4`. The workflow is registered;
  actual prebuild run `39089640210` was dispatched at reviewed source
  `70882269e25ebcb62c843f9265345342b9e6844d` for planned version `1.1.0`.
  Build results and final installed acceptance remain pending.
- Separate parent-quality follow-up: native CLI browser-launch isolation
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
owned runtime. No release asset has yet been published.

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
be published. The existing `Release` workflow is the post-publication gate: it
requires a published release, performs the full installed acceptance and
five-platform-archive manifest verification with `CTG_RUNTIME_GITHUB_TOKEN` explicitly
empty (proving the ordinary anonymous public resolver path), and only then
publishes the control-plane manifest. Neither workflow creates a release,
uploads assets, publishes a release, or dispatches another workflow. This
sequence is proposed automation until reviewed and run against the final
release artifacts.

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

## Full-TUI glyph compatibility

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

## Recorded artifact and bounded title evidence

No binary has been built from this final composed patch yet. Earlier Linux
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
