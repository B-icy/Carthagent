# Tested planning and agent-authored workflows

Status: **stages 1–5 merged; stage 6 implemented, awaiting CI/merge**. Owner: Carthagent. This is the implementation contract for the six sequential PRs below. Historical live-trial notes are evidence, not current operating instructions, and must remain intact.

## Non-negotiable behavior

For new delivery tasks, no product code, test code, prototypes, arbitrary shell commands or mutation-capable custom tools before a tested plan is approved. Planning is structured data written through harness tools. Read-only discovery remains possible. Approval means readiness to implement, not correctness of future code. Informational tasks never grant mutation permission. Legacy reports remain readable but must pass the new gate before new mutations.

The workflow is discovery → requirements/examples → architecture/workflow → deterministic validation → adversarial review/scenario walkthroughs → revise/retest until blocking findings are resolved → approval → regression tests → implementation → integration/final review. Approval is bound to plan identity, revision and the inspected source snapshot. The first authorized mutation starts implementation; subsequent planned source edits do not invalidate the design approval on every keystroke. A plan revision always relocks implementation. Source changes before implementation begins stale the approval. During implementation, unexpected external edits cannot be distinguished from all legitimate edits without stronger isolation; disclose that limitation.

## Architecture responsibilities and DI

- `planning`: pure contract validation, review receipts, approval lifecycle. No I/O, network or rendering. Inject snapshot hashes/time where needed.
- `workflow`: pure graph semantics and projections; immutable mandatory gate overlay. No execution or model authority.
- `planning-access`: fail-closed tool policy, read-only discovery boundary. Inject tool metadata/runner where appropriate. No heuristic shell allowlist.
- extension/server/CLI: composition roots for persistence, workspace locks and execution. All execution entry points enforce the same approval policy.
- UI: renders observed state and evidence; never infers success from prose or animation. Workflow, architecture and evidence are distinct views.
- `plan-advisor`: optional injected classifier port and Jev HTTP adapter. Advisory only; cannot mint approval, modify requirements or bypass checks. No keys/provider calls required for normal operation or tests.

SRP is cohesion and one reason to change, not one function per file. DI exposes time/network/process/storage boundaries; deterministic contract tests verify boundaries, while integration tests cover real entry points.

## Planned contract

A design contains components (responsibility, non-responsibilities, owned requirements, layer, dependencies), ports (owner, input/output/error contracts, adapter, injection mechanism, composition root and test double), scenarios (requirement, component path, input, expected behavior, failure case, concrete assertion, check IDs), risks (blocking/open or resolved with evidence), and workflow (stable nodes, dependency edges and bounded recovery transitions). Exact existing acceptance text stays authoritative. Every criterion requires positive and failure/boundary scenarios. Every declared external dependency must have an injection contract. A structural validator cannot prove the architecture is good or that a scenario is adequate.

Reviews record challenges, walkthroughs and findings against an exact revision, design digest and source fingerprint. Review is explicitly model-authored; reviewers cannot assert independent provenance without an actual separate invocation. No confidence threshold unlocks implementation. Blocking findings must be resolved through a new design revision and fresh validation/review. Optional findings need a recorded disposition.

## Six sequential PRs

| Stage | Deliverable | Acceptance and tests | Status / PR |
|---|---|---|---|
| 1 | Planning contract, validator and lifecycle | Missing requirements/scenarios/ports; invalid references; blockers; stale review/approval; revision history; no I/O in policy | Merged [#93](https://github.com/B-icy/Carthagent/pull/93); 335 local tests and all CI green |
| 2 | Approval gate and mutation restrictions | Default pre-plan protection; shell/custom-tool bypass; informational downgrade; CLI/HTTP check bypass; restore/revision; truthful enforcement scope | Merged [#94](https://github.com/B-icy/Carthagent/pull/94); 337 local tests and all CI green |
| 3 | Agent-authored workflow and architecture | Stable IDs; DAG prerequisites; explicit bounded recovery; mandatory gate overlay; D2 escaping; old plan rendering | Merged [#95](https://github.com/B-icy/Carthagent/pull/95); 340 local tests and all CI green |
| 4 | Event-driven workflow/architecture/evidence UI | Current phase, reason locked, findings, evidence, stale states; safe rendering; terminal projection; browser integration | Merged [#96](https://github.com/B-icy/Carthagent/pull/96); 341 local tests and all CI green; local Firefox blocked by snap /tmp restriction |
| 5 | Adversarial review and scenario loop | Inspection receipt; complete challenges/walkthroughs; finding history; unresolved blocker; repair/revalidate; honest self-review provenance | Merged [#97](https://github.com/B-icy/Carthagent/pull/97); 343 local tests and all CI green |
| 6 | Optional Jev advisory evaluation | Injected fake/HTTP adapter; no-key baseline; failure/timeout/malformed response; shadow findings, false negatives, latency/cost metrics; no approval authority | Implemented; 347 local tests and no-key corpus run pass; no live Jev benchmark |

Each stage: focused tests → quality → PR inspection and cross-platform CI → merge → update this ledger for the next stage. GitHub does not permit self-approval; author review and authorized merge are not independent approval. No silent weakening of requirements to obtain green CI.

## Plan testing performed before implementation

1. Requirement walkthrough: source/test generation is prohibited before approval; planning JSON is allowed through dedicated APIs. No executable planning probes are smuggled through shell.
2. Boundary walkthrough: requirements map to component owners, contracts and scenario assertions. Fake-only testing is insufficient; tests must include adapter and public entry-point behavior.
3. Failure walkthrough: malformed design → findings → revise → fresh validation/review; unresolved assumption blocks approval. Provider failures cannot change gate state.
4. Lifecycle walkthrough: compaction restores receipts; changed revision invalidates approval; changed snapshot before first mutation invalidates it; implementing source changes require final check reruns, not endless approval deadlock.
5. Enforcement challenge: tool interception is not an OS sandbox. Fail closed for all non-read tools before approval, including unknown tools. Disable raw shell during planning. Do not claim protection from external processes or a malicious host. Baseline execution before approval is unavailable unless a real isolated runner is supplied; report this rather than pretending shell regexes provide isolation.
6. UI challenge: arbitrary D2 is not executable truth. Agent authors graph semantics; harness owns mandatory gates and observed statuses. Render a shared validated model into D2 and terminal/dashboard projections.
7. Review challenge: a separate prompt is not independent assurance. Record reviewer provenance honestly, retain findings, bind receipts. Jev cannot certify completeness or authorize mutations.
8. Scope challenge: preserve legacy report visibility and original failures, but do not grandfather old reports into unapproved mutation. Update stale operating guidance rather than delete historical evidence.

Outcome: ready to implement this roadmap sequentially. Known limitation: semantic adequacy and independently verified review quality cannot be proven by schema validation. A paid live Jev benchmark is not authorized by enabling an adapter; use deterministic injected evaluation and clearly distinguish it from provider effectiveness.

## Progress journal

- Stage 6 results and limits: [optional advisor evaluation](plan-advisor-evaluation.md). No service credentials were accessed and no paid/provider request was made. Jev remains optional and outside normal approval flow.
- Stages 4–6 use `/tmp/ctg-tested-planning`, an isolated Git worktree, to preserve concurrent unrelated provider/TUI changes in the original checkout. Local Firefox was blocked by snap's `/tmp` namespace; CI Firefox passed for stages 4–5.
- Initial repository inspection confirms current plan-existence gate and fixed D2 suffix do not meet this contract. No implementation changes were made before documenting and challenging this plan.
