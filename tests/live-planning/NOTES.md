# Live planning trial notes

## Setup — 2026-09-27

- Testing the modified `/home/baissi/Carthagent` checkout, based on commit `20cb782` plus uncommitted planning changes. The globally installed `ctg` resolves to a different package, so the runner invokes this checkout's `bin/ctg.mjs`.
- Candidate: isolated Git repository at `tests/live-planning/workspace`, seeded by `setup.mjs`. Five packages: shared money, ledger, API, CSV, CLI. No third-party dependencies. This is a small multi-package proxy, **not** a production-scale repository.
- Model explicitly selected: `lattice/gemini-3.8-flash-high` (the existing sticky model). No credentials are copied or printed.
- Fixed initial prompt in `task.md`. Bounded to 90 tool calls, 900 seconds session lifetime, 2 automatic repair rounds, 30-second shell cap. External runner has a 480-second per-invocation termination deadline. A planned follow-up shares the session budget.
- Evaluator-owned validator lives outside the candidate repository. Its base checks are injected as a required validator and visible to the candidate. Follow-up checks are staged, not a hidden/blind benchmark.
- Logs and monitor snapshots are in ignored `runs/`, outside candidate source fingerprint. The runner samples report transitions every two seconds and copies the session JSONL after exit. Sampling can miss brief intermediate states; the full session is the authoritative tool-call record.
- Baseline `npm run quality`: PASS (two existing compatibility tests).
- Baseline evaluator: FAIL, as expected; original arithmetic/validation does not satisfy requested contracts. Logs: `runs/baseline-quality.log`, `runs/baseline-validator.log`.

## Questions being observed

1. Does the agent inspect callers and capture all requirements before editing?
2. Does it prove regression failure before implementing, or merely claim to?
3. Does it use stable structured steps and respond correctly to dependency/check gates?
4. Does it revise the same task for a discovered compatibility constraint without losing evidence/history?
5. Does it run real public-path and required checks against final source?
6. Are output/report contents useful, and is final verification honest?
7. Are failure recovery, context/session restoration and revision UI messages actionable?

## Initial run

Started via `node tests/live-planning/run.mjs initial` at 03:53:12 UTC.

### Observations while running

- Agent inspected the language skill, all five packages, README, scripts and legacy tests, then ran baseline quality and the evaluator before planning. This provides real pre-fix behavioral failures from the evaluator.
- First plan rejected because `artifacts` included the ignored `artifacts/` directory. Agent retried with `["."]`; declared output remained separate.
- Agent read the evaluator source and proactively included its `followup` mode in the initial checks. **Protocol limitation:** the proposed staged numeric-noise requirement was visible too early and cannot serve as an independent subsequent discovery. This is an open-book trial, not a hidden evaluation. Use a genuinely new follow-up instead.
- Initial plan put `quality_check` on the regression-writing step and made implementation depend on that step. The agent's new regression suite initially failed because it imported not-yet-created exports, rather than reaching behavioral assertions.
- Marking the regression step done was correctly rejected: `requires fresh passing checks: quality_check`. Agent used `delivery_revise` with reason `Allow step_regressions to be completed before implementation checks pass`, removed that step's check gate, retained final checks/acceptance, then completed the step and continued.
- This demonstrates useful recovery but exposes missing guidance: distinguish intentionally-red regression milestones from green verification milestones. An import failure alone is weak evidence of a behavioral regression.
- While the money/ledger step was active, agent also edited API and CSV before marking their later step active. Dependency gates enforce declared progress, not actual tool/file scheduling; do not interpret the graph as execution isolation.

### Initial outcome

- Completed in **258.223 seconds**, **45 tool calls**, revision **2**, `delivery_finish status=verified`, process exit 0. Five error results: expected baseline evaluator failure, rejected artifact root, regression import failure, rejected progress gate, and one genuine quality-check failure.
- Quality failure was an overly specific new assertion requiring error `.name === "Error"` even though the implementation threw `TypeError`. Agent changed it to accept the `Error` superclass, retaining the rejection assertion. This is a reasonable test correction, not evidence of silently accepting invalid input.
- Independent post-run checks: **7 repository tests passed**, **9 evaluator probes passed** (8 base + numeric-noise compatibility). Existing legacy test file was unchanged.
- README and migration report were produced; agent actually read the report. Report contains consumer impact, commands, coverage descriptions and limitations, but its test evidence is prose rather than immutable log references.
- No final `git diff` review occurred in either run's tool stream, despite an assertive review/handoff. Passing tests plus prose are not an independent code review.

## Same-session follow-up

Prompt: `followup.md`. New requirement: final-safe debit/credit batches must be accepted regardless of intermediate overflow/order. Evaluator `verify-reconciliation.mjs` was created separately; its command was **not** injected into the candidate's checks. The agent received the behavior and examples, not its grading command.

Before resumption, independent API and CLI probes reproduced rejection of `['90071992547409.91', '0.01', '-0.01']`. Individual/final overflow rejection already passed. Evidence: `runs/initial-reconciliation-probe.log`.

