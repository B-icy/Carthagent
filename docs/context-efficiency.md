# Delivery context: compact projections, durable obligations

## Implemented

`lib/delivery-context.mjs` owns pure recovery/status/review projections, context byte metrics and conservative archival selection. `lib/context-archive.mjs` owns immutable content-addressed storage. The extension composes these without changing approval or verification policy.

- `delivery_status` no longer echoes full `state.plan.design`, capture, planning history or revision snapshots. It returns exact active acceptance, checks (including argv), outputs, progress, current findings and compact evidence, plus report location and freshness/next-action fields.
- Successful plan-review responses return counts instead of repeating every walkthrough/challenge. Findings, limitations, identity and provenance stay visible; full reviews remain in reports/session entries.
- Large `delivery_design inspect` responses return a **complete capture archive path**, ID/digest/source identity and explicit instruction to read the entire artifact in pages. Small captures retain the previous shape. Full large capture remains in tool `details.deliveryCapture` for trusted advisor consumers; it is not automatically placed into model text.
- After recorded approval, older successful **delivery-only** paired exchanges can become outbound archive references. Keep the two newest eligible exchanges. Failed tool results, reported blocking findings/failed checks, user messages, mixed/code tool turns, unmatched pairs and pending unapproved review contexts stay verbatim. Original session messages and full report history are not rewritten. Archive originals are verified before any replacement; failure retains messages.
- Context rebuild injects a deterministic recovery record. It preserves exact acceptance, required check definitions, outputs, progress, all persistent open blockers and failed check status. It is explicitly **not authority**. Source freshness, approval and completion remain checked by existing policy immediately before execution/finish.
- Native `session_compact` refreshes the same selected run without resetting timers, budget, repair counts or planning state. Branch/session restoration continues through the existing reconciliation logic. A generated summary cannot revive approval.
- `before_provider_request` records numeric category bytes, growth, and labeled bytes/4 token estimate to `.harness/.../context-metrics.jsonl`. No message text is copied. Categories: system, schemas, planning calls, tool results, code calls, reasoning fields, remaining conversation, serialization envelope. Wire formats without messages are conservatively measured as envelope; this is not universal provider tokenizer accounting.
- Above 240KB in the previously observed payload, inject a pressure warning to reserve room for verification/handoff. It does not silently trigger paid calls or change acceptance.

## Compaction: explicit configuration, not a hidden new model call

Native pi compaction remains controlled by the user's engine settings. **This change does not turn it on behind the user's back**, and does not add a second summarizing model. Future comparison runs must enable the same native policy in all arms and charge summarization tokens/time to each cell.

For a 100k-token engine configuration, an initial development setting to validate is:

```json
{"compaction":{"enabled":true,"reserveTokens":40000,"keepRecentTokens":12000}}
```

That requests native compaction around 60k estimated tokens while keeping recent work. These are tuning starting points, **not** a guarantee against a 400KB byte ceiling: escaping, schemas, reasoning metadata and long Unicode/tool results can break bytes/token heuristics. Use the numeric metrics and a preflight that exercises real tool history and compaction before freezing a paid test. A byte-triggered automatic compaction scheduler and incremental plan-authoring APIs remain follow-up work; no implementation or success claim for them is made here.

## Measured offline savings

Applying eligible archive substitutions to the final saved v4 message histories (assuming approved state, with simulated compact archive references) reduced serialized **message-history** bytes by:

| Task | Carthagent | Carthagent + Jev |
|---|---:|---:|
| Voxel | 26.4% | 27.6% |
| Shop | 29.6% | 38.7% |
| Ledger | 48.4% | 50.9% |

Artifact `/home/baissi/benchmarks/context-efficiency/historical-projection.json`. This is an offline potential-savings measurement, not replayed paid runs, live provider tokens, improved correctness, or proof that the old runs would have finished. Post-revision pending review disables archival, so the final-history eligibility assumption can overestimate savings in an actual state. The smaller status/review responses are additional unquantified changes.

## Limits and compatibility

- Exact requirements/checks/blockers are not silently trimmed to a fixed recovery size. A huge contract can still be huge.
- Archive files and reports may contain secrets already present in planning/tool data; no default redaction or zero retention. Archives use 0600 for new files. Same-user access and symlink races against a hostile host are outside the participating-tool boundary.
- Archive pointer/read receipts never certify actual reading or semantic review. The model must explicitly retrieve large captures; all review and approval obligations remain unchanged.
- The ordinary response truncation helper still applies to extremely large non-inspection responses; this change fixes large inspection retrieval specifically, not every possible result. Review/validation finding-list pagination is future work.
- Benchmark advisor now accepts large captures from trusted tool details as well as small capture text. This invalidates historic source manifests for rerun; existing freezes/results remain unchanged evidence.
- No code/test output or user messages are compressed by the deterministic archive selection. Native compaction handles general conversation growth, with the recovery record protecting harness obligations.

Validation includes pure size/invariant tests, real extension gate/restore tests, large-capture retrieval, failure-preserving history projection, numeric telemetry redaction-by-design and repository quality. Native compaction's model-generated summary quality and a paid completion-rate improvement remain unmeasured.
