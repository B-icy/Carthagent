# DeepSeek / Carthagent / Jev benchmark: interrupted, not a comparison

## Status

The exploratory matrix is **incomplete**. No conclusion about Carthagent or Jev effectiveness is supported. Candidate generation is stopped; no further automatic restarts or paid requests are scheduled.

Generator: `deepseek/deepseek-v4.1-flash`, high reasoning, installed pi 0.85.1, Node 26.7.0. Treatment arms add this repository's delivery extension/skill; Jev treatment adds a benchmark-only OpenRouter Decisions adapter using `typesafe/jev-1.13`, never a generator router. Completed v2 generation receipts report provider Together. One replicate per task/arm was intended.

Public contracts/evaluators were committed and hashed before candidates at `7087423`; the restart amendment is committed at `dfc5292`. See [protocol](deepseek-jev-benchmark-plan.md) and [restart amendment](deepseek-jev-benchmark-restart.md).

## Attempts retained

### Original v1 matrix

Artifacts: `/home/baissi/benchmarks/deepseek-jev-v1`.

Plain voxel made eight observed tool starts, wrote a partial candidate, then hit an unresolved gateway transport/billing failure after 89.181 seconds. Each of the other eight cells failed on its first request with zero tools. The original gateway obscured the exception type, so the root cause for v1 is **unknown**, not retroactively proven to be the TLS error seen later. No v1 candidate was repaired or selectively resumed.

The original runner did not stop the matrix on shared infrastructure failures, so it unnecessarily attempted all eight later cells. Its process exit status was zero even though the model's terminal message was an error. Raw `result.json` records are preserved, not rewritten to hide that classification defect.

### Uniform v2 restart

Artifacts: `/home/baissi/benchmarks/deepseek-jev-v2`.

Announced before execution, with the same tasks and evaluator hashes, fresh empty candidate workspaces, no source copied from v1, reduced $2.84/cell ceiling, sanitized transport diagnostics, and matrix stop after the first unreconciled failure. This is an infrastructure restart, not a second successful replicate or a substitute for reporting v1.

| Task / arm | Outcome | Time | Tool starts | Known billed generation cost | External evaluation |
|---|---|---:|---:|---:|---|
| Voxel / plain pi | Terminal model `stop`; candidate completed | 129.204 s | 32 | $0.067758660 | 8/8 frozen categories passed |
| Voxel / Carthagent | Terminal model error; interrupted during planning | 86.358 s | 24 | $0.058291788 + unresolved reservation | Not scored as an implementation failure |
| Voxel / Carthagent + Jev | Not run | — | — | — | — |
| Shop / all three arms | Not run | — | — | — | — |
| Ledger / all three arms | Not run | — | — | — | — |

The second v2 cell recorded `TypeError`, cause code **`ERR_SSL_SSL/TLS_ALERT_BAD_RECORD_MAC`**, 73 ms after request start. No upstream response identity/billing was available for that request. The matrix stopped immediately. This establishes a transport-layer failure in that attempt, not whether Node, the TLS stack, the network, or the upstream caused it. A separate small request succeeding does not demonstrate the long-running path is repaired.

## Completed voxel evidence

Frozen categories passed: release compilation; deterministic seeded state; movement/gravity/jump/solid-state checks; reachable removal/placement and material selection; unreachable-sky and unknown-action nonmutation; save/reload plus corrupt-load atomicity; changing Rust PPM frames; actual Firefox keyboard input affecting Rust state.

Candidate-owned tests were run separately afterward: **17 unit tests and 9 HTTP integration tests passed** (`evaluation/candidate-tests.log`). This is not additional independent correctness evidence of the same strength as a withheld evaluator.

Artifacts under `voxel-plain/evaluation/`: `result.json`, `build.log`, `server.log`, `frame.ppm`, `game.png`, Firefox profile/logs, `candidate-tests.log`. The screenshot was captured successfully; the supervising model could not view the image attachment, so **no visual-quality judgment is claimed**. The candidate is a software-rendered voxel slice, not Minecraft feature parity.

