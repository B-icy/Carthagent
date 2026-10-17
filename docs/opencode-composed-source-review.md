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

The combined source patch replaces
`docs/patches/opencode-v2.0.32-session-ui.patch`; its SHA-256 is
`81e86a4c139e02ebd077e1b635a62ea804ec60b6ae20100893cb6d9f73b06d62`. The
recipe and packaged runtime identity pin this exact value. The three standalone
review patches remain separately published and unchanged. The composition was
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
approved. Final binary, theme PTY, glyph matrix, `/help`, and title restoration
proofs remain outstanding for the composed source.

The unrelated draft-release asset transport design is intentionally not
implemented by this composition. A separate review must decide whether a
repo-scoped, ephemeral CI credential may be used only for authenticated draft
asset retrieval through the production resolver, preserving the packaged
manifest/digests and default no-override selection. No credential values or
transport code were used here.

The corrected publish verification shell block was extracted directly from the
workflow and run against a disposable fixture containing five tiny valid USTAR
runtime archives and build records, generated through the pinned manifest
generator against a fixture final-package trust root. With canned, read-only
`gh` run metadata, the untouched candidate passed through manifest regeneration
and reached `candidate=verified`. Appending bytes to the Linux archive made that
same extracted block fail at `sha256sum -c` before writing the verified output.
The fixture and mocks contain no credentials and are outside the repository.
