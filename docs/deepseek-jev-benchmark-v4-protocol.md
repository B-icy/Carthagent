# V4 authorized execution

User authorized live validation and running the matrix after the exact HTTP-body fix. Preserve v1–v3 and their interrupted candidates; no copying candidate source into new cells.

- Root: `/home/baissi/benchmarks/deepseek-jev-v4`.
- Same task texts, evaluator assertions, balanced order, model and reasoning configuration as repaired v3. No provider pinning or selective candidate retry.
- Corrected large-body transport and sanitized upstream errors described in `deepseek-jev-http400-diagnosis.md`.
- Per-candidate cap **$2.79**. Historical conservative candidate debit $1.6894392012 plus outstanding $0.15 plus nine times $2.79 = **$26.9494392012**, within the original $27. Shared durable account remains authoritative. No historical holds are released without billing evidence.
- New live gate: exact reconstructed historical 97,377-byte request, only max_tokens changed to 32, using fixed transport: **HTTP 200**, same requested/returned model, provider AtlasCloud, known bill **$0.0004261776**, no tool execution. Original failing HTTP replay's $0.04 smoke hold remains retained.
- Known smoke spend now $0.0104371476 plus unresolved $0.04 = $0.0504371476 conservatively accounted, under original $0.10.
- Re-run complete offline readiness/repository quality and create new source-bound freeze before candidates. Freeze schema remains version 3; attempt identifier/root is v4. V3 freeze and receipts are not overwritten.
- Matrix stops on recorded transport/model/launch infrastructure errors. Resource-bound task outcomes remain outcomes. No autonomous retries, source repair, or existing-directory overwrite.
- External evaluation occurs only after candidate termination; no evaluation feedback is returned to generators. Candidate-owned checks and infrastructure failures remain separate from external product scores.

This finite live acceptance proves the historical request can pass with the fixed transport, not universal provider availability, semantic correctness, or comparative benefit. Readiness/transport fixes do not alter advisory authority or planning gates.
