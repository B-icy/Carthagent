# Bounded context compaction

Both vendored engine compaction paths use `vendor/agent/bounded-summary.mjs`.
After refreshing the engine bundle, run `node tools/patch-compaction.mjs`. The
patcher validates its anchors and fails rather than guessing at changed code.

Compaction starts at the earlier of 70% of the context window or the configured
reserve boundary. Context estimates take the maximum of usage-based tokens and
serialized UTF-8 bytes divided by four, including when cache usage is available.
This is conservative for the managed gateway, whose current catalog advertises
its serialized byte cap divided by four as the usable context window.

Summary requests use half the catalog-derived byte cap (or half an explicit
`maxRequestBytes`, if stricter), measured against their serialized context.
The remaining space allows for transport encoding, provider fields, and output.
This is a conservative bound, not an exact tokenizer or wire-payload measurement.
Provider size rejections halve the budget and retry with smaller fragments.

Oversized history is split at Unicode-safe boundaries. Every fragment includes
instructions to preserve constraints, paths, unresolved failures, and next steps.
Ordered fragment summaries are recursively combined into one checkpoint. No raw
history is silently truncated. Prior summaries and custom instructions are part
of the input being reduced. Each subrequest has a distinct session/operation seed;
all returned usage is accumulated. Output is capped at 4096 tokens per request.

Aborts, non-size failures, empty/tool-call/truncated responses, non-converging
reduction, and the 128-request/eight-level limits fail compaction rather than
persisting an incomplete checkpoint. The UI labels this as a failure, not success.
There is no guarantee of lossless semantic compression: summaries remain model
generated. Tests use deterministic transports and cover bytes, chunk coverage,
adaptive rejection recovery, cancellation, failure states, and UI notices.

Restart CTG after updating to load the new engine and UI. Existing session logs
and working files are not rewritten by this update.
