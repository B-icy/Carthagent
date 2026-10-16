# Carthagent model registry

Carthagent discovers Claude and ChatGPT models directly from their provider
endpoints. It does not use pi.dev's version-gated remote model catalog.
The forked engine remains the inference/session implementation; this change
does not replace that engine or its protocol-compatible OAuth integrations.

`lib/providers/model-catalog.json` is the versioned, offline metadata catalog
for these providers. Initial definitions were migrated from the bundled engine
to preserve existing compatibility and pricing; future changes are reviewed
here, independently of engine upgrades. Opus 5.5 has a 1M context window and
128K output limit. Its price is intentionally omitted until verified, rather
than assuming an earlier model's price. Unknown discovered models still use
conservative provider defaults, so discovery is not a claim of verified limits.

Direct discovery merges account-visible IDs with known metadata and stores a
last-known-good discovery in `subscription-models.json`. Failed discovery does
not replace that snapshot. The TUI reads the live registry on picker open,
direct model selection and thinking checks. While an overlay is open, its
existing 2.5-second state poll also refreshes the model list (local RPC only).

After replacing vendor/agent, reapply `node tools/patch-model-catalog.mjs`
alongside the compaction patch. The patch fails if its anchor changes; the
runtime regression test rejects pi.dev requests. Other engine providers retain
their bundled offline definitions and any native provider discovery hooks.
