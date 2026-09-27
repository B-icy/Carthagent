# Adaptive delivery planning

The plan is a revisable acceptance contract, not a one-time list of edits. Its job is to retain requirements, discoveries, progress and verification obligations as understanding changes. It cannot establish that the model understood every requirement or wrote adequate tests.

## Tools and lifecycle

- `delivery_plan` starts a task. For compatibility, replacing an active plan is a revision; it no longer erases verification history. After a terminal `verified`/`blocked` report, it creates a distinct task with fresh evidence.
- `delivery_revise({reason, patch})` changes the **same task**, including resuming blocked/verified work. Omitted fields are preserved; arrays supplied in the patch replace the entire field. Keep original acceptance text and promised outputs. A reason records what discovery changed the approach; it does not authorize dropping requirements.
- Revisions keep the run ID, increment revision, clear the old handoff and persist snapshots of prior plans, evidence and progress in `report.json`. Status returns compact revision metadata; compaction context includes assumptions, step progress, revision and the latest reason.
- Unchanged commands, kinds, IDs and deadlines retain fresh evidence only when the full workspace fingerprint and old evidence identity still match. Rebinding records `originRevision` and `executedRevision` and retains the actual log. New/remapped acceptance criteria retain truthful old command results but appear in `unverifiedRequirements` until their mapped suites execute at or after the requirement's introduction. Repeated revisions cannot launder old executions into new coverage. New assertions are still a model obligation, not mechanically proven by rerunning a command. Changed checks need new executions. Failed/stale evidence stays visible without being promoted to fresh; removed/changed checks remain in revision history.
- Once verification has started, revisions cannot erase that fact to downgrade a required task. User-owned required validators are rebound automatically.
- `delivery_check({id:"all"})` runs all declared suites sequentially, collecting ordinary failures before reporting an error. Cancellation and evidence-scope errors still stop execution.
- For required delivery plans, `delivery_status` and `delivery_finish` share completion checks: required checks must be fresh, artifact roots must exist, declared output paths must be files, structured steps must be done, newly added/remapped requirements need fresh executions, and structured required plans need a snapshot-bound `delivery_review` receipt. Informational/advisory plans remain non-blocking. Explicit unfinished legacy progress also blocks finish. Old untracked string-only plans remain compatible.

### Dependency-aware steps

```json
{
  "steps": [
    {"id":"contract","title":"Capture failing API compatibility behavior","kind":"regression","checks":[]},
    {"id":"api","title":"Implement server adapter","dependsOn":["contract"]},
    {"id":"client","title":"Migrate client","dependsOn":["contract"]},
    {"id":"integration","title":"Verify old and new clients","dependsOn":["api","client"],"checks":["integration"]}
  ]
}
```

Define `unit` and `integration` in the plan's checks and map observable acceptance criteria to them. The intentionally-red `kind:"regression"` milestone must have `checks:[]`: reproduce a behavioral assertion failure via a focused shell command and record the result in progress notes, then mark it done. Import/syntax failures do not establish the requested behavior. Keep passing suites on acceptance and the later integration milestone; this avoids the circular requirement to fix code before finishing regression capture. For ordinary work steps, mark done after their mapped checks pass. Numeric indexes still work. Unknown/duplicate IDs, missing dependencies, cycles and missing check references are rejected.

The API and client branches can proceed independently once the contract step is done. Dependency order is enforced by progress updates, not by restricting arbitrary shell commands. Reopening a prerequisite resets downstream progress. Revisions preserve progress only for unambiguously unchanged steps; changed prerequisites reset dependent progress. Legacy strings are matched by unique title rather than old index.

## Traceable final review and monitoring

For structured required plans, `delivery_review({action:"inspect"})` captures `git diff HEAD` without external diff/textconv helpers, plus the full untracked-file list. It returns a capture ID and saved path; read the full file if truncated and inspect new-file contents separately. Git workspaces need a committed baseline and must be the repository root. Non-Git workspaces receive an explicit manual-source-review limitation instead of a fabricated diff.

After fixing findings and rerunning checks, record:

```js
delivery_review({
  action: "record", captureId: "<returned ID>",
  coverage: [{ requirement: "<exact acceptance text>", assertions: "<test cases/assertions covering this behavior>" }],
  probes: ["<additional boundary/metamorphic command and observed result>"],
  findings: [], limitations: ["<honest remaining assurance limits>"]
})
```

Include every criterion, including user-owned validators. Unresolved findings prevent recording: repair them or finish blocked. Source changes or any plan revision invalidate the receipt. The harness handoff stores exact check evidence and review evidence; model-authored output reports remain untrusted. Review descriptions and claimed probes are **self-reported**, not proof that files were read or assertions are adequate. This gate does not replace independent review.

Use `ctg --json -p "task"` for engine JSONL events including tool activity, or `ctg status --json` for a versioned report/fingerprint/completion snapshot. Text `-p` alone is not a live tool stream. Engine event shapes follow the bundled engine; report snapshots and saved logs remain the durable evidence. Treat output as potentially sensitive task data.

## Practical workflows

### 1. Cross-package API evolution in a TypeScript monorepo