The completed candidate reported all required features, but 8/8 category checks are not exhaustive proof of every acceptance condition. For example, the evaluator's world checks do not prove collision safety at every pose, its PPM check is not a full visual-quality metric, and it does not exhaustively mutate every out-of-bounds save field. Do not equate category pass count with full contract correctness or rank this candidate against absent competitors.

## Planning observations, not treatment-effect estimates

The interrupted Carthagent candidate encountered implementation locks, a malformed design value, an invalid artifact-root proposal, and premature inspection before passing validation; it revised its plan. These recorded errors and recovery attempts are retained. No approved implementation was completed before transport failure.

Two advertised discovery tools failed because `fd` and the pi-managed `rg` were unavailable in the isolated configuration and offline mode prevented downloading them. This is a benchmark bootstrap defect with potentially unequal impact: plain pi can use shell alternatives, whereas Carthagent's preapproval gate restricts arbitrary shell. It must be repaired/tested before any future fair comparison, not presented as evidence that the planning approach is worse.

The candidate also read harness source beyond the explicitly linked documentation while diagnosing its schema. This was not OS-isolated. No claim of enforced evaluator/credential inaccessibility is made.

Jev returned valid typed probabilities in a separate live endpoint smoke. A local integration test used the actual `{result,planningStatus}` inspection envelope and checked once-per-revision, non-authoritative feedback. **No candidate received Jev feedback in either attempted matrix.** Thus there is no empirical Jev quality/latency/net-value comparison here.

## Billing

Known candidate bills across both attempts: **$0.175040682**. Ten unresolved $0.15 reservations total **$1.50**. These are conservative held amounts, not confirmed charges and not zero-cost assumptions. Known bills plus retained holds: **$1.675040682**; provider-side reconciliation is still needed for unknown requests.

Smoke/diagnostic known costs: $0.000705900 + $0.004176300 + $0.000019278 + $0.000017220 + $0.000016380 = **$0.004935078**, below the separate $0.10 allowance. One tiny diagnostic used a direct max-32-token request rather than the gateway; its returned billing is preserved at `v1/diagnostic-response.txt`. No real key was included in receipt logs.

V2 token usage totals (sum of request usage, includes repeated context/cache): plain voxel 1,649,799 prompt / 35,859 completion; interrupted harness voxel 747,309 prompt / 26,107 completion. These are not unique task tokens. Provider costs, not nominal catalog multiplication, are reported.

## Preflight and remaining limitations

- Seven focused benchmark tests passed: gateway bounds/billing, actual advisor envelope, ledger reference and float/idempotency mutants, shop/voxel component oracle checks, real Firefox native click/screenshot. Original failing browser fixture logs are retained.
- `npm run quality` passed: lint, typecheck, build, **348 repository tests**. Focused benchmark tests run separately. No benchmark GitHub CI/independent review/PR merge is claimed.
- Shop and voxel did not have full independently authored passing reference applications before freeze. Only the completed plain voxel candidate has exercised the full voxel HTTP/browser evaluator. Shop scoring remains unvalidated end-to-end.
- The runner records exit status but lacks terminal-model-error classification; analysis above reads actual assistant terminal events. Its tool cap is reactive at start 121, not a preventive stop at 120. The matrix freeze guard only checks file presence; hashes were checked separately for v2 tasks/evaluators. Aggregate budgets are documented per-attempt arithmetic, not centrally enforced across arbitrary extra invocations.
- Candidate server/test evaluation inherits the supervisor process environment rather than the runner's sanitized environment. No credential isolation guarantee should be inferred from the candidate-generation gateway arrangement. Same-user shell access is outside these controls in all cases.
- The gateway buffers bounded SSE and uses a 180-second request deadline, altering visible streaming equally in all arms. Model identifier is pinned outbound and returned identities logged; this is not a reproducible immutable provider-weight snapshot.
- One replicate and an infrastructure restart cannot establish statistical superiority. Incomplete cells remain missing, not zeros or successes.

## Before another matrix

Investigate the reproducible long-running TLS path using bounded non-candidate traffic; verify clean offline discovery-tool availability; add terminal model status, central attempt accounting, actual freeze verification, and preventive tool-budget checks. Re-freeze a clearly versioned protocol, preserve both existing attempts, and obtain agreement before another full restart. No further candidate run is scheduled by this report.
