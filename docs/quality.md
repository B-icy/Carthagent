# Repository quality and evaluation evidence

For setup and agent-facing instructions, see [AGENTS.md](../AGENTS.md).
Run `npm ci` in a fresh checkout, followed by `npm run quality`. The quality
command runs lint/typecheck, build and Node regressions. Native Windows, macOS
and Linux CI also runs Python and native integration gates separately. A
separate Linux browser job runs `npm run test:browser` with the bundled
Chrome headless shell and retains screenshots as diagnostic artifacts, not
evidence of manual visual approval.

ESLint recommended rules cover first-party `.mjs` source, tests and tooling;
TypeScript ESLint recommended rules cover `plugins/**/*.ts` and
`plugins/**/*.tsx`. On top of those, ESLint enforces complexity, nesting depth,
file length, parameter count, naming and import boundaries; violations that
predate these rules are recorded in `eslint-suppressions.json` and may only
shrink. Prettier formats all JavaScript and TypeScript (`npm run format:check`
runs as part of `lint`). The typecheck command separately checks legacy
extensions and the native plugin. Vendored code, scenario fixtures, generated
artifacts and public assets are excluded from lint; this is not a claim that all
repository languages are linted.
Unused parameters/caught errors and deliberately underscore-prefixed bindings
are permitted. Empty catch blocks remain permitted for established best-effort
cleanup patterns.

CI additionally runs `npm run check:repo` (file sizes, debt markers,
duplication, unused dependencies, version drift, feature-flag lifecycle,
generated API docs, AGENTS.md validation), build timings against
`tools/build-budget.json`, the credential-free QA smoke, and coverage
thresholds on Linux/Node 24 with JUnit timing reports uploaded as artifacts.

## Every implementation and evaluation

1. Discover repository instructions and configured lint, format, type, test and
   production-build commands. Use the target repository's conventions, not carthagent's
   style by default. Do not weaken existing validators.
2. Run those gates and focused behavior/failure-path regressions. Report missing
   gates and pre-existing debt explicitly; do not silently call them passing.
3. Review the actual diff: architecture, canonical implementations versus
   duplication, validation boundaries, error handling, async cleanup, unused
   code, dependencies, type weakening and public-behavior tests.
4. Record findings with severity, path/line, rationale and resolution. Bind the
   review to the commit/source fingerprint; edits invalidate the review.
5. Report functional evidence, repository conformance, review findings and
   unreviewed areas separately. A model review is not executable evidence.

Maintainer checklist: no unrelated churn; no blanket lint suppression; clean
failure/cleanup paths; bounded diagnostics; honest platform and visual claims.
Paid model comparisons additionally require an explicit spending cap and
independent task acceptance checks. Passing lint does not prove maintainability,
security, completeness or a favorable cost per accepted change.
