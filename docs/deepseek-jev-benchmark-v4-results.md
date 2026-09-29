# V4: all nine task runs evaluated

## Bottom line

All 3 tasks × 3 arms were attempted once in the frozen v4 matrix, with no candidate retries, source repairs, or evaluator feedback to generators. All nine retained outputs were externally evaluated. **Plain pi and Carthagent+Jev each passed 25/25 external categories; Carthagent without Jev passed 16/25.** These are category counts, not exhaustive correctness scores or statistical evidence of Jev superiority.

The strongest observed operational difference was completion: **plain pi delivered final answers for voxel and ledger; no harness-arm run reached final handoff**. Five harness runs hit the frozen request-size ceiling; the sixth hit per-response output length. Plain shop hit the 15-minute deadline. Consequently there is no clean fully completed three-way comparison, even though every cell now has an evaluated artifact outcome.

## Protocol and provenance

- Execution commit `e157563`; source freeze under `/home/baissi/benchmarks/deepseek-jev-v4/freeze.json`. Actual frozen hashes reverified after all nine evaluations. Freeze format version 3; attempt identifier v4.
- Same installed pi 0.85.1 engine and generator `deepseek/deepseek-v4.1-flash`, high reasoning, all arms. Plain includes the identical benchmark-only budget guard, not delivery planning. Treatments add Carthagent delivery extension/skill and optionally Jev.
- Separate Jev Decisions calls: returned `typesafe/jev-1.13-20260917`. No generator router.
- Frozen ceilings: 900 seconds, 120 tool attempts admitted by benchmark guard, 100 paid requests including up to 3 Jev calls, 16,384 output tokens/request, 400KB incoming / 402KB reconstructed request envelope, $2.79/cell. Compaction disabled. See `deepseek-jev-benchmark-v4-protocol.md`.
- Earlier v1–v3 attempts, defects, unknown charges and partial candidates remain retained and disclosed. V4 is not an independent replicate of a silently discarded experiment.

## Results

| Task | Arm | External categories | Terminal outcome | Time | Tool starts | Known API cost | Candidate-owned tests |
|---|---|---:|---|---:|---:|---:|---|
| Voxel | Plain pi | **8/8** | Final answer completed | 284.3s | 28 | $0.04217 | Pass: 15 unit + 8 HTTP |
| Voxel | Carthagent | **0/8** | Output-token limit | 276.7s | 22 | $0.03834 | Cannot run: no Cargo.toml |
| Voxel | Carthagent + Jev | **8/8** | Input-byte limit | 332.5s | 36 | $0.05754 | Fail: Rust test code does not compile |
| Shop | Plain pi | **8/8** | 900s wall-time limit | 900.3s | 41 | $0.05119 + unknown hold | Pass: 14 tests |
| Shop | Carthagent | **7/8** | Input-byte limit | 264.5s | 31 | $0.11445 | Fail: referenced test files missing |
| Shop | Carthagent + Jev | **8/8** | Input-byte limit | 255.9s | 53 | $0.12673 | Pass: 13 tests |
| Ledger | Plain pi | **9/9** | Final answer completed | 129.1s | 15 | $0.01526 | Pass: 22 tests |
| Ledger | Carthagent | **9/9** | Input-byte limit | 317.6s | 39 | $0.05291 | 29/30 pass; erroneous assertion |
| Ledger | Carthagent + Jev | **9/9** | Input-byte limit | 321.0s | 32 | $0.05147 | 36/38 pass; erroneous assertions |

Category counts weight unrelated categories equally and must not be treated as percentage of all requirements. Missing runnable voxel/harness accounts for its eight failed categories, not eight separately diagnosed implementation defects.

### Aggregate descriptive numbers (not quality-adjusted rankings)

| Arm | External categories | Final-answer completions | Tool starts | Sum of run time | Known cost |
|---|---:|---:|---:|---:|---:|
| Plain pi | 25/25 | 2/3 | 84 | 1,313.7s | $0.10863 + $0.15 unresolved hold |
| Carthagent | 16/25 | 0/3 | 92 | 858.8s | $0.20570 |
| Carthagent + Jev | 25/25 | 0/3 | 121 | 909.4s | $0.23574 |

