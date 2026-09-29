# HTTP 400 diagnosis and regression-tested fix

## Confirmed cause

The v3 HTTP 400 was caused by the benchmark's curl adapter, **not demonstrated to be DeepSeek's tool-history validation or context window**.

1. Reconstructed the failed request using the installed pi serializer, original session messages, tool schemas, system prompt and model compatibility configuration. No tools were executed and the original session/candidate was not changed.
2. Reconstructed bytes exactly matched the recorded request: **97,377 bytes**, SHA-256 `c7d747793525d4a7019922d59076d481f4a723d3a593d66dd1fbc095c79208b3`. All 11 tool calls had matching results; no orphan results or duplicate IDs were found.
3. Made the one authorized diagnostic replay, changing **only `max_tokens` from 16384 to 32**. OpenRouter returned HTTP 400, `error.message: "JSON parsing failed"`. This replay was not resumed as a candidate, and no returned tool could execute.
4. Sent the original reconstructed payload through the old adapter to a real local HTTP receiver. **The receiver obtained zero body bytes**, despite the supervisor's pre-transport hash correctly describing 97,377 bytes.
5. The adapter put the entire JSON body into a single curl stdin-config `data-binary` line. That path hits curl's config-line length limitation; curl can still issue the request without the intended body. The earlier 60KB readiness inputs did not catch it.
6. The fixed adapter delivered all **97,377 bytes byte-for-byte**, with the receiver hash matching the original. This offline reproduction directly demonstrates the transport defect and correction.

The earlier v1/v2 TLS failure remains a separate historical issue; this finding does not retroactively establish its cause.

## Fix

- Keep fresh curl/OpenSSL transport, verified HTTPS, HTTP/1.1, no redirects and **no automatic paid POST retry**.
- Send the request body using `--data-binary @FILE`, outside curl's inline-config parser. The body file is created in a private **0700** temporary directory with **0600** permissions and removed when curl closes, including normal failure/abort paths.
- Credentials still enter only through the short stdin configuration, never argv or body files. This changes the previous claim that payloads never touch disk: payload files now exist temporarily and abrupt supervisor termination may leave them. It is **not zero-retention or an OS credential sandbox**.
- Preserve selected response headers (`x-request-id`, `request-id`, `cf-ray`) and parse interim HTTP headers while retaining response/deadline bounds.
- On HTTP failure, record request hash, status, safe error fields, request ID when supplied, and a bounded sanitized body excerpt. Known key variants and bearer tokens are redacted before display truncation; oversized bodies are omitted and canceled. This is not universal secret detection: error bodies can reflect submitted source/planning data.
- Keep ambiguous billing holds and stop instead of assuming an HTTP 400 is free.

## Tests / evidence

Focused tests cover certificate verification, real TLS, cancellation/deadline/response bounds, redirects, missing curl, response headers, and **actual server-received request bytes** at 60KB, 90KB, 97KB, 130KB and 399KB plus Unicode/quotes/backslashes/newlines and the reconstructed historical multi-turn request. Error tests cover reflected credentials, oversized/non-JSON error bodies, no paid retry, held unknown cost and exact historical request reconstruction.

Artifacts: `/home/baissi/benchmarks/deepseek-jev-v3/http400-diagnostic/`:

- `payload.json`: exact reconstruction, private mode 0600; contains original candidate source/context, not the supervisor API key.
- `inspection.json`: hashes and structural history inspection.
- `replay.json`: one-shot paid diagnostic, bounded sanitized provider error.
- `wire-inspection.json`: old adapter received-body length 0.
- `wire-inspection-fixed.json`: fixed adapter exact byte/hash match.

Test logs: `/tmp/benchmark-http400-tests.log`, `/tmp/benchmark-http400-fixed.log`. Full validation passed: **20 benchmark tests** (`/tmp/benchmark-http400-full.log`) and `npm run quality` including **348 repository tests**, lint/typecheck/build (`/tmp/benchmark-http400-quality.log`).

## Billing and next execution

The diagnostic retains a **$0.04 smoke reservation**, since HTTP 400 did not return billing. Existing known smoke spend is approximately **$0.010010970**; known smoke plus this hold is **$0.050010970**, under the original $0.10 ceiling. The prior $0.15 candidate reservation is unchanged. These held sums are not confirmed charges.

Only **one paid replay** was made. No paid post-fix replay, new candidate run, provider pinning, model change or matrix restart was performed in this repair. The specific defect is verified locally using the exact historical bytes; fixed live acceptance remains to be tested under a newly authorized bounded probe.

The v3 freeze is intentionally now stale: do not overwrite it or its readiness receipts. A new protocol/root/freeze is required before another matrix. Old v3 readiness cannot authorize these changed transport/evaluator sources. The previous `benchmark-running.md` description of pipe-only bodies is historical and superseded by this document; its old freeze commands must not be used to overwrite v3.