- Completed in **140.608 seconds**, **25 additional tool calls** (**70 total**), revision **4**, verified, exit 0. One provider `Connection error.` at 03:58:55.892 UTC recovered; two additional expected failing regression executions were recorded.
- Same session and run ID preserved: `1dc23193-cc55-4844-a19b-d532a48d266a`. All original acceptance text, user-owned validator and promised output survived. The old completed steps were replaced by a new focused graph; earlier progress remains in revision snapshots rather than current steps.
- Revision 3 (requirement-only change on unchanged source) retained fresh prior evidence: `pendingChecks: []`. This is honest evidence of the unchanged commands, **not evidence that the newly added requirement was already tested**. The agent mapped the new requirement to existing suites before extending those tests. Unfinished structured steps prevented this from becoming immediate finish readiness.
- Once regression source changed, revision 4 reported all three checks pending. Final required evidence was rerun against final source.
- The agent repeated the green-gate-on-red-regression planning mistake, then proactively revised the regression step to have no green gate before marking it done.
- Added a real behavioral failing regression through API and CLI, used numeric probes to understand boundary representation, switched accumulation and decimal formatting to BigInt operations, retained safe individual/final cent limits, updated docs/report and ran all checks.
- Independent final checks: **8 repository tests**, **9 base/noise probes**, and **3 reconciliation probes** passed. `ctg status` showed verified and all three declared checks passed. Evidence: `runs/final-independent-*.log`, `runs/final-ctg-status.log`.

## Counterexample: verified does not establish complete correctness

An exploratory numeric/string-equivalence probe found an **original-scope defect**, which remains deliberately unfixed in the candidate:

```js
handleSummary({ entries: [{ amount: 10000000.03 }] })
// { status: 400, body: { error: 'Amount has excess decimal precision: 10000000.03' } }
handleSummary({ entries: [{ amount: '10000000.03' }] })
// status 200, totalDecimal '10000000.03'
```

Amounts `10000000.04`, `10000000.05`, and `-10000000.03` fail similarly. These are ordinary two-decimal numeric amounts far inside safe-cent limits. A fixed `1e-9` tolerance applied after multiplication by 100 does not account for magnitude-dependent binary representation error.

- Reproduction: from `workspace`, run `node ../verify-numeric-boundary.mjs` (exits 1, **4 failing probes**).
- Logs: `runs/numeric-boundary-probe.json`, `runs/final-independent-numeric-boundary.log`.
- This probe was not supplied to the candidate or made a required validator. We are preserving the counterexample instead of editing the candidate and attributing our repair to the model.
- Verdict: **planning/revision mechanics worked in this trial; full task correctness did not.** The final verified state accurately describes the declared checks, but the model's broad “all requirements implemented” claim exceeds the evidence.

## Recommended next improvements (not implemented during this trial)

1. **Distinguish red and green milestones.** Teach plans to keep regression-capture steps ungated by full green suites, while requiring a real behavior-level red execution and retaining final green gates. Import/syntax failures are insufficient by themselves. A future explicit expected-failure probe must not weaken final acceptance.
2. **Flag newly added acceptance mapped only to old evidence.** On a new requirement, ask for a test/probe change or an explanation that the existing assertions already cover it. Check definitions and source freshness cannot establish semantic requirement coverage. Do not silently discard truthful old evidence; expose this separate review obligation.
3. **Require a concrete review artifact or diff inspection where appropriate.** Current prose review can claim completeness without reviewing the diff or challenging boundary assumptions. Independent/metamorphic probes (numeric vs decimal-string equivalence, permutations, sign symmetry, magnitudes) caught what the self-authored tests did not.
4. **Avoid premature global gates on intermediate implementation steps.** Attach focused suites to component milestones and full repository/consumer suites to the integration join. Otherwise progress is cosmetic or the model must implement downstream work before updating upstream status.
5. **Make report evidence traceable.** Prefer executed command, result, source fingerprint and log references over free-form statements that tests passed.
6. **Improve live headless visibility.** `ctg -p` emitted only final assistant prose for this run; tool activity had to be monitored through the saved session and delivery report. A supported structured-event/log option would simplify monitoring without depending on internal session storage.

## Interpretation and retained evidence

- Two sequential invocations of one model on one deliberately small fixture; no baseline-agent comparison, no blinded grading, no claim of production-scale or statistical improvement.
- Initial evaluator was visible and the agent read it. A planned follow-up leaked through that script and was already handled in the initial run; a different requirement was used for actual resumption. Keep this contamination explicit.
- The provider reported cost 0 despite substantial token usage; pricing metadata is unavailable. **This is not evidence the calls were free.** Raw reported cumulative `totalTokens`: 2,115,461, including repeated context/cache accounting; not a billing estimate.
- Raw session copies, per-check logs, periodic observations, invocations, exit results, independent checks and summary remain locally under ignored `runs/` and `workspace/.harness/`. `runs/summary.json` contains machine-readable metrics. The new fixture, prompts, evaluator probes and these notes can be committed without publishing raw model sessions.
- No production code, credentials or deployment targets were accessed by the fixture workflow. Candidate source was not repaired by the supervising assistant. Parent changes in this follow-up are evaluation scaffolding and notes only.
- After adding the scaffolding, parent `npm run quality` passed (lint/typecheck/build and **322 tests**, zero failures/skips); `git diff --check` passed. The candidate's known-failing exploratory probe is intentionally opt-in and not included in the parent unit-test suite.

