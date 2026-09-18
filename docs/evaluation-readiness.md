# Controlled web-delivery evaluation protocol

## Status and spending authorization

This is an evaluation protocol, not evidence that a model delivers complete applications reliably or economically. No paid trials were run for this hardening series. Before any live requests, obtain an explicit aggregate spending cap, per-run allocation, approved providers, retry policy and billing-monitoring owner. Tool/time/repair budgets are cooperative controls, not dollar caps. Stop admission before the remaining allocation is insufficient for a request; do not assume cancellation refunds an in-flight request.

## Freeze the experiment

Record repository commit, lockfile, runtime and browser versions, OS, task prompt, model configuration, harness configuration, independent acceptance suite and its hash. Use fresh isolated worktrees and least-privilege credentials. Keep the acceptance evaluator outside the agent-writable workspace. Do not replace failed validators with easier checks. Record every task attempt, including infrastructure failures, refusals, exhausted budgets and incomplete results.

Compare baseline and candidate on the same tasks and budgets, with repeated runs and randomized ordering. Declare sample size before inspecting outcomes. Include a small CRUD application, async error/retry UI, authentication/authorization boundaries, persistence, accessibility and an existing-project change. Include Unicode, paths with spaces, malformed input, delayed responses and offline failures. Phones and tablets are outside this platform scope.

## Independent acceptance and repository conformance

For each task enumerate every explicit user requirement and give it an independent observable oracle. Run the target repository's configured lint, formatting checks, typecheck, tests, build and mandatory validators; discover conventions instead of imposing this repository's tooling universally. Report pre-existing failures separately from regressions. Do not perform repository-wide formatting cleanup inside a feature task.

Use real-browser interaction checks for modules and application behavior. Capture startup console errors, exceptions and rejections before navigation; unavailable capture is a failure, not a clean result. Test expected network error states separately from unexpected application errors. Bind executable evidence and review findings to the accepted source snapshot. Screenshots alone are not visual review: record who inspected them, or explicitly mark visual review unperformed.

Review the diff and neighboring architecture for duplicated canonical logic, unnecessary abstractions/dependencies, boundary validation, error handling, cleanup/cancellation, stale async state, unused code and weakened types. Record each finding as severity, location, rationale, resolution and remaining uncertainty. Keep model judgments separate from executable results and human review.

## Metrics and result record

Record task/run ID; all frozen identities; platform; start/end time; admitted tools; repair rounds; provider failures; input/output/cached tokens; actual billed cost; intervention count and minutes; independent acceptance pass/fail; harness success claim; false-success flag; unresolved findings; and links to logs, diff, browser diagnostics and evidence.

Report completion rate, false-success rate (claimed success with independent failure), recovery rate after injected faults, human intervention frequency, maintainability findings by severity, median/tail latency, total cost and cost per independently accepted change. Include spending on failed attempts in total cost. With zero accepted changes, cost per accepted change is undefined, not zero. Publish denominators and uncertainty; do not generalize a single successful task or a token anecdote into model-wide claims.

## Current assurance boundary

The hardening series adds real Firefox error capture and CI, scoped first-party JavaScript lint, actual-engine offline tool/time/repair budget regressions, same-run restoration reconciliation and stale-review rejection. Native Windows/macOS/Linux Node 22/24 CI is distinct from WSL local evidence. WSL Python validation still requires missing local dependencies; native Python CI does not establish WSL Python success.

Outstanding work includes workspace-wide active-run arbitration, live conflict recovery, persistent bounded review-round orchestration, enforced read-only review isolation, machine-validated structured findings, stronger validator/runtime identity and fingerprint coverage, and independent controlled model trials. These are not completed by passing the current test suite. Review timeout and source/head checks are described in [review-assurance.md](review-assurance.md); quality scope is in [quality.md](quality.md).
