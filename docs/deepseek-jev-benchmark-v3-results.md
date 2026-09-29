# V3 matrix execution: stopped on upstream HTTP 400

The user authorized execution after the readiness repairs. The v3 matrix was launched with the frozen implementation at commit `90b25c9`; the actual 954-file freeze was verified before launch and after the stop. No source/evaluator changes or candidate repairs were made during the attempt.

## Outcome

- First cell: voxel / plain pi + `deepseek/deepseek-v4.1-flash`.
- Runtime: **115.105 seconds**; **11 observed tool starts**.
- Ten generation requests returned valid model identity/billing. Request eleven returned **upstream HTTP 400** after 145 ms.
- Status: `infrastructure-error`; assistant terminal status `error`, despite pi process exit code 0.
- Known generation charges: **$0.0143985192**. Unresolved reservation: **$0.15** (not a confirmed charge).
- The other **eight cells were not run**. Matrix process stopped automatically, with no retry/resume or further paid diagnostic request.

This was **not a recorded TLS error**. curl completed the HTTPS transaction and received HTTP 400 from the upstream endpoint. The gateway's non-2xx receipt contains only the HTTP status, not the error response body. Therefore the specific rejection reason is **unknown**; do not assert a provider outage, invalid message history, context limit, or TLS cause without further evidence.

The candidate wrote Rust source, a browser frontend, and HTTP tests and invoked build/tests before the interruption. Its last action was a source edit. It did not deliver a final response. These partial artifacts are retained but are **not scored as a completed candidate or as a product-quality failure**. No current correctness claim is made from its earlier build/test tool output.

## Evaluation and accounting

Executed the frozen evaluation orchestrator. It correctly classified the interrupted cell as `not-scored-infrastructure`, and all eight absent cells as `not-run`. No external task score or comparative result is available.

New v3 candidate expenditure: $0.0143985192 known plus $0.15 held. Shared campaign state now records $1.6894392012 conservatively accounted candidate spending (includes historical unresolved reservations seeded during repair), plus the new $0.15 outstanding hold. Smoke total remains $0.010010970; no extra paid diagnostics were performed for this failure.

## Artifacts

Root: `/home/baissi/benchmarks/deepseek-jev-v3`.

- `matrix.log`
- `voxel-plain/{invocation.json,events.jsonl,gateway.jsonl,result.json,guard.jsonl}`
- `voxel-plain/workspace/` and session logs
- `evaluation-status.jsonl`
- `freeze.json`, `preflight/`, `live-preflight/`, `smoke-plain/`
- Shared accounting: `/home/baissi/benchmarks/deepseek-jev-campaign.json`

Previous v1/v2 runs and failures remain untouched. The finite live readiness soak passed but did not predict this subsequent HTTP-level rejection; readiness is not a guarantee of future provider acceptance.

## Next repair boundary

Before another paid attempt, add a bounded, sanitized upstream error receipt (status, safe error code/message, request identity where supplied) with credential-reflection tests. Determine whether the rejection is provider-side or generated-request compatibility using preserved evidence wherever possible. Any paid replay may be billed and must be separately reserved; there is no automatic retry or another full restart scheduled by this report.

No conclusion about plain pi versus Carthagent versus Carthagent+Jev is supported by this interrupted attempt.
