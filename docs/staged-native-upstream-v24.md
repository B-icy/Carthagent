# Staged native upstream fixes v24

This is staged source only. The published runtime, release manifest, package
versions and `CTG_RUNTIME_PATCH_SHA256` remain unchanged on combined-v21.
Selecting v24 for a release is a separate manual step.

Candidate patch: `docs/patches/opencode-v2.0.32-session-ui-combined-v24.patch`.
Candidate patch SHA-256: `3fe2540c266ddb71c0b3dfb77c3c9945a1964479f2848c2233838b8f180d3a3a`.
Base revision: combined-v23 (`50e92d9bb9a85ce7b70feec69871df6c1530e77149cda2bfb1fae8d0823f342c`).
Pinned source: `843a6c514e606b436a7fe713422ace0a93ad3d61` (v2.0.32).
Pinned Bun: 1.4.2. The lockfile and upstream MIT license are unchanged.

## Ported upstream fixes

- [OpenCode #66798](https://github.com/anomalyco/opencode/pull/66798),
  commit `8db8c7f366d68f9630e982fe774a1642a3e553f9`: ignore `x-should-retry` on
  successful responses when the stream drops. A provider sends its headers before
  the body streams. If the connection then drops after a 2xx response that said
  `x-should-retry: false`, the pinned `isRetryable` in
  `packages/ai/src/provider-error.ts` still honors the header and refuses to
  retry a failure the header never described. Session step retry
  (`SessionRunnerRetry.isRetryable`), compaction retry and the media
  generation-poll GET retry all use that function. Once output has started, the
  step runner already retries an interrupted stream, so the step change matters
  for drops before the first output event. The port honors the header only for
  HTTP status 400 and above. Upstream moved the check into a new
  `AIError.retryHint` getter, which `AIError.isRetryable` and `notRun` in
  `packages/core/src/model-retry.ts` use. Neither the getter nor
  `model-retry.ts` exists at the pin, so the port changes the pinned function
  instead. The upstream `provider-error` and `session-error` regressions are
  ported against the pinned function, and the pinned compaction scenario that
  relied on a 200 response's header now uses a 429 rate limit, as upstream
  changed it. The `ModelRetry.retryOneShot` test and the
  `startup-prompt.test.tsx` isolation change target files absent at the pin and
  are not ported.
- [OpenCode #66796](https://github.com/anomalyco/opencode/pull/66796),
  commit `0b22cf9195dbbf03f2f4abda53c3289e68013b9c`: classify Tencent TokenHub's
  `400003` error (`Input tokens exceed the model context limit`) as context
  overflow. OpenCode Go passes it through for Hy models. The pinned pattern list
  has no match, so the session runner treats it as an ordinary invalid request
  instead of an overflow it recovers from by compacting. The port adds the
  upstream pattern, and the upstream tests are ported.
- [OpenCode #66863](https://github.com/anomalyco/opencode/pull/66863),
  commit `93e3b623db26a3984263c4fe2fed276624851325`: stop TUI slot resolution
  from hanging on a slot path with an empty segment. When a claim targets a
  missing path with a leading dot, `survivingAncestor` in the pinned
  `packages/tui/src/plugin/structure.ts` loops forever, because `lastIndexOf`
  clamps a negative start to 0. The Carthagent TUI plugin registers slot claims
  through this resolver, so one malformed target from any enabled plugin freezes
  the TUI. The port, identical to upstream, suppresses claims whose target is
  empty or has an empty segment and stops the ancestor walk before index 0. The
  upstream worker-based regression is ported; without the port it times out
  after 5 seconds.

Each fix is a separate commit that cites one upstream PR.

## Validation

- Regenerated with `git -c core.abbrev=40 diff --full-index` from a clean v2.0.32
  worktree with combined-v23 applied; that command reproduces the v23 bytes exactly.
  `git apply --check` passes on a separate clean checkout of the exact pin for each
  intermediate and the final patch, and applying and regenerating there gives
  identical bytes.
- Relative to v23, no existing section changes. The new sections are
  `packages/ai/src/provider-error.ts`, `packages/ai/test/provider-error.test.ts`,
  `packages/core/test/session-error.test.ts`,
  `packages/core/test/session-runner.test.ts`,
  `packages/tui/src/plugin/structure.ts` and
  `packages/tui/test/plugin-structure.test.ts`.
- Each new regression fails without its port and passes with it. Without the
  ports, the three `packages/ai` regressions and the `session-error` regression
  fail, and the TUI regression times out after 5 seconds.
- Bun 1.4.2 with `GOMAXPROCS=2 GOMEMLIMIT=512MiB`: `packages/ai` full suite 1,825
  pass, 28 skip, 0 fail. `packages/ai`, `packages/core` and `packages/tui`
  typechecks pass.
- Core: `test/session-error.test.ts` 11 pass; `test/session-runner.test.ts` 229
  pass; `test/session-runner-retry.test.ts`, `test/session-compaction.test.ts`,
  `test/session-native-compaction.test.ts` and `test/permission.test.ts` 127 pass;
  0 fail. AI recipe suites (`test/executor.test.ts`,
  `test/provider/openai-compatible-chat.test.ts`) 65 pass, 0 fail.
- TUI: `test/plugin-structure.test.ts` and `test/plugin-source.test.ts` 63 pass;
  `test/plugin`, `test/plugin-discovery.test.ts`, `test/plugin-keymap.test.tsx`
  and the plugin theme suites 105 pass; 0 fail.

The candidate recipe and prebuild workflow select v24, including the new focused
regression suites. Five-platform native build/prebuild and merge gates remain
required. No runtime artifact, tag, release, asset upload, or acceptance workflow
is part of this source staging change.
