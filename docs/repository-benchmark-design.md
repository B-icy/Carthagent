# Repository-scale daily development benchmark — design proposal

## Aim and honest hypothesis

Test whether Carthagent improves **correct feature delivery and regression avoidance** in existing repositories under matched resources, including permissioned online documentation. Do not construct a leaderboard of tasks selected because pi already failed. Harder tasks should challenge baseline and treatment alike; unknown outcome is the point.

This is a design/selection proposal, **not a runnable or frozen benchmark yet**. No task has an implemented withheld evaluator, proven environment or reference patch in this suite. Repository SHAs below are discovery anchors, not execution bases. Budget estimates are proposals, not spending authorization.

## Candidate repositories: verified discovery, not inferred from search snippets

Primary GitHub API metadata and raw README contents were retrieved into `/home/baissi/benchmarks/repo-suite-design/`. Search-engine results were irrelevant and were not used as evidence.

- **Saleor core:** discovery SHA `9ea6bdeae2e704cc01f6659e9c4f87a83d0ce245`. Its README describes GraphQL-only headless commerce, channels, payments/webhooks and a separate dashboard; warns that main is unstable and recommends compatible release versions. Choose a stable release base plus compatible dashboard/storefront pins, not blindly this main SHA. API metadata identifies BSD-3-Clause; inspect licenses in all selected components before packaging fixtures. Sources: https://github.com/saleor/saleor/blob/9ea6bdeae2e704cc01f6659e9c4f87a83d0ce245/README.md and https://api.github.com/repos/saleor/saleor .
- **Medusa core:** discovery SHA `037232847319a12b83f597cce06e24371f96e81f` on develop. README describes a modular commerce framework and **open-core** licensing: core MIT, separately identified enterprise/RBAC materials require a commercial agreement. Restrict tasks to verified core paths or exclude the repository; do not assume the entire tree is MIT. Sources: https://github.com/medusajs/medusa/blob/037232847319a12b83f597cce06e24371f96e81f/README.md and https://docs.medusajs.com/learn/advanced-development/architecture/overview (linked by README; architecture page not independently fetched in this design).
- **Scheduling candidate, identity unresolved:** requested `calcom/cal.com`, discovery SHA `54343aa685ae8f33159d2f485ec4a57bad5c574a`; fetched README identifies **Cal.diy**, a community fork with enterprise features removed, Next.js/tRPC/React/Prisma, PostgreSQL, local yarn/Docker development. Resolve canonical repository/redirects and validate license/path scope before adoption; do not describe it as a verified commercial Cal.com checkout. Source: https://github.com/calcom/cal.com/blob/54343aa685ae8f33159d2f485ec4a57bad5c574a/README.md .
- Directus discovery request returned 404; not selected without resolving its current repository availability.

README architecture claims are verified page contents, not evidence that a local installation runs. The suite needs measured tracked file/LOC counts, package graph, baseline suite duration and feature ownership paths after checkout. 'Large codebase' is not established merely by stars/reputation.

## Six proposed tickets

Final tickets must be checked against the pinned code: exclude functionality already present and avoid copying an existing upstream fix. Freeze exact public contracts before measured runs. Difficulty comes from existing invariants and cross-layer behavior, not obscure guessing.

### R1 — Channel-scoped order CSV export (Saleor + compatible dashboard)

**User story:** An authorized staff member exports filtered orders for one channel from the existing list view, without exposing another channel's/customer's restricted data.

**Acceptance contract:** typed API entry point, existing permission checks, streaming/paginated processing, stable documented column/order/filter semantics, formula-injection-safe cells, UTC timestamps with explicit display timezone policy, audit event, bounded memory, accessible download/error state; existing exports/list filters unchanged. Declare whether the pinned project supports async export before choosing an API shape.

**Withheld evaluation:** cross-channel authorization matrix; user/app role variants; 20k seeded records with bounded memory threshold defined from reference; commas/newlines/Unicode/formulas; cancel/retry behavior; real browser list filter→export; existing relevant GraphQL tests. Mutants remove permission check, skip pagination, or mishandle quoted cells.

### R2 — Optimistic bulk tagging with conflict recovery (Medusa core admin + API)

