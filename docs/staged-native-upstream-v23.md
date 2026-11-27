# Staged native upstream fixes v23

This is staged source only. The published runtime, release manifest, package
versions and `CTG_RUNTIME_PATCH_SHA256` remain unchanged on combined-v21.
Selecting v23 for a release is a separate manual step.

Candidate patch: `docs/patches/opencode-v2.0.32-session-ui-combined-v23.patch`.
Candidate patch SHA-256: `9933167c5e96de430d5f53375e46953ebf81387e88ca7fc7cc0156c6bbb7ce8f`.
Base revision: combined-v22 (`26b564635e1e2699797e72cf24a816952962bb392713d3812a98e4a3acb30711`).
Pinned source: `843a6c514e606b436a7fe713422ace0a93ad3d61` (v2.0.32).
Pinned Bun: 1.4.2. The lockfile and upstream MIT license are unchanged.

## Ported upstream fixes

- [OpenCode #66643](https://github.com/anomalyco/opencode/pull/66643),
  commit `ac2263f34c83d9fcb2deaa3e2a98875c45a06639`: map Z.AI's `sensitive`
  finish reason to `content-filter`. Z.AI (GLM) ends a response its safety review
  blocked with `finish_reason: "sensitive"`. The pinned OpenAI Chat protocol has no
  case for it, so the pinned mapper fails the whole stream with an
  `UnknownProvider` error (`Provider finish_reason: sensitive`) instead of a
  content-filter finish. Carthagent runs GLM through this protocol. The port adds
  the case next to `content_filter`, and the upstream test is ported; it fails on
  v22 with that error.
- [OpenCode #66646](https://github.com/anomalyco/opencode/pull/66646),
  commit `3a2e427d0d7453aff2780f5c4d9134aaaf5f8360`: map Z.AI's
  `model_context_window_exceeded` finish reason to `length`. Z.AI ends a chat
  completion with this value when the prompt plus output fill the context window.
  The pinned mapper fails the stream with an `UnknownProvider` error; the port
  treats it like `length`. The upstream test is ported; it fails on v22 with
  `Provider finish_reason: model_context_window_exceeded`.
- [OpenCode #66391](https://github.com/anomalyco/opencode/pull/66391),
  commit `b5ae67aecbcf982952147868356eb38093053142`: keep permission request
  metadata JSON-encodable. Tools copy optional inputs straight into permission
  metadata, and `undefined` is not JSON. HttpApi encodes responses through
  `Schema.toCodecJson`, which rejects `undefined` inside `Unknown`, so a pending
  request with such metadata makes the permission list endpoints fail. At the pin
  the metadata is stored unfiltered: the earlier top-level filter from
  [OpenCode #54090](https://github.com/anomalyco/opencode/pull/54090)
  (commit `1b2c720cbac2ec8d5587395abe59dba698ccdb24`) landed after v2.0.32. The
  port adds #66391's recursive `withoutUndefined`, which also covers #54090's
  top-level case. The pin has no `@opencode/util/record`, so a local `isRecord`
  with the same definition is used. The automation-trigger half of #66391 targets
  `packages/core/src/automation.ts`, which does not exist at the pin, and is not
  ported. The combined #54090/#66391 test is ported; it fails on v22, and encoding
  a request with top-level or nested `undefined` metadata through the response
  codec fails at the pin.

Each fix is a separate commit that cites one upstream PR.

## Validation

- Regenerated with `git -c core.abbrev=40 diff --full-index` from a clean v2.0.32
  worktree with combined-v22 applied; that command reproduces the v22 bytes exactly.
  `git apply --check` passes on a separate clean checkout of the exact pin for each
  intermediate and the final patch, and applying and regenerating there gives
  identical bytes.
- Relative to v22, only `packages/ai/src/protocols/openai-chat.ts` changes. The new
  sections are `packages/ai/test/provider/openai-compatible-chat.test.ts`,
  `packages/core/src/permission.ts` and `packages/core/test/permission.test.ts`.
- Each new regression fails without its port and passes with it.
- Bun 1.4.2 with `GOMAXPROCS=2 GOMEMLIMIT=512MiB`: `packages/ai` full suite 1,823
  pass, 28 skip, 0 fail; `packages/ai` and `packages/core` typechecks pass.
- Core focused suites (`test/permission.test.ts` and the recipe's session
  compaction, shell retention, Promise plugin and plugin-source suites): 134 pass,
  0 fail. Core tool suites that raise permission requests (`test/tool-*.test.ts`
  for edit, opencode, patch, question, read, registry, search, shell, skill,
  subagent, webfetch, websearch and write): 339 pass, 42 skip, 0 fail. Server
  `test/config.test.ts`, `test/fetch.test.ts` and `test/session-instances.test.ts`:
  15 pass, 0 fail.

The candidate recipe and prebuild workflow select v23, including the new focused
regression suites. Five-platform native build/prebuild and merge gates remain
required. No runtime artifact, tag, release, asset upload, or acceptance workflow
is part of this source staging change.
