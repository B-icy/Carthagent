# Final OpenCode source composition review checkpoint

This review checkpoint composes patches on clean upstream OpenCode `v2.0.32`
source `843a6c514e606b436a7fe713422ace0a93ad3d61`, in this order:

1. Session/runtime patch (pre-composition SHA-256
   `36379e0bf4ec0f63929c12b5ac96dfc73df60b124cef9f4adeb36d86287bc92f`).
2. Approved natural `/help` patch (SHA-256
   `c1ce7d983be8ecdd3481b16da103fb32d144b0ec01f894915a110b46acdc6fe5`).
3. Approved live-theme API patch (SHA-256
   `0bcb1462688c00a09564e9874c3e01429baf92fe004bfc6400704fb24133c123`).
4. Approved glyph-v4 patch (SHA-256
   `37d93c0dfd5c52bd4536136fb53618580a29d682644848433f3b2ee4726d98a4`).

The approved base combined source patch is
`docs/patches/opencode-v2.0.32-session-ui.patch`; its SHA-256 is
`81e86a4c139e02ebd077e1b635a62ea804ec60b6ae20100893cb6d9f73b06d62`. A
separate combined candidate is recorded at
`docs/patches/opencode-v2.0.32-session-ui-combined-v3.patch` with SHA-256
`d0cbfe762eacff15120ec74d489921e359ad97e818376504bca2968b8fbec5db`; it adds
the approved spinner test-isolation and real-provider theme proof patches. The
candidate recipe and packaged runtime identity both pin this digest; the
historical base recipe/runtime identity remain recorded in Git, and the base
patch remains unchanged. Frozen
lockfile installation, TUI typecheck, and the exact combined glyph/keymap/theme/
provider run passed (19 tests / 188 assertions in one Bun process with
`--timeout 60000`). The workflow fixture passed all 6 tests with Node 26 after
updating its patch-path assertion. Independent review approved corrected head
`0e38142bff30ca2a8b2a66394e5055d541fce489`, including an isolated Windows-style
checkout-to-recipe handoff reaching Bun installation and dirty-input rejection.
These source checks do not establish final-artifact acceptance. The three
standalone review patches remain
separately published and unchanged. The base composition was
applied to a clean detached upstream checkout and its reverse-application check
and `git diff --check` pass. The glyph patch’s two `/help`-overlapping files
were integrated by applying `/help` first and glyph v4 afterward; the resulting
autocomplete/prompt imports and keymap test changes are present once in the
combined patch.

Source approvals and author test reports are recorded separately: glyph v4
source approval (11 tests / 146 assertions), `/help` keymap suite (5/5), and
live-theme focused tests/typecheck. These do not approve the combined patch and
do not substitute for an independent composition review. This is a source-review
checkpoint only: do not build until the exact combined patch is independently
approved. The previous v1 patch was built on Linux x64 before the Linux runner
marquee assertion was corrected; that binary is historical and is not an
artifact for this v2 digest. Final v2 binaries and cross-platform prebuilds,
theme PTY, glyph matrix, `/help`, and title restoration proofs remain outstanding.

The unrelated draft-release asset transport design is intentionally not
implemented by this composition. A separate review must decide whether a
repo-scoped, ephemeral CI credential may be used only for authenticated draft
asset retrieval through the production resolver, preserving the packaged
manifest/digests and default no-override selection. No credential values or
transport code were used here.

Reproducible workflow fixture coverage lives in
`tests/owned-runtime-publish-workflow.test.mjs`. It extracts the literal
validate, verify, and upload Bash blocks from this workflow YAML and executes
them with bounded temporary fixtures. It verifies review-branch prebuild SHA
binding and rejects publish validation from a non-default branch; the positive
publish path verifies five tiny USTAR archives and the packaged trust root,
then a fake `gh` captures exactly seven assets for byte comparison. Tampered
archive and stale annotated-tag cases both assert zero captured uploads. This is
automated mocked workflow coverage, not a real dispatch or release. Although
the fixture accepts a reviewed-branch prebuild SHA, GitHub only registers
`workflow_dispatch` for a workflow file present on the default branch. This
workflow was subsequently registered by reviewed bootstrap #197, merged as
`bd1292c8c4` after green CI. Parent dispatched real prebuild run `39089640210`
against exact source `70882269e25ebcb62c843f9265345342b9e6844d` for planned
version `1.1.0`. Its build results remain pending.

This focused TUI candidate verification is not the parent repository's full
quality run and does not include the separate native CLI test-browser isolation
change `d4983b57328a187e8be6bc0e2c6bd2dda7518920`; apply or merge that change in
its applicable parent integration lineage before running or claiming parent
full quality. It is not part of this upstream OpenCode patch.

The release workflow permits a non-publishing prebuild from a reviewed branch
to avoid requiring product merge before native candidate generation. It binds
the requested source SHA to that dispatch's exact workflow commit. The publish
phase remains default-branch-only and compares the candidate with the final
tagged package trust root; prebuild is not merge or release approval.

The pinned external release generator still reads the legacy patch pathname.
Both candidate-generation calls therefore copy the candidate patch bytes to
that pathname only inside the disposable CTG checkout used by the workflow;
the checked-in base patch remains unchanged. Fixture assertions cover both
adaptation points.