Do **not** interpret shorter harness time as greater speed: those runs terminated at resource ceilings, while plain shop spent much of its time debugging its own browser setup until timeout. Time includes tooling, provider latency, and dependencies; provider endpoints differed. Known cost excludes unresolved charges and includes repeated/cache context.

## Detailed observations

### Voxel

Plain and Jev-assisted implementations passed release compilation, deterministic terrain, movement/gravity/jump checks, block interaction checks, invalid/unreachable action nonmutation, save/corrupt-load behavior, changing Rust PPM output, and real Firefox keyboard interaction. Screenshots/frame artifacts were captured; no human aesthetic rating is claimed.

Carthagent-only completed a captured plan review/approval but exhausted a single model response at `length` before a Cargo project was written. It was not stuck at an unapproved gate. Its planning attempts included malformed IDs/schema repair. No post-stop continuation was supplied.

Jev-assisted runtime passed the external checks, but candidate `cargo test` failed on a type/borrow mistake in `src/http.rs:214`. Release compilation excludes that test-only code. External functional pass does not excuse broken promised tests.

### Shop

Both plain and Jev-assisted implementations passed API pricing/filtering/input rejection, orders/idempotency/restart, concurrent inventory, desktop cart persistence, and mobile checkout through native Firefox clicks.

Carthagent-only passed seven categories but failed the native mobile checkout click: `#status` overlaid the checkout button, causing `element click intercepted`. Its `npm test` referenced missing files. Neither was repaired by the supervisor.

Plain pi spent time trying Playwright/browser dependencies, including a missing `libasound.so.2` and broad host-library searches. The external geckodriver/Firefox evaluator worked and all 14 candidate tests passed afterward. Its final deadline occurred while a model request was in flight; the request was canceled, not replayed. Broad host discovery also demonstrates that prompt-based workspace isolation is not an OS sandbox; it does not prove evaluator or credential confidentiality.

### Exact-money ledger

All three passed the independent BigInt oracle checks, including large magnitudes beyond IEEE-754 cent precision, malformed decimal input, normalized idempotency/conflicts, rejected-key reuse, atomic overflow rejection, restart, corrupted-journal preservation, and seeded transfers.

Carthagent-only's failed candidate assertion expected a valid `open` following failed requests to fail, then expected the newly opened account to exist on the next line. That is a contradictory test expectation, not evidence from this test of an implementation bug.

The Jev candidate's two failing tests also contain wrong expectations: 10.00 + 0.50 is **1050 cents**, not its asserted 1025; `compte_é` violates the public ASCII-only account regex, although its test expected acceptance while supposedly testing a Unicode *journal path*. These are concrete test-quality defects despite the external 9/9 runtime score. Source remains unchanged.

## What Jev actually contributed

**Four successful advisory calls**, known combined Jev cost **$0.00107814**:

| Task/revision | SRP probability | DI probability | Tests probability | Topics at >=0.5 |
|---|---:|---:|---:|---|
| Voxel | .33 | .19 | .55 | tests |
| Shop first capture | .32 | .15 | .43 | none |
| Shop later capture | .31 | .15 | .46 | none |
| Ledger | .19 | .13 | .37 | none |

The voxel candidate recorded dispositions about renderer cohesion, the WorldView seam and real-entry-point tests. It incorrectly described the below-threshold SRP/DI probabilities as "flags"; the adapter itself only marked `tests`. Its intended integration tests still contained a compile defect. Other Jev calls produced no above-threshold topics. These probabilities are not calibrated defect likelihood measurements from this benchmark.

The Jev arm's higher external category total than Carthagent-only is **observed, not causally established**. One sampled run per task, different generated plans, endpoint variability, and early stops preclude attributing the difference to four advisory calls. Jev cost was small; generator/context cost and unfinished delivery were the larger operational factors.

## Harness behavior and resource pressure

All six harness runs performed design validation, captured inspection, model-authored review and approval at least once. Schema/reference repairs consumed additional revisions; revisions at termination were voxel 2/3, shop 3/5, ledger 3/3 (without/with Jev). Shop+Jev was re-inspecting its fifth revision when stopped. No harness run called final `delivery_review` or `delivery_finish`; no `verified` delivery is claimed. The harness did not falsely mark these partial outputs complete.

