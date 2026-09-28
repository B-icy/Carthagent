# Running the repaired benchmark (v3)

This supersedes the **operating instructions**, not the historical results, in the v1/v2 protocol/reports. Repair design: [repair plan](deepseek-jev-benchmark-repair-plan.md). Previous attempts remain unchanged. No candidate implementation was repaired.

## Transport fix and evidence

The paid gateway now uses **one fresh system curl/OpenSSL process per request**, HTTP/1.1, rather than Node 26's pooled fetch/TLS transport. Normal certificate and hostname verification remain enabled. There is no insecure flag, TLS downgrade, automatic retry, redirect following, curlrc loading, or credential in argv. Request headers/body enter through an anonymous stdin pipe; output and time are bounded. This bypasses the previously failing path; it does **not** establish the root cause of `BAD_RECORD_MAC` or guarantee future network availability.

Real local TLS tests reject an untrusted self-signed certificate and accept the explicitly trusted fixture; exercise 25 fresh connections, Unicode/chunking, redirects, lost POST responses, oversized responses, timeouts, cancellation, and missing curl. Unknown POST billing stops the campaign rather than silently replaying requests.

Live repair evidence: **24 sequential DeepSeek requests**, including two 60KB inputs, **one Jev request**, then the installed pi engine completing all four discovery tools and `SMOKE_OK`. All passed with known billing and zero outstanding holds. New repair smoke spend: **$0.005075892**. Historical + repair smoke: **$0.010010970**, under the original $0.10 allowance. Raw receipts: `/home/baissi/benchmarks/deepseek-jev-v3/live-preflight/` and `smoke-plain/`.

## Other fixes

- Copy verified `fd`/`rg` into each isolated pi config before launch. Scripted loopback-provider tests drive the actual installed pi engine's read/ls/find/grep in **all arms**, with no downloads. The Carthagent preapproval mutation gate and actual validate/inspect→advisor path are also exercised. Fixture planning does not certify semantic plan quality.
- Identical budget-only extension in all arms blocks tool attempt 121 **before its body executes**. JSON `tool_execution_start` still counts attempts (including blocked calls), not actual execution. Record admitted/blocked counts separately; Carthagent may separately reject admitted calls.
- Removed the ineffective `toolExecution: sequential` setting: this installed CLI has no such setting. All arms retain its same default (parallel sibling tools with sequential preflight). The original sequential-execution claim was incorrect. Carthagent still serializes its own state operations.
- Terminal assistant `error`/`aborted`/missing/incomplete is separate from process exit. Smoke passes only on terminal completion plus `SMOKE_OK`. Matrix stops on transport/model/launch infrastructure errors instead of cascading through later cells.
- Gateway serializes before reading request bodies, preserves split UTF-8, validates returned model and SSE completion, and reconciles known bills before rejecting malformed semantic responses.
- Persistent campaign accounting reserves **before** dispatch, locks concurrent updates, fsyncs atomic state, and retains holds after crashes/ambiguous failures. Existing state cannot be reset by rerunning setup. A stale lock requires human inspection, not automatic deletion.
- Every candidate launch verifies actual frozen source, engine, discovery binary and readiness hashes. Newly added files in frozen directories invalidate the manifest. Run/evaluation directories are exclusively created; no overwrite or selective resume.
- Evaluator subprocesses have explicit sanitized environments, bounded process groups, bounded browser/HTTP waits and cleanup. Shop browser checks use native clicks, honor the 2-second UI update allowance and confirm inventory changes rather than guessing success from English confirmation words. Full shop HTTP/browser evaluation passes a supervisor-only reference fixture and catches pricing/idempotency mutants. Ledger has separate reference/mutants. Voxel regression runs on a **copy** of the retained candidate, not an independent reference app.
- Candidate-owned tests are collected separately; missing cells remain `not-run`, infrastructure-interrupted cells are not scored as product failures.

## Budget / paths

- Fresh candidate output: `/home/baissi/benchmarks/deepseek-jev-v3`.
- Shared durable budget: `/home/baissi/benchmarks/deepseek-jev-campaign.json`.
- Candidate account starts conservatively charged **$1.675040682**, covering prior actual bills plus all unresolved holds. Those historical holds remain unknown charges, not confirmed spending.
- New ceiling: **$2.80/cell**, 9 cells, with the same 900 seconds, 120 admitted tool attempts, 100 paid requests including <=3 Jev calls, 16,384 generation output tokens/request. $1.675040682 + 9×$2.80 = **$26.875040682**, below original $27 candidate ceiling. Shared ledger is an additional check, not a vendor-enforced account cap.
- No automatic paid POST retry, candidate rerun, or supervisor candidate repair. Interrupted historical matrices are still reported.

## Reproduction

Run from `/tmp/ctg-tested-planning` (branch `bench/deepseek-jev-three-tasks`). Node >=22.19 with TypeScript stripping support as used by this installed environment, local curl/OpenSSL, Rust, Firefox/geckodriver, and the pinned installed pi engine are required.

```sh
# Offline tests, including real local TLS / installed pi / Firefox:
node --test tools/benchmark/*.test.mjs tools/benchmark/selftest.mjs
npm run quality

# Live checks are explicit paid opt-in and refuse existing attempt directories:
# Already completed here. Do NOT rerun or delete old directories to make it run.
# node tools/benchmark/preflight-live.mjs --paid

# Generate source-bound readiness and freeze (new output path; refuses existing freeze):
node tools/benchmark/preflight.mjs /home/baissi/benchmarks/deepseek-jev-v3/preflight --freeze

# Paid task matrix, only after passing freeze verification:
node tools/benchmark/runner.mjs matrix

# External evaluator + separate candidate-owned tests; refuses overwrite:
node tools/benchmark/evaluate.mjs matrix
```

`matrix` does not resume. If interrupted, retain everything and inspect the failing cell/campaign receipts before proposing a new protocol. To inspect accounting without exposing the API key, read only `deepseek-jev-campaign.json`; the supervisor reads the key from existing pi auth, and children receive dummy gateway credentials.

## Limits retained

This is not an OS sandbox: same-user host access and trusted extension/state replacement remain outside enforcement. Sanitized environment is not filesystem credential isolation. Evaluators remain finite checks; no exhaustive correctness, calibrated aesthetic score, immutable provider weight snapshot, or independent-review claim. Freeze includes installed engine dist files but not every transitive dependency. Finite readiness tests cannot guarantee a future provider/network response. Passing readiness is not benchmark superiority; the full v3 task matrix has not run as part of these repairs.
