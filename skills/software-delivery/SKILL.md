---
name: software-delivery
description: Complete substantial software implementation from one prompt: CLIs, services, web apps and multi-file refactors. Use for acceptance contracts, vertical slices, process-level integration tests, platform/encoding failures, and evidence-backed handoff.
---
# Large-task delivery

One user prompt can require many small implementation and verification turns. Prefer complete, testable behavior over generating a large code dump.

## Pipeline

1. **Inspect & identify knowledge.** Inspect the repository, current tests, dependency manifests, runtime versions, and actual APIs. Identify which domain skills or knowledge bases apply — check the available skills list and read the matching skill before implementing. Look for existing patterns, dependencies, and conventions you can reuse rather than reinventing. Establish the user's observable requirements and sensible scope. Don't silently delete requirements when tools fail.

2. **Plan.** Use `delivery_plan` before implementation: a few steps, explicit assumptions, source/test/config/documentation roots (usually `["."]`), and 2–4 check suites. Reuse a check suite across acceptance criteria. D2 is emitted automatically; use D2 for other flowcharts.

3. **Pressure-test the plan.** Before writing code, review the plan against every explicit requirement in the user's prompt. Verify uncertain APIs with installed source or a tiny executable probe. Confirm the declared checks can actually detect failure. If the plan is weak or incomplete, call `delivery_plan` again to fix it — the plan is a living contract, not a one-time artifact.

4. **Develop.** Get one vertical slice running early: CLI command -> output/file; request -> handler -> response; UI action -> state -> visible feedback. Keep logic separable from infrastructure. Mark progress with `delivery_progress` as each step finishes so the plan panel stays current. If development reveals a wrong assumption or a step can't be completed as planned, call `delivery_plan` again to adjust — update steps and checks to match reality, but never silently drop original acceptance criteria. Implement remaining requirements, failure behavior, dependency pins, and README commands. Check uncertain APIs by reading installed implementations or running a tiny probe. Don't add tests requiring an uninstalled framework; use the existing framework or standard-library tools.

5. **Verify.** Verify like a user, in a **fresh process with the normal environment**, not just by calling internal functions. Use `delivery_check` with `id="all"`. Keep generated output under `artifacts/` so it doesn't invalidate source fingerprints. Do not edit while checks run. If checks fail, read the quoted output, repair the root cause, and rerun. If a check failure reveals the plan was wrong, adjust the plan first, then re-verify.

6. **Deliver.** Review behavior, failure paths, data integrity, usability, performance and scope. Repair root causes, add regression tests, rerun stale checks, then `delivery_finish`. A blocked report is preferable to a false verified report.

## General pitfalls

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
