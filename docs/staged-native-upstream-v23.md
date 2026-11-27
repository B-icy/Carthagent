# Staged native upstream fixes v23

This is staged source only. The published runtime, release manifest, package
versions and `CTG_RUNTIME_PATCH_SHA256` remain unchanged on combined-v21.
Selecting v23 for a release is a separate manual step.

Candidate patch: `docs/patches/opencode-v2.0.32-session-ui-combined-v23.patch`.
Candidate patch SHA-256: `bd938d1600c06caadcf51267f962121e68e01f393d62ad8659e01ca9dea70516`.
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

Each fix is a separate commit that cites one upstream PR.

## Validation

- Regenerated with `git -c core.abbrev=40 diff --full-index` from a clean v2.0.32
  worktree with combined-v22 applied; that command reproduces the v22 bytes exactly.
  `git apply --check` passes on a separate clean checkout of the exact pin, and
  applying and regenerating there gives identical bytes.
- Relative to v22, only `packages/ai/src/protocols/openai-chat.ts` changes; the
  only new section is `packages/ai/test/provider/openai-compatible-chat.test.ts`.
- `packages/ai` `test/provider/openai-compatible-chat.test.ts`: 22 pass, 0 fail.

The candidate recipe and prebuild workflow select v23, including the new focused
regression suites. Five-platform native build/prebuild and merge gates remain
required. No runtime artifact, tag, release, asset upload, or acceptance workflow
is part of this source staging change.
