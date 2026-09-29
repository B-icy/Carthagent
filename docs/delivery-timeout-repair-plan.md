# Delivery timeout and schema-friction repair plan

Status: proposed, author-challenged; no implementation or paid replay in this change.

## Model selection and observed failure

User-selected Jev OpenRouter model ID is `typesafe/jev-1.13`. Both production adapter and benchmark broker already request it through POST https://openrouter.ai/api/alpha/decisions (not chat completions). Keep GLM5.3 Flash as generator; never substitute Jev router/chat generation. No scored GLM Jev cell dispatched advice because neither reached valid inspect.

GLM append/Jev: gateway request at20:45:33.084Z,68,342 bytes, kind generation, request hash c623ecaa4aac41673b4dcddaf5caf939e310c1f37a436a13ee6dc849ac84c804. Failed after180,005ms with ABORTED. Session events identify compaction. The shared180s gateway deadline fired; unknown$0.15 hold retained. This proves no completed response arrived before deadline, NOT absence of any upstream progress or that Jev stalled. Current curl adapter buffers stdout until process close; gateway buffers/parses complete SSE before releasing it. Existing receipts cannot distinguish prefill/queue delay from slow/interrupted streamed output.

GLM vary/Jev: overall900s candidate deadline canceled final generation/compaction request after22,288ms, not its180s provider limit. Time consumed by schema/workflow repairs and discovery. Other900s cells likewise include unfinished tests/review. Do not conflate wall-time, command deadline, provider deadline, byte overflow or advisor failure.

Concrete repair evidence: scenarios-only nested design patch replaced entire design, requiring full resubmission; invalid optional workflow schemas/references; missing revision reason/acceptance; review walkthrough mismatch; wrong progress IDs; candidate t.plan with standalone node:assert; unbounded shell test pipelines. Broader provider root cause unresolved.

## Stage1 — instrument and stop truthfully (transport/runner cohesion)

- Explicit request purpose generation/compaction/advice, deadline owner, wall remaining, request ID, request bytes, output ceiling, connect/header/first-body timing where observable, cumulative bytes and last-progress time. No raw body/key telemetry. Purpose comes from trusted lifecycle/integration metadata, not inference from prompt text; unknown if unavailable. Correlate split compaction requests without concurrent mislabeling.
- Streaming-aware transport observer parses bounded SSE incrementally and retains known usage/model/id as they arrive, while candidate delivery may remain buffered until billing validation. Keep certificate checks, no retry/redirect, hard byte limit. Partial bill is reconciled only when authoritative complete usage is valid; otherwise keep hold.
- Distinct first-response/progress/total/wall deadlines with documented precedence; provider progress cannot extend total indefinitely. Initially keep existing total180s until measurements justify change. Tests: delay headers, progress stream, partial usage, malformed SSE, unknown bill, downstream cancel, wall vs provider races and no duplicate dispatch.
- On stop, persist supervisor blocked/interrupted handoff containing exact pending requirements/evidence status and reason without another paid generation. Do not manufacture model-authored review or verified completion. No repeated failed compaction attempts after gateway closes.

## Stage2 — remove structural rewrite loops (planning API cohesion)

- Add explicitly separate versioned design-section patch operation. Merge only named components/ports/scenarios/risks; arrays replace within section; absent sections retained. Unknown fields fail with exact JSON path/allowed keys. Existing whole-design replacement semantics unchanged for compatibility. Revision/digest change invalidates approval/evidence per existing rules; exact acceptance/outputs/findings/history/user checks remain.
- Offer compact deterministic reference manifest: normalized step IDs/indices, component/check/scenario IDs and exact requirement references. Structural repair skeleton has empty trace/assertion slots visibly marked incomplete; never auto-fill reviews/approval.
- Review errors list missing/duplicate/unknown scenario IDs and missing fields; progress errors list valid steps. Top-level schema errors point to current guide and concrete missing key. Update guide to explicitly omit optional authored workflow for simple tasks: automatic mandatory workflow overlay still applies. If supplied, validate full authored graph; do not silently discard it.
- Tests replay each observed invalid call, prove actionable error followed by minimal valid repair, preserve all original acceptance/outputs/validators/blockers and stale-source locks. Assert partial scenario patch cannot delete components/ports/risks.