**User story:** Apply/remove an allowed product label on a filtered selection using existing admin UI, reflecting updates immediately while correctly handling partial failure and another editor.

**Acceptance:** existing typed routes and validation, permission-compatible core paths only, per-record version/concurrency rules, atomicity semantics explicitly chosen, idempotent retry, rollback of failed optimistic rows, stale-response protection after filter changes, keyboard operation and screen-reader status. No enterprise RBAC modification.

**Evaluation:** deterministic delayed/out-of-order HTTP responses, two clients editing same record, validation failure subset, duplicate requests, browser navigation/reload, persistence/restart, existing product tests. Reference patch and mutants establish that tests detect stale UI and lost updates.

### R3 — Configurable reschedule cutoff with DST safety (resolved scheduling community repo)

**User story:** Event owner configures a reschedule cutoff; invitees see localized availability and receive consistent API/UI behavior near cutoff and daylight-saving changes.

**Acceptance:** schema/default migration that preserves old events, owner authorization, explicit instant-based cutoff semantics, existing cancellation rules unchanged, localized message, disabled controls plus server enforcement, idempotent competing reschedules. Define injected clock and fixed timezone database version.

**Evaluation:** before/at/after cutoff, DST gaps/folds, non-hour offsets, invalid timezone, old database migration, simultaneous requests, browser locale switching, unaffected cancellation routes. No real calendar account; local calendar adapter with real HTTP interaction.

### R4 — Webhook consumer API-version upgrade (Saleor/Medusa integration)

**User story:** Update an existing integration to a pinned new upstream event version while accepting the documented old version during transition.

**Acceptance:** authenticate exact raw bytes; reject bad/stale signatures; durable deduplication; tolerate documented nullable fields; explicit version mapping; transactional state changes; backoff/Retry-After; redact credentials in logs; no real payments or outbound customer actions.

**Online track:** agents may fetch pinned vendor API docs/changelog, not hidden solutions or upstream implementing PRs. Evaluator serves both event versions from a local HTTP service with injected clock/failures. The third-party version/schema must be selected and verified during setup; no invented vendor version in the ticket.

**Evaluation:** replay/different payload same event ID, Unicode raw-body signatures, crash between receive/commit, duplicate concurrent delivery, 429 and permanent 4xx, restart; reference/mutants must distinguish retries from double side effects.

### R5 — Persisted advanced search with backward-compatible URLs (admin web app)

**User story:** Users save named filter views, share valid URLs, and restore state across navigation without leaking another user's saved view.

**Acceptance:** schema migration, ownership enforcement, typed query parser, canonical URL encoding, old URLs still accepted, invalid/deleted filter values handled, back/forward works, no stale network response overwrites new state, accessible reset/error UX.

**Evaluation:** two users, migration from old DB, encoded operators/Unicode, malformed query fuzz cases, conflicting request order, browser back/forward/reload, screenshots for review plus objective layout/interaction checks. Existing search routes and API clients remain compatible.

### R6 — Durable background import with cancel/resume (commerce core)

**User story:** Upload a product-import CSV, preview validation failures, start a bounded background job and resume safely after worker restart.

**Acceptance:** existing storage/queue seams, explicit row-level transaction/idempotency semantics, progress and cancellation state machine, maximum upload limits, formula/text handling, no partial undocumented silent success, old synchronous API compatibility if present, no customer-data outbound traffic.

**Evaluation:** malformed row midway, worker termination after database commit before acknowledgement, repeated upload/key, cancel racing commit, retry permanent errors, scoped status polling, real queue/DB/browser. Small and large files; resource bounds calibrated against reference, not arbitrary impossible latency requirements.

## Tracks and network policy

1. **Hermetic development:** prebuilt containers/dependency cache, local DB/Redis/mail/webhook stubs; no outbound network during candidates. Frozen documentation snapshot provided equally.
2. **Online documentation:** same containers and tasks/budgets; read-only HTTPS allowlist for official docs, registry metadata and specified upstream source reference pages. Supervisor fetch proxy records URL/time/status/response hash and serves cached identical content for matched runs. Separate cold-live exploration pilot from reproducible cached evaluation.

