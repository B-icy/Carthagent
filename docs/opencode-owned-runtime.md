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
- CTG patch: `docs/patches/opencode-v2.0.32-session-ui.patch`
- Patch SHA-256: `36379e0bf4ec0f63929c12b5ac96dfc73df60b124cef9f4adeb36d86287bc92f`
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

The CTG workflow in this branch is a proposal, not release evidence: it builds
on native runners and can attach platform archives to an existing release, but
it has not been run or approved. There is no signed/attested end-user download
channel, and no default-selection or normal-install behavior is switched.
Distribution is therefore not complete until the workflow is reviewed, run
under the release environment, publishes the patch/recipe and matching
per-platform runtime artifacts plus checksums/manifest, and the installed
package opt-in is tested against those published artifacts.

When a release is still a GitHub draft, CI may opt in to authenticated asset
retrieval by setting `CTG_RUNTIME_GITHUB_TOKEN` for the resolver/verifier
process. This transport is optional: without it, installed products use the
normal anonymous public release-download URL. With it, the token is used only
for read-only `GET` requests to the fixed `api.github.com/repos/B-icy/Carthagent`
release and asset APIs. The transport requires one exact `v<packaged-version>`
release and one exact expected asset name; it does not fall back to public
downloads if the requested draft release or asset is absent or ambiguous.
GitHub asset redirects are followed without forwarding the credential. The
token is removed from runtime and workspace child environments, and the
existing packaged runtime-release manifest remains the sole source of archive,
executable, and provenance trust pins. The normal no-token installed-package
acceptance remains required after publication.

## Full-TUI glyph compatibility

The pinned full TUI did not provide a public equivalent of CTG's legacy
`--ascii` / `--glyphs auto|ascii|unicode` contract. The assigned glyph patch is
being developed separately against the pinned source; it must be composed into
the final patch and rebuilt before this runtime can claim ASCII compatibility.
OpenCode's documented `mini.mono` setting applies to Mini mode only and is not
a substitute for the full workspace TUI.

The implementation contract for the owned-host change is deliberately
narrow: introduce or use a central registry for **host chrome glyphs** (borders,
selection/status markers, spinners, and structural tree/connector marks) and
resolve the mode once for the full TUI. In ASCII mode, map only those registered
chrome tokens to readable ASCII alternatives with compatible layout; preserve
theme colors and typography. Never sanitize or transliterate arbitrary rendered
strings, user messages, filenames, diffs, shell output, or code. Unicode mode
must remain unchanged. Auto detection and explicit overrides must be specified
and tested on the actual full TUI, including unknown/legacy terminals; Mini's
setting and platform guesses alone do not satisfy this contract.

Any glyph patch changes the source-patch digest and invalidates the current
binary, manifest, and title evidence; rebuild and revalidate the exact resulting
artifact before making terminal-compatibility claims.

The normal full-TUI `/help` contract is also not established as CTG-owned.
Autocomplete currently selects OpenCode Host Help; invoking `/ctg-help` or a
submitted command with arguments does not prove bare `/help` parity. The exact
final binary must demonstrate the agreed bare-help UI behavior before that is
claimed.

## Recorded artifact and bounded title evidence

The fresh Linux artifact was built from a clean detached worktree of the pinned
source with the exact patch hash above. It is at
`/tmp/opencode/ctg-final-runtime-build/resume-build/packages/cli/dist-ctg/cli-linux-x64/bin/opencode`:

- `--version`: `opencode v0.0.0-ctg.2.0.32`
- SHA-256: `85bb44a65e8c185f4f33d41507d29acc77f2db0cdcb0103a14476021c8e43794`
- Build recipe: `script/ctg/build-owned-runtime.sh opencode-linux-x64`
- Source patch hash: the pinned hash above
- Manifest lock SHA-256: `9d78379cd264584a495440a217b9d2ecab524c9a56f7f8b4b5bed3926daa330d`

This exact-patch executable's headless PTY emitted the VT title-stack save
(`ESC[22;0t`) and title OSC sequence. The smoke probe terminated with Ctrl-C,
so no restore sequence was observed; title restoration and physical terminal
readback remain unproven. Any glyph/help source change requires a new artifact
and a repeated title test.

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
