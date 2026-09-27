# Assurance follow-up trial — 2026-09-27

## Scope and evidence

Fresh separate candidate repository: `workspace-assurance/`; original `workspace/` and original trial logs untouched. Runner uses checkout CLI with `--json`, same `lattice/gemini-3.8-flash-high`, same prompts/required base validator and 90-tool/900-second shared session budget, plus 480-second invocation deadline. No candidate edits were made by the supervisor. No candidate dependencies installed or commits/deployments performed.

Logs retained locally under ignored `runs/assurance/`: JSONL engine stdout, session snapshots, invocation/results, report observations, independent checks and final candidate patch. Raw events may contain task data and are not committed.

This is an open-book trial: candidate read `verify.mjs`, including its numeric-noise mode. The new broad magnitude evaluator was written by the supervisor after the initial candidate completed and was not injected into its declared checks or prompts. It was run during the follow-up without editing candidate source, then rerun after completion. This is not an isolated/blind benchmark.

## Results

| Invocation | Elapsed | Tool calls | Revision | Declared outcome |
|---|---:|---:|---:|---|
| Initial | 278.284 s | 51 | 1 | verified, exit 0 |
| Same-task reconciliation follow-up | 154.973 s | 30 more (81 total) | 2 | verified, exit 0 |

Same run: `b7029846-e79b-41dc-88ff-bd2c48d982cd`. Session: `01a0e44b-5677-7548-8a00-b7dedbe8b099`.

Independent final reruns:

- Repository `npm run quality`: passed (10 tests); original legacy test file unchanged.
- Base and numeric-noise public contract: 9 probes passed.
- Reconciliation: 3 probes passed, including intermediate overflow with safe final total.
- Original numeric boundary regression: 4 probes passed (`±10000000.03`, plus `.04` and `.05`).
- **New magnitude sweep: 144 cases, 8 failures.** Numeric/string equivalence fails around ±10¹⁰. The candidate changed the fixed tolerance from the earlier trial's `1e-9` to `1e-6`; this moved the failure boundary rather than solving scale-dependent floating-point error. Retained evaluator: `verify-magnitudes.mjs`; retained failures: `runs/assurance/final-independent-magnitudes.log`.
- Final `ctg status --json` still reports verified and empty completion issues. That means recorded gates and self-review completed, **not full correctness**.

Provider-reported cumulative totalTokens: 3,572,694, including repeated context/cache accounting. Reported cost zero has missing-pricing ambiguity and is not an invoice or proof of free execution.

## Observed improvements

1. Both regression milestones used `kind:"regression",checks:[]`; there was no earlier red/green planning deadlock. The initial regression reached actual behavioral assertions. In the follow-up, a bad test edit first caused a syntax error; the candidate repaired the syntax and observed a behavioral reconciliation failure before implementing.
2. Follow-up used one `delivery_revise`, preserving run identity, original acceptance, required validators and promised report. New requirement executions are enforced separately from retained command results (also covered by unit, extension and HTTP tests).
3. Candidate ran focused tests during implementation rather than only one final all-checks pass. One premature progress update was rejected for missing fresh gates; candidate ran all checks and recovered without dropping them.
4. Both invocations used `delivery_review inspect` and `record`; final handoff includes snapshot-bound review and exact check evidence.
5. `--json` streamed parseable tool starts/results and messages live. Monitoring no longer depended solely on polling session storage.

## Remaining assurance limits

- Review coverage often described implementation rather than naming concrete assertions. The candidate recorded a receipt but did not discover the broader numeric defect. There was no fresh extra boundary command between final inspect and record; it relied on earlier probes. The tool validates receipt identity and required fields, **not whether model-authored claims are true or adequate**.
- Some downstream code was written before upstream progress bookkeeping. Dependencies gate progress, not arbitrary edits.
- One pre-plan numerical probe hit the existing shell-inspection budget. One provider connection error recovered. Neither is hidden from the saved logs.
- Declared model-written migration-report content remains untrusted; harness-owned handoff evidence is separate.
- This is a small, single-model, non-blind trial without a randomized baseline. It does not establish production-scale effectiveness or statistically improved correctness.

## Reproduce without overwriting evidence

```sh
CTG_TRIAL=another-name node tests/live-planning/setup.mjs
CTG_TRIAL=another-name node tests/live-planning/run.mjs initial
CTG_TRIAL=another-name node tests/live-planning/run.mjs followup
cd tests/live-planning/workspace-another-name
npm run quality
node ../verify.mjs followup
node ../verify-reconciliation.mjs
node ../verify-numeric-boundary.mjs
node ../verify-magnitudes.mjs
node ../../../bin/ctg.mjs status --json
```

Prompts, provider/model and limits are visible in the runner. Each trial requires configured credentials and spends provider usage; limits are not a billing cap. Candidate bug fixes, if requested, must be separate recorded trials, not retroactive edits to these results.