**Goal:** add pagination without breaking older clients.

1. Inspect server routes, shared types, generated clients, consumers and workspace scripts. Record compatibility invariants and baseline failures.
2. Capture old response behavior with regression/contract tests. Plan separate server and client branches plus an integration join, as above.
3. Discover a second consumer using a different serialization convention. Revise assumptions and add an adapter step; do not reset already passing evidence if only the plan changed.
4. Implement the adapter with targeted tests. Since source changed, rerun affected suites during development and every declared suite against final source before finish. Include the repository's typecheck/build/lint gates, not just a smoke command.
5. Exercise old and new public clients in fresh subprocesses, then inspect the final diff for unhandled consumers and unrelated changes.

**Automated planning coverage:** dependency gating, stable progress through reordering, shared-config staleness and no fabricated evidence reuse (`tests/planning.test.mjs`).

### 2. Database migration with a discovered backfill risk

**Goal:** introduce a non-null column while preserving data and compatibility during rollout.

1. Record schema version compatibility, backfill size, transaction/locking risks, retry behavior and rollback strategy. Use an isolated test database; a plan does not authorize production migration.
2. Start with schema, backfill and verification milestones. Run a probe against representative old records.
3. If the probe reveals duplicate or partially migrated records, revise the backfill milestone into idempotency, failure/restart and integrity checks. Preserve the original data-integrity acceptance criterion.
4. Reopen affected prerequisites so downstream completion no longer appears valid. Map the final step to migration, rollback/recovery and old-client integration checks.
5. Declare a migration report under `outputs` and inspect its contents. Merely having a report file is not proof of its correctness.

**Automated planning coverage:** changed prerequisite invalidation, failed-evidence history across revisions, blocked-task resumption, missing-output finish gates. These are planning scenarios, not tests of a real database engine.

### 3. Shared-library regression across many services

**Goal:** fix a retry/cancellation bug without changing public behavior.

1. Reproduce the bug with a failing regression; inspect call sites and existing error-handling conventions.
2. Keep a small immediate implementation slice and coarse later integration milestones. Do not write a speculative 40-step plan just because the schema allows it.
3. Run focused unit tests while iterating. Run all declared service suites to collect independent failures in one verification pass instead of discovering one per repair turn.
4. Revise only after identifying the failure cause. Do not remove assertions or change commands merely to make the gate pass. External validators remain authoritative.
5. If an external dependency is unavailable, preserve failing evidence and finish blocked with a specific limitation, rather than reclassifying the work as informational.

**Automated planning coverage:** real subprocess checks continue after an ordinary failure; changed commands invalidate evidence; multiple replans cannot wash away verification history (`tests/extension.test.mjs`).

### 4. Long-running refactor interrupted by context compaction

**Goal:** reorganize a subsystem without behavioral drift over several work sessions.

1. Capture invariants, package boundaries, assumptions and regression suites before moving code.
2. Revise steps as hidden coupling is discovered. Keep stable IDs for unchanged work; avoid relying on numeric position.
3. Resume from the active report. The injected context retains assumptions, progress and the latest revision reason. Full earlier snapshots remain in the durable report.
4. Recheck workspace freshness before claiming success. Existing evidence is not portable across tasks or arbitrary changed workspaces.
5. Use a separate review pass to look for missing requirements and weak tests; a self-authored plan is not an independent review.

**Automated planning coverage:** extension restoration/compaction continuity, cooperative workspace lock and superseded-writer rejection, dashboard revision/finish consistency.

## Limits and deliberate tradeoffs

- Fingerprinting remains whole-workspace and conservative, with existing exclusions and file/byte limits. There is no inferred package dependency graph, scoped test cache, or selective source-change reuse. This costs reruns but avoids hiding changed shared configuration or undeclared callers. Large repositories can adjust `CARTHAGENT_MAX_FILES` / `CARTHAGENT_MAX_BYTES`; scope-limit errors must not become verified evidence.
- A check's `kind` is self-declared. Exit zero, file existence, step status and a prose review do not prove assertion strength, visual quality, data safety or complete requirement coverage. Existing tests, user-owned validators and independent review are still important.
- Declared outputs are existence-gated, not independently provenance-checked. Tests should assert their contents; screenshot files still require actual visual inspection where applicable.
- Original acceptance text and promised outputs cannot be removed by a same-task revision, except when reclassifying a mistaken required plan as informational before verification begins. Legitimate scope cancellation should be explicitly agreed with the user and recorded in a blocked handoff before creating a new task. A terminal new-task reset is an explicit boundary, not protection against a dishonest model.
- Revision snapshots grow the report and session state. Status/context deliberately omit full history, but there is no archive/retention policy yet.
- Locks coordinate participating local tools, not arbitrary edits or distributed workers. See [workspace coordination](workspace-coordination.md).
- Regression scenarios exercise the planning mechanics in temporary multi-package workspaces and real subprocesses. They do **not** establish improved model code quality, lower cost, or success on production-scale repositories; that requires controlled live-task evaluation.

## Verification

```sh
node --test tests/planning.test.mjs tests/extension.test.mjs tests/server.test.mjs tests/tui.test.mjs
npm run quality
```