Five harness runs exceeded the local 400KB request body with compaction disabled. This cap counts tool schemas, full plan/review captures, source/tool results, and reasoning replay metadata. It can bind before time, tool, or dollar limits and disproportionately affects verbose planning histories. Therefore this is specifically a **fixed-budget/no-compaction harness comparison**, not an evaluation of a well-tuned compaction-enabled configuration. A follow-up should test bounded planning receipts/context management uniformly and increase neither limits nor memory selectively after seeing results.

## Transparent continuation and raw-status defects

The frozen runner classified input-size refusal as generic `model-error` and stopped after voxel+Jev. A supervisor inspected the receipt and continued **only the six unstarted cells**, with no frozen changes. Shop/plain's wall-time cancellation was classified `infrastructure-error` because its canceled in-flight request retained a hold; after verifying `stopReason=wall-time` and transport `ABORTED`, the supervisor continued **only the three unstarted ledgers**. These are protocol execution adjustments, not retries of failed cells.

All raw result records remain unchanged. Supplemental classification in evaluation/summary files distinguishes `input-byte-limit`, `output-token-limit`, and `wall-time`. For cells skipped by the frozen evaluator's generic model-error rule, supervisor scripts called the **same frozen evaluator functions** on the retained resource-limited outputs. This procedure and its limits are documented at `RESOURCE-STOP-CONTINUATION.md`.

There were **no v4 TLS, malformed-JSON, or upstream non-2xx errors**. The only ambiguous v4 bill is the request interrupted at plain shop's wall-time deadline. The large-body transport fix worked beyond the previously failing size. This is still finite evidence, not a universal network guarantee.

## Billing

- V4 known candidate charges: **$0.5500629984** (includes the four Jev calls).
- V4 unresolved in-flight reservation: **$0.15**, not a confirmed charge.
- Shared candidate accounting after all attempts: conservative recorded debit **$2.2395021996** plus **$0.30** current holds = **$2.5395021996**. The debit includes $1.50 of historical unknown holds seeded during earlier repair, so it is not all confirmed provider spend.
- Known candidate bills across all attempts: approximately **$0.7395021996**. Unknown conservative candidate holds across historical seed/current state: **$1.80**. No account-level/vendor cap guarantee is claimed.
- Known smoke/diagnostic bills: **$0.0104371476** plus **$0.04** unresolved diagnostic hold. Both shared accounts remain below the original $27/$0.10 ceilings.
- Provider endpoints were not fixed: AtlasCloud, Relace, Parasail, Sail Research appeared while model ID remained pinned. This confounds timing/cost comparisons; it is not evidence the generator model ID changed.

## Artifacts and limitations

Root `/home/baissi/benchmarks/deepseek-jev-v4`:

- `summary.json`: all nine cells, raw/supplemental outcomes, scores, time/tools/cost/tokens.
- `matrix.log`, `continuation.log`, `ledger-continuation.log`, `RESOURCE-STOP-CONTINUATION.md` and preserved supervisor scripts.
- Per-cell `events.jsonl`, `gateway.jsonl`, `result.json`, `invocation.json`, `guard.jsonl`, sessions, workspace, `.harness` reports and `advisor.jsonl` where applicable.
- Per-cell `evaluation/result.json`, `candidate-tests.json`, server/build/browser logs, screenshots/PPM where checks reached capture.
- `freeze.json`, `preflight/`, `live-preflight/` preserve readiness and hashes.

Readiness passed 20 benchmark tests and 348 repository tests before execution. The reference/mutant evaluator tests do not make the evaluator exhaustive; voxel regression used a copy of a historical candidate rather than an independently built reference. Screenshots are evidence, not a scored visual review. Acceptance beyond the published assertions can still fail. Same-user shell filesystem access is not sandboxed. Captured reviews remain model-authored, not independent review. No general statistical claim follows from this nine-cell exploratory run.

**Practical conclusion:** plain pi was the most reliable final-delivery baseline in this sample; Jev-assisted Carthagent matched its external functional categories but did not reach handoff and retained test defects. The next harness improvement suggested by these runs is reducing planning/context overhead and finishing verification within bounds—not adding more advisory calls based on this evidence alone.
