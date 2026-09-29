# GLM 5.3 Flash generator switch

User requested GLM5.3 Flash instead of DeepSeek. Verified exact public OpenRouter catalog ID `z-ai/glm-5.3-flash`, not FlashX/latest/batch, at https://openrouter.ai/api/v1/models; receipt `/home/baissi/benchmarks/glm-model-discovery/openrouter-glm.json`. Advertised tool and reasoning support; prices $0.15/M prompt, $0.50/M completion, $0.03/M cache read. Catalog metadata is not live compatibility evidence.

Design: fixed host-owned allowlisted generator profiles in existing billing gateway. Historical DeepSeek default remains for original benchmark/tests; repository pilot explicitly selects GLM. Model returned must match configured exact ID. Freeze model-profile source; never accept client routing/pricing overrides. Same existing cost reservations bound GLM pricing. Jev model/endpoint stays separate.

New repository-pilot root `glm-repo-pilot-v1`, reuse preserved setup but fresh candidate workspaces/freeze. Keep prior campaign ledger/$15 aggregate cap and unresolved holds; no reset. Same tasks/limits/30k compaction threshold for comparability, deliberately not use GLM advertised >1M context to hide workflow issues. Updated startup guidance used in both treatment arms. New model AND new harness means historical differences cannot isolate a model effect.

Author challenge: silently changing generic gateway default would invalidate historical test assumptions; rejected. Loosely accepting latest model aliases undermines identity; reject. Raising caps on switching models masks costs; reject. Catalog tools/reasoning claims need live preflight before candidates. Tests assert correct profile prices, rejected cross-model request and wrong returned identity with known-bill reconciliation. No paid call or matrix until readiness/freeze complete. This change configures the requested generator; does not switch the model serving this chat or claim completed GLM task runs.

## Validation and compatibility smoke

360 repository tests/lint/typecheck/build pass;6 focused gateway/profile tests pass. Live isolated read-only smoke used actual `z-ai/glm-5.3-flash`, returned by SiliconFlow;2 tool starts (read package.json, delivery_design guide), expected SMOKE_OK/fastify/authority none,13.951s,2 paid requests,$0.00234681 known,zero unresolved holds. Billed to existing smoke allowance; no ledger reset. Artifacts under `/home/baissi/benchmarks/glm-repo-pilot-v1/smoke-compatibility-harness`, summary `compatibility-smoke.log`.

This verifies basic tools/serialization, not full delivery or compaction. No task matrix has started or been frozen yet. Historical failures/holds preserved. Author validation, not independent review/remote CI.
