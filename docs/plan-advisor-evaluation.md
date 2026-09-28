# Optional plan advisor: evaluation, not approval

The deterministic planning gate works without Jev, credentials or network access. `lib/plan-advisor.mjs` defines an injected classifier port; `lib/jev-advisor.mjs` adapts the documented TypeSafe Noul API. Neither imports approval policy or mutates delivery state. Suggestions route SRP, DI and test-gap concerns to adversarial review; a probability is not a defect receipt or permission to implement.

## Explicit opt-in

```sh
# No network, no credentials: no-advisor baseline
node tools/evaluate-plan-advisor.mjs tests/fixtures/plan-advisor-corpus.json

# Optional live evaluation: explicitly transmits design/acceptance/workflow to TypeSafe
TYPESAFE_API_KEY=... node tools/evaluate-plan-advisor.mjs your-reviewed-corpus.json --jev
```

Do not put secrets or private source into planning artifacts sent to an external provider without authorization. Only goal, acceptance, design and workflow are transmitted, not arbitrary top-level state, but those fields may themselves contain sensitive data. The adapter does not claim automatic redaction or default zero retention. No live request was made during this implementation. The default provider model is pinned to `jev-1.13.0`; the adapter accepts an explicitly configured model for later evaluation.

The adapter has a 3-second default deadline, no retries, a conservative 64KB request cap and 64KB streamed response cap, rejects redirects, malformed probabilities, missing model identity and provider errors. Failure returns `unavailable` with `authority:none` and cannot weaken deterministic gates. Unknown cost is `null`, not zero. Optional injected input pricing yields an estimate, not billing evidence.

## What was actually evaluated

- **Local quality: 347 tests**, including no-key operation, injected classifier immutability, typed HTTP request/response contract, timeout even for an uncooperative fake, invalid/oversized response, missing key, HTTP errors and sanitized failure output.
- **Three-case, supervisor-authored illustrative corpus**: cohesive pure policy, mixed policy/hidden network, and missing parser failure cases. This is neither blind nor representative. Labels are judgments, not independently adjudicated truth. The corpus tests evaluation plumbing, not production readiness.
- No-advisor baseline: 9 category decisions, 4 false negatives, 5 true negatives, no positive alerts, undefined precision/Brier score and unknown cost. This is an intentionally silent baseline, **not a comparison against Carthagent's deterministic validator or generative review**.
- Injected probability fixture: one true positive, one false positive, one false negative, Brier score approximately 0.4467. These values test metric calculations only; they are not Jev measurements.
- **No live Jev accuracy, calibration, latency, cost or net-value claim.** The adapter remains off the normal delivery path until a properly labeled comparison establishes useful additional findings over deterministic + generative review, with acceptable missed defects, false alarms and privacy/cost trade-offs.

The evaluator reports TP/FP/FN/TN, precision, recall, Brier score, availability failures, measured local request duration and known/unknown cost separately. Brier score on a tiny corpus is not evidence of general calibration. Future evaluations should retain raw outputs, provenance, human adjudication, false-negative examples, domain strata and a no-Jev generative-review baseline.

## Primary API sources

The request and response contracts were verified against retrieved primary documentation (not merely search snippets):

- [TypeSafe API](https://docs.typesafe.ai/api): `POST /v1/systemone`, typed questions, Noul answers and usage fields.
- [Model documentation](https://docs.typesafe.ai/models): model identities and vendor-listed pricing/limits.
- [Known weaknesses](https://docs.typesafe.ai/model-jaggedness/jev-1.13): numeric, multi-hop and cross-question consistency limitations.
- [Confidence](https://docs.typesafe.ai/confidence): confidence is not an independent correctness oracle.

Vendor performance claims are not independently replicated here. Optional integration is deliberately an evaluation boundary, not a mandatory dependency or an approval authority.
