# Technical debt register

Debt is recorded where it can be counted and kept from growing. Each ratchet
below fails on new debt and lets existing debt shrink.

## Debt markers (TODO, FIXME, HACK, XXX)

Policy: a `TODO`, `FIXME`, `HACK` or `XXX` comment in first-party source must
reference a tracking issue, either as `TODO(#123)`, `TODO(owner/repo#123)` or
with a full `https://github.com/<owner>/<repo>/issues/<number>` URL on the same
line. An unlinked marker fails the check.

Scope: tracked `.mjs`, `.js`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts`, `.py`,
`.sh`, `.yml` and `.yaml` files and the `.githooks/` scripts. `vendor/`,
`docs/`, `scenarios/`, `tests/fixtures/` and `tools/benchmark/fixtures/` are
excluded, so fixture data such as the word TODO in
`tests/fixtures/ship-routes.json` is not flagged. Markers count only inside
comments (`//`, `/*`, `*` continuation lines, or `#` for hash-comment files).
The checker and its tests define the marker syntax and are excluded.

```sh
node tools/check-debt-markers.mjs           # inventory + fail on unlinked markers
node tools/check-debt-markers.mjs --json    # machine-readable inventory
node tools/check-debt-markers.mjs --staged  # staged content (used by the pre-commit hook)
```

Current register (2026-11-20): 0 markers (TODO 0, FIXME 0, HACK 0, XXX 0).
`tests/check-debt-markers.test.mjs` also asserts that the repository has no
unlinked marker, so `npm test` enforces the policy.

## Lint complexity and size baseline

`eslint.config.mjs` enforces `complexity` (15), `max-depth` (4), `max-lines`
(500 code lines; 1000 for test modules), `max-params` (6) and
`max-nested-callbacks` (4). Violations that existed when the rules were added
are recorded in `eslint-suppressions.json` (ESLint bulk suppressions), counted
per file and rule. New violations fail `npx eslint .`.

Baseline at introduction: 277 suppressed violations in 97 files
(complexity 195, max-depth 62, max-lines 18, max-params 2). The largest
contributors are `lib/opencode/cli-runtime.mjs` (27), `lib/tui/app.mjs` (23),
`lib/opencode/runtime.mjs` (11), `lib/tui/feed.mjs` (10) and
`plugins/carthagent/src/server/delivery.ts` (8).

When a change removes suppressed violations, ESLint reports unused
suppressions and exits non-zero; run `npx eslint . --prune-suppressions` and
commit the smaller file. Do not add entries for new code: fix the code, or
justify an inline `eslint-disable-next-line` with a reason.

## Oversized files

`tools/check-file-sizes.mjs` fails on tracked files over 1 MiB and on
first-party source files over 1500 lines. Its `EXCEPTIONS` list caps the
current exceptions so they cannot grow:

| File | Ceiling | Debt |
| --- | --- | --- |
| `lib/tui/app.mjs` | 3400 lines | Legacy TUI application; split by screen/command. |
| `tests/opencode-cli.test.mjs` | 2900 lines | Split the CLI suite by command. |
| `plugins/carthagent/src/ui/voyages-art.mjs` | 2200 lines | Separate art tables from renderers. |
| `lib/opencode/cli-runtime.mjs` | 1900 lines | Split runtime orchestration by phase. |
| `tests/opencode-runtime.test.mjs` | 1600 lines | Split the runtime suite by concern. |
| `vendor/agent/**` | 8 MiB per file | Pinned third-party bundle; not edited. |
| `docs/patches/*.patch` | 2 MiB per file | Byte-exact runtime patch stacks. |

A full run warns when an exception is no longer needed; remove it then.

## Duplicate code

`.jscpd.json` scans first-party JavaScript and TypeScript (excluding vendor,
docs, scenarios, fixtures and artifacts) and fails when duplicated lines exceed
2.8%. Baseline at introduction: 2.61% of lines (230 clones, 2346 of 89862
lines). Most clones are in integration probes and tests, for example
`tools/test-native-delivery-host.mjs` and `tools/test-native-host.mjs` (42
lines), `tests/ship-telemetry.test.mjs` (33 lines within one file), and
`lib/opencode/file-lock.mjs` with `lib/opencode/runtime.mjs` (20 lines). Lower
the threshold when duplication drops.

```sh
npx jscpd        # console summary; JSON report in artifacts/jscpd/
```
