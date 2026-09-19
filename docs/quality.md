# Repository quality and evaluation evidence

Run `npm ci` followed by `npm run quality`. Native Windows, macOS and Linux CI
runs lint/typecheck, build and JS/Python regressions. A separate Linux Firefox
job runs `npm run test:browser` and retains screenshots as diagnostic artifacts,
not evidence of manual visual approval.

ESLint recommended rules cover first-party `.mjs` source, tests and tooling.
TypeScript extension checking remains a separate compiler check. Vendored code,
scenario fixtures, generated artifacts and public assets are excluded from this
initial lint scope; this is not a claim that all repository languages are linted.
Unused parameters/caught errors and deliberately underscore-prefixed bindings
are permitted. Empty catch blocks remain permitted for established best-effort
cleanup patterns. No formatting rewrite is required.

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
