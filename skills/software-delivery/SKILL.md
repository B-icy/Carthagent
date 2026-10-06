---
name: software-delivery
description: Complete substantial software implementation from one prompt: CLIs, services, web apps and multi-file refactors. Use for acceptance contracts, vertical slices, process-level integration tests, platform/encoding failures, and evidence-backed handoff.
---
# Large-task delivery

One user prompt can require many small implementation and verification turns. Prefer complete, testable behavior over generating a large code dump.

## Pipeline

1. **Inspect & identify knowledge.** For structural questions, use `code_nav` definition/symbols/outline, then callers/importers, then targeted source reads. Inspect graph coverage and nextOffset; name-based call matches are candidates, not runtime binding proof. Filter by path/container or paginate. Use grep for strings, routes, SQL and unsupported languages. Inspect nearby tests and dependency manifests, read applicable domain skills, and preserve every observable requirement. Do not exhaustively read the repository before proposing a contract.

2. **Plan.** Use `delivery_plan` before implementation: a few steps, explicit assumptions, source/test/config/documentation roots (usually `["."]`), and 2–4 check suites. Reuse a check suite across acceptance criteria. D2 is emitted automatically; use D2 for other flowcharts.

3. **Pressure-test proportionally.** Follow the selected workflow. Standard mode permits implementation after a valid complete contract; challenge requirements and checks without mandatory architecture paperwork. Strict mode requires `delivery_design` validate → inspect → review → approve with architecture, ports and scenarios; revisions relock it. Bounded Node/npm versions are available through delivery_probe; other APIs can be read. Revisions preserve omitted fields, merge design/workflow object fields and replace supplied arrays. Changed checks require new evidence; never remove obligations to manufacture success.

4. **Develop.** Get one vertical slice running early: CLI command -> output/file; request -> handler -> response; UI action -> state -> visible feedback. Keep logic separable from infrastructure. Mark progress with `delivery_progress` as each step finishes so the plan panel stays current. If development reveals a wrong assumption or a step can't be completed as planned, call `delivery_revise` to adjust — update steps and checks to match reality, but never silently drop original acceptance criteria. Implement remaining requirements, failure behavior, dependency pins, and README commands. Check uncertain APIs by reading installed implementations or running a tiny probe. Don't add tests requiring an uninstalled framework; use the existing framework or standard-library tools.

5. **Verify.** Verify like a user, in a **fresh process with the normal environment**, not just by calling internal functions. Use `delivery_check` with `id="all"`. Keep generated output under `artifacts/` so it doesn't invalidate source fingerprints. Do not edit while checks run. If checks fail, read the quoted output, repair the root cause, and rerun. If a check failure reveals the plan was wrong, adjust the plan first, then re-verify.

6. **Deliver.** Review behavior, failure paths, data integrity, usability, performance and scope. Repair root causes, add regression tests, rerun stale checks, then `delivery_finish`. A blocked report is preferable to a false verified report.

## Adaptive planning across packages

Map affected callers, package boundaries, shared configuration and baseline test failures before changing code. Record compatibility invariants, uncertain assumptions and rollback strategy. Keep near-term slices detailed and later work coarse; expand milestones after discoveries rather than predicting every edit up front.

Use structured steps `{id,title,dependsOn:[],checks:[]}` when order or evidence matters. Independent branches can proceed separately; dependent steps cannot start before prerequisites finish. Mark steps done only after mapped checks pass on current source. Reopening a prerequisite resets downstream progress. Stable IDs preserve unambiguous progress during revisions; all structured steps must be done before finish.

For an intentionally failing regression milestone, use `kind:"regression",checks:[]`; run the focused probe via bash and record its behavioral assertion failure in progress notes. Import/syntax failures are not sufficient. Retain green suites on acceptance and the integration milestone. New/remapped acceptance needs new assertions and new check executions, not just retained old command evidence. Add a regression that fails before the fix. Run focused tests while iterating, then public-path integration tests and existing repository quality gates. `delivery_check id="all"` collects ordinary failures across all requested suites. Use `delivery_review action="inspect"` to capture the real final diff, read it and all listed new files, and inspect unrelated edits and missing consumers. Run additional boundary/metamorphic probes: vary magnitudes, signs, extremes, equivalent representations and order where relevant. After repairs and fresh checks, inspect again and `delivery_review action="record"` with the capture ID, per-criterion concrete assertions, probe commands/results, empty unresolved findings and honest limitations. Structured required plans cannot finish without this snapshot-bound receipt. Claimed review content remains model-authored, not independent proof. See [adaptive planning scenarios](../../docs/planning.md) for examples and assurance limits.

## General pitfalls

- Reuse the installed test runner. For isolated TypeScript/framework routes, consider node:test + existing TypeScript transpilation + explicit mocked imports before inventing ESM loaders. Prove one minimal import first. After two failed infrastructure probes, inspect full stderr and change one hypothesis. Run tests directly: output pipelines must not mask the original exit code. Do not upgrade unrelated dependencies or manufacture ambient types merely to obtain a green typecheck.

- Test exit codes, stdout/stderr separation, filesystem side effects, paths with spaces, alternate cwd, and repeat invocations. Use subprocess argument arrays; shell quoting is platform-specific.
- Test non-ASCII text (not just accented Latin) through the actual command with captured stdout. On Windows, stdout may use a legacy code page even when files are UTF-8. Don't make only the test environment UTF-8 and claim the default executable works — either emit ASCII-safe output or configure the application's UTF-8 output explicitly.
- Reject malformed schema as well as malformed syntax. Avoid coercing booleans to integer IDs. Test duplicate records, missing files, invalid identifiers, whitespace-only values, and idempotency where relevant.
- Write to a temporary file in the destination directory, flush, then atomically replace. On failure leave the previous bytes untouched and clean up temporary files. Never discard corrupt user data to make a test pass.
- Import safety: a subprocess should import the module without starting a service/window, parsing unrelated argv, writing files, or printing output. Guard entry points so importing the module doesn't execute the main logic.

## Other task types

- Games/GUI: read the game-development skill for real-renderer verification and input smoke tests. Never substitute a hand-drawn image for a renderer screenshot.
- Web: test real browser actions, empty/loading/error states, keyboard focus and screenshots; do not mistake a dev server's readiness for correct UI.
- Services: boot/readiness, schema validation, failure status codes, persistence and shutdown; avoid unauthorized live integrations.
- Refactors: preserve the public contract and existing tests, add a failing regression first, keep changes scoped, examine the final diff.

## Evidence discipline

Checks written by the same model can share its blind spots. External behavioral tests and visual inspection are separate evidence. A passing gate proves recorded commands passed on the current project, not that all requirements are objectively satisfied. Never remove assertions, relabel runtime work as static checks, or narrow the contract to achieve a green status. If context compacts, retrieve `delivery_status` and continue from the durable contract.
