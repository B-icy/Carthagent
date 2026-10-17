# Host TUI glyph compatibility review (v4)

## Decision

The standalone owned-host glyph compatibility patch was independently approved
at SHA-256
`37d93c0dfd5c52bd4536136fb53618580a29d682644848433f3b2ee4726d98a4`.
The parent also reports that its full 11-test focused run passed with 146
assertions. This record publishes the reviewed patch and its Unicode source
inventory for later composition; it does not claim that the patch is already
included in the current upstream runtime or in a final binary.

## Artifacts

- Patch: [`../patches/opencode-v2.0.32-glyphs.patch`](../patches/opencode-v2.0.32-glyphs.patch)
  - SHA-256: `37d93c0dfd5c52bd4536136fb53618580a29d682644848433f3b2ee4726d98a4`
  - Source base: upstream commit
    `843a6c514e606b436a7fe713422ace0a93ad3d61`.
- Inventory: [`unicode-inventory-v4.csv`](unicode-inventory-v4.csv)
  - SHA-256: `8727e2cc18f47a3cfe986adc9f721ccaf4bef8f4f39046a7667bc9d6c5bf2fb3`.

The patch changes 74 paths: 72 modified source/test files and two added files
(`packages/tui/src/ui/glyphs.ts` and `packages/tui/test/glyphs.test.ts`). The
independent review described its source-file audit as 72 changed files; the
author's 74-file count includes those two additions. Both figures refer to the
same v4 patch, not different revisions.

## Scope and inventory

The inventory scanned all 245 non-mini `packages/tui/src` TypeScript and TSX
files. It records 401 Unicode-bearing source lines in 77 files, with zero
unclassified rows. The classifications distinguish known host chrome from
dynamic/user/model/code content, examples, and comments. Mini remains out of
scope except where shared with the full TUI. Unicode remains the default;
`auto` stays Unicode until a launcher resolves it. Only known static chrome is
mapped, preserving dynamic text, paths, shell output, and diffs.

## Review and validation evidence

- Independent review approved the exact v4 patch hash above. Its blocking v3
  findings (missing `chromeEllipsis` imports) are fixed in the three affected
  consumers: `dialog-session-list.tsx`, `prompt/autocomplete.tsx`, and
  `prompt/index.tsx`.
- Focused tests: 11 passed, 0 failed, 146 assertions. The session-list test
  executes the relative-path truncation helper in ASCII and Unicode modes and
  checks that dynamic path characters remain intact.
- Glyph-helper binding audit: zero missing bindings across the patch's 74
  changed paths (including the two additions).
- TypeScript transpilation: 74 changed TS/TSX files, zero transpilation errors.
- `git diff --check`: passed.
- Typecheck was compared against the pinned upstream base, not treated as a
  clean pass. Both base and v4 emitted exactly the same single diagnostic:
  `src/plugin/api.tsx(152,3): error TS2741: Property 'transcript' is missing in
  type ... but required in type 'Context'.` No changed-file diagnostic
  remained. Captured outputs:
  [`typecheck-base.log`](typecheck-base.log) and
  [`typecheck-v4.log`](typecheck-v4.log).

Commands used for the focused checks (from `packages/tui` in the isolated
upstream worktree):

```sh
/tmp/opencode/ctg-parity-prototype/bun-dist/bun-linux-x64/bun test --timeout 30000 test/glyphs.test.ts
/tmp/opencode/ctg-parity-prototype/bun-dist/bun-linux-x64/bun /tmp/opencode/audit-glyph-bindings.ts
/tmp/opencode/ctg-parity-prototype/bun-dist/bun /tmp/opencode/transpile-changed.ts
git diff --check
```

The test result above is the owner's run. The binding and transpilation audits
were run from the isolated source worktree. The workspace typecheck command
was `tsgo --noEmit --pretty false -p tsconfig.json` on both base and v4; the
captured logs preserve the complete (single-line) diagnostic. These checks are
source-level evidence only and are not a final composed-runtime or release
binary validation.

## Composition boundary

The migration product branch may separately own composition into its runtime.
This documentation-only review change intentionally does not alter build or
release recipes, CLI resolution, CTG integration code, or the source patch
payload. The immutable patch and inventory should be the inputs to that
composition; do not edit this published v4 revision in place. Any source
revision requires a new patch filename and digest.