The public web can contain misleading instructions. Treat fetched content as data, not benchmark authority. No production credentials, real payments/calendar events, deployments, public issue/PR submissions, repository pushes or access to supervisor evaluations. External tools need read-only treatment consistently in both arms; granting arbitrary shell before plan approval is not an acceptable workaround. Network/tool isolation must be an actual container/network policy, not merely a prompt. Dependency installs should finish in setup; unavailable upstream docs/services are infrastructure outcomes, not model zeros.

## Fair experimental design

- Primary comparison: **plain pi vs context-efficient Carthagent**, same installed engine/model/provider routing, tools, documentation access, native compaction, temperature/reasoning, container hardware, wall/tool/dollar budgets.
- Secondary ablations: previous Carthagent vs new context projection (separate development tasks); Jev off/on only after primary completion improves. Do not conflate context management, advisor, engine version and larger budgets.
- Split tasks before execution: development tickets for tuning/fixture fixes, held-out feature tickets for reporting. No discard because baseline won or treatment failed. Pilot both arms to calibrate difficulty; publish all pilot outcomes separately.
- Proposed first scored tranche: 4 held-out tickets × 2 arms × **3 paired repetitions** = 24 runs. Balanced/reversed arm order and task order. Add online subset as a separately labeled stratum, not unbalanced extra access for treatment.
- Proposed upper bound per cell: 45 min, 250 tool attempts, $5 including compaction/advisor; **$120 max** for 24 cells, plus explicitly capped setup/diagnostic allowance. Requires user approval and capacity/budget confirmation; do not charge the old $27 campaign. Limits may change during unscored setup only, then freeze.
- Report paired task-level differences, full run distributions and uncertainty; do not treat assertions or three repeats as independent task samples. A few repository tickets cannot establish universal superiority.

## Success and evidence

Primary: strict delivery success = held-out acceptance + protected regression checks + runnable migration/launch + honest final handoff. Separate functional partial-credit, candidate tests, false completion, harness gate completion, time/cost, context growth/compaction calls and infrastructure/resource failures. A runtime pass with missing tests or unfinished handoff is not full success.

Maintain immutable original requirements and validators. Baseline and treatment may not edit protected evaluators or weaken existing tests unnoticed. Save source diff, task-specific file scope, executed commands, DB snapshots, request logs, final answer, screenshots and network receipts. Blind reviewer assesses maintainability/security against a predefined rubric; disclose if the supervisor is the only reviewer. No arbitrary 'one file/function' SRP score. Hidden evaluator location must be inaccessible from candidate containers, not a sibling directory under the same user.

## Readiness gates before any measured run

- Resolve repository identity/license, pin commit + submodules/lockfiles/container digests and compatible companion repositories.
- Create isolated container with non-root user, no host auth mounts, limited egress, resource/process limits, separate evaluator service and fresh DB/queues per cell.
- Install dependencies once; pass existing relevant baseline tests; record unrelated failures without deleting them. Verify browser + migrations and project runtime versions (do not force Node 26 on an unsupported app).
- Implement reference patch for each ticket, withheld tests and semantic mutants; green reference, intentionally red base and mutant failures must prove test sensitivity. Reference/hidden tests never enter candidate checkout or online allowed pages.
- Freeze task text, base SHA, public contracts, test/container hashes, docs corpus, budgets and analysis plan; verify before every launch. Add realistic >400KB history/compaction transport preflight and byte/terminal classification regression tests before paying for candidates.
- Do not start until both arms work in the identical environment and compaction retains obligations. Pause on shared infrastructure failures; retain every cell and any protocol deviation.

## Local capacity check

The current host reports approximately 7.6GiB RAM, 2GiB swap and ample disk; neither `docker` nor `podman` was found on PATH. The scheduling README suggests a development Node heap as high as 16GiB. A large multi-service browser fixture is therefore **not ready on this host**. Start with a smaller single-service API ticket or provision a suitable isolated worker; do not silently install privileged container infrastructure or run commercial services to make the benchmark proceed.

## Implementation status

Only design and repository discovery are complete here. Checkout/license review, containers, pinned runnable bases, six exact tickets/reference implementations, protected evaluators and repeated paid comparisons are **not implemented/run**. This distinction prevents promising a difficult but nonexistent 'pi cannot handle it' benchmark.
