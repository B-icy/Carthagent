# Web-search permission prompt said "OpenCode"

Found in 1.1.0 QA on Invest-With-Friends: Ship's first web search opened a
blocking dialog titled **Web Search** asking "Allow **OpenCode** to search the
web for up-to-date information?". Carthagent users never chose an "OpenCode"
product, so the prompt reads as a third-party request.

The prompt is built by the runtime's websearch tool
(`packages/core/src/tool/plugin/websearch.ts`); the plugin API cannot rewrite
host form fields, so the fix belongs in the owned runtime patch.

## Change

- `combined-v15` = `combined-v14` + the one-string change (and its runtime
  test expectation) to "Allow Carthagent to search the web…".
- `development-v20` = `development-v19` + the same change.
- Build recipe, publish workflow and the development pin move to v15/v20.
  The published pin (`CTG_RUNTIME_PATCH_SHA256`, `runtime-release.json`)
  stays on combined-v14; users get the fix when a runtime built from v15 is
  prebuilt, verified and promoted.

## Evidence

- `git diff` of v14→v15 (ignoring `index` lines): only the two hunks above.
  Same for development-v19→v20.
- v15 applies to pristine upstream 843a6c5 with `git apply`.
- Runtime (Bun 1.4.2, Linux ARM64): `packages/core` `test/tool-websearch.test.ts`
  11 pass, 0 fail.
- `packages/core` typecheck (`tsgo -b`) passes.
