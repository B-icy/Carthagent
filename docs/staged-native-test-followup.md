# Staged native first-use test follow-up

Combined v18 preserves the production source from v17 and corrects seven stale
model/provider label expectations in two renderer test files. It does not
activate a runtime, alter a timeout, remove an assertion, or change a release pin.
The frozen v17 patch and its local binary remain unchanged.

The product test suite also isolates the legacy comet-color fingerprint test in
a truecolor child process when the calling shell uses a reduced palette. This
retains every original animation assertion without changing renderer behavior.
The previous test mistook an idle border's reduced ANSI color for the comet's
distinct RGB color under `TERM=dumb`.

## Source identity

- Pristine upstream: `843a6c514e606b436a7fe713422ace0a93ad3d61`.
- Complete patch: `docs/patches/opencode-v2.0.32-session-ui-combined-v18.patch`.
- Patch SHA-256: `636e01c3da517c64a5f90fb1ea6a682a25fbcb2b63372a8fd2c32ec11fe706dd`.
- Source tree: `ca9b76168f4650384e5d68fff9c7331528ee4abc`.
- Source inventory SHA-256: `09ef6141cf92fbdf341903183507d2e6e4f59d2c2e5b8d09f9474684a2f03212`.

Independent pristine application reconstructed all 8,595 source files with
matching bytes and modes, leaving the real source index unchanged. The exact
tree delta from frozen v17 contains only:

- `packages/tui/test/app-lifecycle.test.tsx`, six expectations.
- `packages/tui/test/session-panel.test.tsx`, one shared readiness expectation.

The labels now expect the intentional separator, for example
`Build · Model · Provider`. The lowercase fallback provider ID remains lowercase.
All readiness predicates, frame budgets, selection checks, and later behavioral
assertions are retained. A structural regression test compares complete patch
sections and permits only these seven string replacements.

## Validation

The initial full native TUI run completed with 1,653 passed, 17 failed and two
skipped across 195 files. All reported failures stopped at these stale label
predicates. After correcting the expectations:

- Focused app-lifecycle and session-panel suites: 50 passed, zero failed
  (48.74 seconds).
- Complete native TUI suite: 1,670 passed, zero failed, two skipped across
  195 files (282.39 seconds), using the normal 30-second per-test budget.
- Scoped native oxlint: zero warnings or errors.
- v16/v17/v18 packaging boundary tests: 12 passed, zero failed.
- Follow-up JavaScript lint and whitespace checks passed.
- The legacy comet regression passed under `TERM=dumb`, `NO_COLOR=1`, and a
  truecolor environment after fixture isolation. The first product quality run
  had 1,210 passes, one failure in this test, and five skips. The complete
  `npm run quality` rerun passed: 1,211 tests, zero failures, five skips, with
  lint, syntax and product typechecks passing. Native TUI `bun typecheck` passed.

These are source and renderer checks, not new binary or multi-platform release
acceptance. The installed-package gate (`--require-owned`) passed all 28 probes
against its unchanged default v15 runtime in an uncontended rerun. Its prior
startup connection-timeout failure remains recorded; the failing probe passed
unchanged in 14.481 seconds. This does not establish candidate-runtime installed
acceptance or prove the timeout cannot recur under contention.

Local audit evidence is under
`/home/factory-droid/ctg-firstuse-runtime-20261118/followup-source/`.
The v17 executable is not relabeled as a v18 build. Existing local acceptance
uses external candidate trust, not the product resolver. The default installed
package still selects v15. No release, workflow dispatch, or runtime promotion
is included in this source-only follow-up.
