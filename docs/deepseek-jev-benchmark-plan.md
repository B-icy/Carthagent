# Three-task DeepSeek / Jev benchmark — protocol v1

Status: design challenged before benchmark implementation; candidates have not run.

## Question and experimental arms

Does Carthagent improve externally measured task delivery over plain pi, and does advisory Jev add value above the same harness? All arms use the same installed pi engine and pinned `deepseek/deepseek-v4.1-flash` via OpenRouter, high reasoning, identical task text, initial workspace, tool availability and resource ceilings. The harness arms explicitly load this repository's delivery extension/skill; the plain arm has no extensions, skills, context files or prompt templates. This controls engine version rather than conflating vendored-engine differences with harness value. Record exact engine and harness versions.

A: plain pi. B: pi + Carthagent, no Jev. C: pi + Carthagent + Jev advisory feedback on the first successful design inspection per revision (at most 3 calls/run). No Jev router: it could choose a different generator and confound the ablation. Jev cannot approve or weaken deterministic gates. Probabilities >=0.5 flag review topics, not proven defects. Use OpenRouter `typesafe/jev-1.13` Decisions API, preserving returned snapshot/provider/cost.

Initial exploratory matrix: **3 tasks × 3 arms × 1 independent run = 9 runs**. Balanced task-specific arm order; no selective retries or supervisor repairs. One replicate per cell is exploratory, not statistically conclusive. Infrastructure smoke tests are separate and are never counted as task successes. If infrastructure fails, preserve results and explicitly document any protocol revision before restarting any affected comparisons.

## Tasks and external acceptance

1. **Rust voxel sandbox (small Minecraft-like clone)**: actual Rust gameplay/voxel state and software-rendered first-person view, deterministic terrain, collision/gravity, block remove/place with bounded reach, save/reload and malformed-save rejection. Browser input/display may be a thin JS frontend to the Rust server. Test Rust compilation and headless scenarios, then real browser controls/rendering and screenshot. Not a Minecraft-complete game: no crafting, mobs, infinite streaming or multiplayer.
2. **Sales website**: responsive local outdoor-products storefront, search/category/sort, stock-aware persistent cart, exact-cent totals, discount/shipping rules, validated checkout, idempotent order submission, persisted orders and stock, accessible status/error UI. Evaluate API contracts and real browser add/update/reload/checkout at desktop/mobile widths. No real payments/deployment.
3. **Exact-money transfer ledger**: Node JSONL service/CLI, signed decimal parsing without float rounding, integer-cent balance invariants at large magnitudes, atomic insufficient-funds rejection, idempotent retries/conflict rejection, persistence/restart and malformed log handling. Evaluate ordinary, adversarial and deterministic seeded metamorphic cases. This targets defects that screenshots and agent-owned tests miss.

Each task gets a frozen public prompt with observable interfaces and detailed requirements. External tests are written and hashed before candidates start; evaluator files are outside candidate workspaces and never sent to models. They are **withheld, not OS-isolated secrets**: same-host shell access is not a security sandbox. Do not claim blind testing if a trace shows evaluator access. Public API specifications are not hidden-test leakage. No candidate receives external scores or repairs during its initial run.

Score separate behavioral categories; report missing/unbuildable/unlaunchable as failures, not missing rows. Collect agent-authored tests separately. Capture visual artifacts but do not pretend pixel existence proves playability or subjective design quality. Report browser/runtime infrastructure failures separately from candidate failures.

## Budgets and measurement

- Per candidate: 15 minutes wall time, 120 observed tool starts, at most 100 paid generation requests, 16,384 generated tokens per request, 100,000-token engine context setting and 402,000-byte serialized request cap (conservative <=412,000-token reservation envelope including protocol overhead; actual token count is recorded).
- Provider proxy enforces max input/output prices of $0.30/$1.20 per million for DeepSeek, $0.15 generation-request reservation (covering <=412k input tokens and 16,384 output tokens at these rates) and **$3 maximum reserved spend per candidate**. Stop on unknown/invalid billing instead of interpreting missing cost as free; reconcile `usage.cost` when available. Jev max 3 requests, <=64KB request, $0.01 reservation each, included in candidate ceiling. Overall candidate ceiling $27; smoke/provisioning API calls separately capped at $0.10. No automatic escalation.
- Track external score, completion/false-completion, all failures, wall time, requests/tool calls, input/output/cache/reasoning token usage, actual provider cost, Jev latency/probabilities and model snapshots. Local provisioning/build time is recorded separately. Missing cost is unknown, not zero.
- One bounded infrastructure retry only for connection failure before generation, never candidate retries that erase failures. Sequential paid requests per candidate; overlapping tasks may be scheduled for practicality, with hardware contention disclosed.

## SRP / DI design

- Frozen protocol/task specs: own task meaning and scoring weights, no execution.
- `gateway`: owns outbound model authentication, model allowlist, bounded requests and spend reservation, sanitized usage receipts. Inject fetch/key/clock; candidates receive a dummy local credential, never the real key. Never log authorization headers. Restrict listening to loopback.
- `runner`: owns workspace/process lifecycle, resource deadline, JSON event logging, immutable invocation/results; no scoring or model-written repairs. Inject engine path, process environment and gateway address.
- `advisor`: owns extracting an inspection result, typed Jev rubric and attaching advisory feedback to the corresponding generator tool result; no approval or execution permission. Exactly the same Carthagent policy in B/C.
- `evaluators`: own independently specified functional oracles and browser checks, no candidate prompts or automatic repair. Real subprocess/HTTP/browser boundaries, not fake-only tests.
- `report`: joins immutable receipts and scores; missing data stays missing; no synthetic statistical certainty.

