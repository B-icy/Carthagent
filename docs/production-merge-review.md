# Existing implementation production-branch merge

## Scope and plan

User authorized merging existing work. Merge the current context-efficiency, opt-in Jev, startup guidance and benchmark/report history into current origin/main via PR. Preserve main's thinking-model catalog changes. No deployment, new paid benchmark, automatic Jev enablement or timeout-repair implementation is authorized by this merge.

1. Reconcile current main into this branch without overwriting either worktree's unrelated work.
2. Review production diff for SRP/DI, authority changes, default paid dispatch and durable evidence preservation; keep known benchmark failures and proposed-only timeout plan explicit.
3. Run local quality plus available offline benchmark/integration tests. Use remote CI for OS/Node matrix, Python and browser checks. Do not equate green tests with semantic completeness.
4. Publish PR with author review (not independent approval), known limitations and test receipts; merge only after green CI and no unresolved merge blockers. Verify resulting main commit remotely and fast-forward local main only if still clean.

## Author challenge before integration

- New runtime modules separate pure context projection/discovery/guide, archival filesystem effects, advisor orchestration and injected provider transport. Existing serialized workspace operation remains the caller; advice does not write approval or resolve blockers.
- Jev defaults disabled; explicit opt-in plus provider credentials required. Exact requested OpenRouter model typesafe/jev-1.13, Decisions API, bounded inputs/response/time and durable three-attempt maximum. This is not a global dollar limit or zero-retention feature.
- Archives can retain sensitive original content; content-addressed local writes precede outbound substitution. Full report/session history retained. Pointer is not proof of reading. Context reduction and guide do not claim reliable autonomous completion.
- Benchmark-only gateway still has buffered stream diagnostics, question-contract drift and imperfect terminal error classification; hardcoded local fixture paths make these tools operator-specific, not production runtime dependencies. They are preserved as historical experimental infrastructure; no paid invocation in normal quality/CI.
- Current pilot results show uncompleted deliveries and no scored Jev dispatch. Merge ships an optional critic and deterministic ergonomics, not demonstrated Jev effectiveness or fixed provider timeouts.
- Proposed design-section patching, streaming timing instrumentation, command deadline changes and new pilot repetitions remain unimplemented in delivery-timeout-repair-plan.md.

## Verification

Integrated origin/main at72f819a cleanly; thinking-model catalog/TUI changes preserved. Fresh npm run quality: lint/typecheck/build and362/362 tests pass. Separate node --test tools/benchmark/*.test.mjs:18/20 pass, including actual installed-engine offline full delivery, mocked advice, TLS transport and billing/profile tests. Two historical browser evaluator tests fail because local Snap geckodriver cannot preserve its mount namespace (driver log: Invalid argument, unexpected eof); shop6/6 non-browser categories and voxel7/7 non-browser categories pass. These failures remain disclosed, not converted to skips. Logs /tmp/ctg-production-quality.log and /tmp/ctg-production-benchmark-tests.log; historical evaluator diagnostic artifacts retained under /home/baissi/benchmarks/infrastructure-tests/. No live paid calls. Remote OS/Node/Python/browser CI pending at PR publication. Review is author-performed; independent human approval is not claimed.
