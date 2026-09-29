# Context efficiency implementation plan

Saved before implementation. Based on nine-cell v4 evidence: five harness cells exceeded the local input-byte envelope; one hit output length. Preserve all v1–v4 evidence. No paid benchmark rerun or production repository change is authorized by this implementation stage.

## Boundaries and invariants

1. `lib/delivery-context.mjs` pure projections own compact recovery/status/review receipts, byte accounting and conservative history selection. They cannot mutate lifecycle, acceptance, checks, evidence or approval. Exact active acceptance text, validator argv, outputs, progress and all unresolved blockers remain in recovery; size is measured, never silently trimmed to a hard cap.
2. Extension owns archive persistence and event integration. Superseded successful **delivery-only, fully paired** tool turns can become archive receipts in outbound context; original session/report are untouched. Failed results, user messages, mixed coding batches, incomplete pairing, and recent delivery turns remain verbatim. Do not archive captures during pending design review. Receipts link to immutable content-addressed archives; archive failure retains original messages.
3. Compact normal status and review responses stop serializing nested planning history/capture/revisions. Inspection must remain available in full; large inspection output must have a real complete artifact, not the current misleading generic truncation notice. Reading/semantic review remains model-authored. Any paging is explicit, with digest/source/capture identity retained; large captures are not considered read because a pointer exists.
4. Compaction integration uses pi's documented lifecycle, not a second summarizer. Refresh active run before restoring a deterministic recovery record. No model summary can create approval, erase blockers or certify freshness. Do not silently enable paid compaction or override user settings. Add explicit pressure advice/telemetry and document conservative native compaction settings; automatic byte-triggered compaction remains gated on tested engine support.
5. Metrics contain numeric category byte counts (system/schema/messages/reasoning/tool classes), no message bodies. Token estimates are labeled estimates, not tokenizer guarantees. A useful large-fixture test must show meaningful reduction while retaining exact obligations.

## Challenges and validation before delivery

- Restore after compaction, revision, source edits and branch switching: approval still locked when stale; exact validators/acceptance/outputs and failed evidence remain visible.
- Old tool-call batches: never orphan IDs or merge tool results across user messages; preserve every failed result. Retained provider reasoning signatures untouched; archived whole turns remove their replay metadata together.
- Full capture >48KB: parseable response, real retrievable archive, no mutation of capture, missing sections explicitly disclosed. Small-capture compatibility retained.
- Archive corruption/symlinks/write failure fail conservatively; do not prune data without a verified archive. Session files and reports remain unchanged by projection.
- Metric category totals, multibyte strings, no prompt/key leakage. Context pressure must not initiate paid retries/compaction unexpectedly.
- Pure tests + real extension integration + repository quality; benchmark manifests and historic result documents remain preserved. No benchmark superiority claim from synthetic byte savings.

## Subsequent repository benchmark design

After implementation, design a preregistered suite, not tasks selected because baseline pi failed. Use realistic feature additions across pinned existing repositories: authorization/migrations, cross-layer optimistic updates, third-party API integration, background jobs and compatibility changes. Separate offline hermetic and authorized online documentation tracks. Specify pristine base SHAs, dependencies/services, network rules, protected tests, held-out probes, paired budgets, common compaction settings and >=3 repetitions. Include old/new harness ablation and Jev separately. Publish development pilots separately from untouched test tasks. Actual expensive runs require a separate frozen manifest and cost authorization.