## Preimplementation challenges / scenario walkthroughs

- Availability: OpenRouter's ordinary chat catalog lists DeepSeek and Jev Router, but Jev itself is a separate Decisions API. Verified primary Jev docs before choosing endpoint; never substitute router results for a Jev ablation.
- Key confidentiality: parent reads only OpenRouter auth; child uses dummy proxy credential and a clean config/environment. Shell can still read host files absent OS isolation, so never represent this as protection against a malicious candidate. No real secrets in prompts, saved configs or request logs.
- Fairness: same engine/tool set/settings and unmodified public task prompts. Harness guidance and Jev feedback are intentional treatment differences. Tool-budget overhead is part of harness cost; also report generation/request/time overhead so quality is not cherry-picked.
- Failure: invalid model response, no billing, timeout, exhausted budget, compiler failure and no rendered UI stay visible. Missing Jev is an unavailable treatment, not a successful Jev run.
- Oracle adequacy: test mutant behaviors (float money, duplicate application, ignored stock, no voxel change) to show evaluators detect meaningful failures before running candidates. Real browser checks complement API/headless checks.
- Persistence: restart after state changes, then retry same operation; require exactly-once state. Malformed state must reject without overwriting valid state.
- Visual scope: require a rendered scene plus controls/state transitions; do not award a playable-clone score to only a data structure or screenshot.
- Environment: Rust is not installed on PATH; provision an isolated toolchain before candidates. Firefox exists but snap cannot use /tmp worktrees; use benchmark runtime under the home directory with an explicit writable profile root.
- Provenance: generative/model-authored planning reviews are not independent; external tests are supervisor-authored with published limitations. Historical earlier trials remain untouched.

Outcome: protocol ready for tooling/evaluator implementation. Freeze implementation hashes before any task candidate. Adjustments needed after infrastructure probes must be logged, not silently retrofitted to favor an arm.

## Pre-candidate infrastructure findings and protocol v1.1

- Rust 1.98.1/cargo 1.98.1 were already installed under `~/.cargo/bin`; only PATH composition was needed.
- The first plain smoke preserved a genuine budget-stop: its $0.05 total could not reserve a second $0.05 generation request after the first bill. A separate harness smoke with $0.08 total completed tool use and `SMOKE_OK`. No task candidate ran during these corrections. Paid smoke actual costs: $0.0007059 + $0.0041763 + $0.000019278 (Jev) = $0.004901478, below the $0.10 ceiling.
- Real Firefox initially exposed two supervisor fixture defects (missing HTML content type; missing WebDriver return). Both were repaired before candidate evaluation and original failing logs retained. Native click + screenshot now pass under home-directory profiles.
- Jev live endpoint smoke returned valid typed answers and billing. Inspection of the real delivery tool showed an outer `{result,planningStatus}` wrapper; the benchmark adapter now reads `result`. A real loopback integration test reproduces this exact envelope, verifies once-per-revision feedback and proves the adapter leaves the original tool result unchanged. The initial synthetic smoke did not use the real wrapper; it established API connectivity, not end-to-end harness integration.
- Initial 95KB generation body cap would unnecessarily truncate longer coding contexts. Before all candidates, increased to 402KB after serialization, with $0.15 reservation rather than $0.05. Reservation uses a deliberately conservative byte/token envelope, not a claim that bytes/4 is a guaranteed tokenizer bound. Provider billing remains the external source of truth; unexpected billing stops further requests, not a vendor-enforced account cap.
- Gateway buffers bounded upstream SSE until billing arrives; all arms have the same buffering and 180-second per-request transport deadline. This delays visible token streaming, not the model's generation. There are no automatic gateway retries. No OS sandbox or absolute account-level spending guarantee is claimed.
- Evaluator self-tests include a separately authored ledger reference process and float/idempotency mutant processes. Shop quote and voxel-state/change oracles have component-level mutant assertions, not complete reference applications; their full candidate HTTP/browser suites have not been validated against independently built passing apps. Report that limitation. Browser infrastructure uses actual Firefox and native input.
- Scores are unweighted category pass counts with the complete assertions published afterward; categories are not equal complexity. Visual screenshots support inspection but there is no invented quantitative aesthetic score.

## Verified primary references

- https://openrouter.ai/api/v1/models (retrieved 2026-09-28): DeepSeek model ID and $0.30/M input, $1.20/M output, $0.006/M cache-read listing.
- https://openrouter.ai/docs/guides/community/jev : Jev available with OpenRouter key, distinct Decisions/System One endpoints.
- https://openrouter.ai/docs/guides/community/jev-tutorial : typed answers and `usage.cost`, pinned `typesafe/jev-1.13` resolving to dated snapshot.

The full API catalog and primary documentation snapshots were retained under `/tmp/ctg-benchmark-discovery/`. Search snippets were discovery aids, not the basis for endpoint selection.
