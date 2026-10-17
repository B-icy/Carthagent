# CTG-owned OpenCode v2.0.32 UI runtime (opt-in)

This change packages the UI/session extension as a source-pinned, CTG-owned
OpenCode runtime. It does not change CTG's default runtime selection, fetch a
binary automatically, touch a user's OpenCode install/profile, or commit a
large executable. The opt-in runtime can be selected by setting
`CTG_OWNED_OPENCODE_RUNTIME` to an extracted artifact directory containing
`ctg-runtime.json`, `SHA256SUMS`, and the platform-specific CLI artifact.
Without that variable, the existing package-owned `@opencode/cli@2.0.32`
resolver remains in effect. An explicit `CTG_OPENCODE_BIN`/`--engine-cli`
continues to use the existing exact compatibility-version path.

## Pinned inputs and reproducible source application

- Upstream: `https://github.com/anomalyco/opencode`
- Tag/revision: `v2.0.32` / `843a6c514e606b436a7fe713422ace0a93ad3d61`
- CTG patch: `docs/patches/opencode-v2.0.32-session-ui.patch`
- Patch SHA-256: `ade9079bd454087c7fcac6fb3c85bc31636e4bd10a886baafd3c7446e6631788`
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

Use a matching native OS/architecture for other upstream-supported targets;
cross-compilation is rejected. The script fails closed on source revision,
Bun version, patch hash, and `git apply --check`; it applies the patch, runs
the affected typechecks/tests, builds with web UI omitted, and writes
`ctg-runtime.json`, `SHA256SUMS`, and the upstream MIT license into the output.
The runtime resolver validates every manifest contract field, the native
platform, executable checksum, and exact detached `--version` before launch.
It does not search PATH or silently fall back when the opt-in is selected.

The workflow in the companion OpenCode-source change is a proposal, not
evidence that cross-platform CI or a release job has run. No signing,
attestation, release download automation, or default-selection integration is
included. No normal-install behavior is switched.

## Recorded artifact and bounded title evidence

The locally available Linux artifact is
`/tmp/opencode/ctg-parity-prototype/opencode-src/packages/cli/dist-ctg/cli-linux-x64/bin/opencode`:

- `--version`: `opencode v0.0.0-ctg.2.0.32`
- SHA-256: `30a3bb65d4d005c7a12e82d3b97579dc97e451c23b0dac660123f91534c9f484`
- Build recipe: `script/ctg/build-owned-runtime.sh opencode-linux-x64`
- Source patch hash: the pinned hash above

This executable was built before the last handoff-only title lifecycle
adjustment recorded in the source tree. Its earlier focused PTY run observed
one title save, one restore, zero title-stack depth, and a controlled terminal
model ending at `CTG-ORIGINAL-TITLE` on normal exit. This is only evidence for
that executable and controlled model; it is not evidence of physical terminal
title readback or of the final patch's binary behavior. A terminal author
reported an empty final title in another run using an executable identified as
upstream v2.0.32; exact binary hashes have been requested so these results can
be reconciled. Do not claim title acceptance until a focused run identifies
the exact final-patch executable and test model. Picker, resize, and selection
checks are not asserted by that focused title run.

No paid provider traffic or real profile was used for the recorded source and
unit tests. Full two-session state isolation across a server stop/start, and a
local-fixture automatic context-overflow run, remain release gates. Independent
review and product-owner architecture approval are also pending.
