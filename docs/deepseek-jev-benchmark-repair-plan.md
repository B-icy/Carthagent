# Benchmark readiness repair (v3)

User requested all fixes needed to make the tests runnable. Preserve v1/v2 and their reports. Do not change candidate code or interpret transport failures as model failures.

## Design before implementation

1. Transport adapter owns HTTPS/process I/O only: use a fresh system-curl process (system OpenSSL, HTTP/1.1, no shared TLS session/pool) per upstream request, with normal certificate/hostname validation. No `-k`, relaxed ciphers, credential argv, redirects, implicit curl config, or automatic POST retry. Fixed gateway endpoints remain authoritative. Bound body, deadline and subprocess lifetime. Return a fetch-compatible buffered response; gateway owns envelope and billing. TLS root cause remains unproven; this is a separately tested avoidance path.
2. Shared runtime adapter owns explicit sanitized environment, copied offline fd/rg binaries, process cleanup and engine paths. Verify actual pi read/ls/find/grep in an empty isolated config, not merely `--version`. Same tool/guard setup for every arm; planning gates unchanged.
3. Durable campaign accounting owns exclusive locking, atomic snapshots, reservation before process/request dispatch and conservative crash recovery (holds remain). Seed previous candidate spending plus unresolved holds and smoke spending. No automatic retries, reset, or account-level cap claim.
4. Freeze owns source/engine/tool hashes and readiness receipts. Runner verifies actual hashes before any candidate, rejects existing directories, classifies terminal assistant errors separately from exit status, records tool attempts/admitted calls and structured infrastructure failures. Pre-execution extension blocks beyond 120 attempts; observed `tool_execution_start` may include blocked calls and is not execution proof.
5. Evaluation keeps original contracts, sanitizes child environments, bounds process groups and browser waits, uses fresh output directories. Browser waits honor the public 2s UI update allowance rather than fixed subsecond assumptions; reference fixtures and mutants exercise the real HTTP/browser paths. Old evaluator hashes/results remain historical; v3 changes require a new freeze.

## Challenges / tests

- Malformed HTTP/SSE, wrong model, split Unicode, stalled/chunked/oversized response, TLS self-signed rejection, trusted local TLS, redirects, abort, missing curl, secret-in-argv/log and concurrent body-read races.
- Unknown billing is not replay-safe: retain reservation and stop campaign rather than retry a paid POST. Reconciled invalid response can stop without labeling its cost unknown.
- Concurrent processes cannot both spend the same campaign balance; crash leaves a hold. Existing state cannot be silently reset. Freeze modification blocks before paid calls.
- Installed pi scripted local provider completes discovery, sees missing tools as failure, reaches real plan validation/inspection and Jev hook, respects preapproval mutation lock and preventive tool budget. Exit 0 + terminal error must fail readiness.
- Reference shop real API/native Firefox controls must pass, deliberate pricing/idempotency mutants must fail. Voxel previous candidate is a retained regression fixture only, not an independent reference; evaluator logic invariants/mutants complement it. Do not fix candidates to satisfy evaluators.
- No paid candidate matrix until offline readiness and bounded TLS/live connectivity checks pass. Live readiness expenses share the remaining original smoke allowance. A finite soak is evidence, not proof TLS can never fail.