## Stage3 — test execution and verification reserve (execution host cohesion)

- Explicit bounded-run policy shared by all arms: default per-shell timeout60s, absolute120s unless protocol authorizes a declared longer check. Supervise process groups and deadline independently of shell pipeline exit status. Timeout remains timeout even if tail/head exits0. Candidate cannot reset session clock or buy a larger check limit through a tool argument.
- Show remaining time and pending obligations from supervisor monotonic clock. At <=180s recommend no optional expansion, rerun only necessary checks, record review/handoff or explicit blockers; preserve every requirement. Do not initiate another compaction if insufficient configured request/handoff reserve; stop honestly if context cannot proceed safely rather than overflowing or dropping requirements. This is bounded-run policy, not universal production behavior.
- Local fixtures demonstrate real test-runner APIs (t.assert vs standalone assert counting) and detect hanging servers/cleanup problems. Do not require running arbitrary probes before approval or auto-modify user tests. Actionable hints only, no weakening assertions.
- Tests: hanging pipeline descendants killed, nonzero original command not laundered, budget cannot reset by revision, failed/stale evidence survives supervisor handoff, enough time remains to finish a successful bounded fixture.

## Stage4 — Jev integration parity and meaningful exercise

- Retain exact `typesafe/jev-1.13` Decisions model, explicit opt-in,15s local advisor bound,3 attempts/run and existing unknown-bill holds. Advice remains non-authoritative.
- Eliminate drift: broker currently replaces production ADVISOR_QUESTIONS with its own older QUESTIONS strings. Use a shared frozen question contract/hash, include check argv/outputs/assumptions, assert direct and broker payload equivalence. Broker still rejects client model/endpoint overrides.
- Invalid schema remains deterministic: zero paid calls/attempt reservations until valid capture. First valid inspect triggers automatic semantic advice; identical run/revision/digest/source reuses receipt. Review must visibly address flagged topics but model-authored disposition is not proof. Failure means unavailable, not clean plan.
- Scripted local end-to-end run must actually reach valid inspect/advice, use updated question content, then implementation/checks/review/finish. Same run repeated with advisor timeout proves ordinary review remains possible without authority leakage. Independently test shared campaign policy: unknown paid billing may intentionally stop benchmark even though ordinary production advisory failure is nonblocking.

## Stage5 — readiness then new evaluation

1. Offline: all above adversarial tests, real installed-engine scripted full workflow, repository quality. Valid/invalid/hanging scenarios and real local streaming HTTP, not only mocked functions. Save plan challenge/author review; disclose independence limits.
2. Small separate GLM/Jev development pilot before matrix: budget cap agreed in advance, charges incl compaction and unresolved holds. Require actual advice invocation, measured request stages and honest terminal handoff; analyze failures before expanding. No claiming classifier effectiveness from one successful call.
3. Freeze fresh tasks/root/evaluator/runtime/provider policy. Same model, time/command caps, compaction, docs and isolation all arms. >=3 repetitions/task for primary comparison; fixed provider policy if supported/available, no silently different fallback. No candidate repair/retry after hidden evaluation. Preserve historical artifacts and old bills.

## Author challenge and acceptance boundary

A longer timeout alone trades one stop for lost task time; do not start there. More guidance alone failed to prevent schema loops; implement deterministic ergonomic operations, not probabilistic syntax repair. Model summaries cannot redefine requirements, approvals or findings. Partial semantic advice before a valid captured design adds cost and unclear identity, so not proposed. No silent workflow simplification, check deletion, model switching, shell bypass or automatic unknown-bill replay. Changes to test budget policy must apply to plain pi too. Timing tells where delay happens, not why vendor internals stall. End-to-end scripted success demonstrates mechanics only; effectiveness requires new model runs. Scope excludes general OS sandbox proof and universal schema/model correctness.
