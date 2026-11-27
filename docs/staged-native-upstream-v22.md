# Staged native upstream fixes v22

This is staged source only. The published runtime, release manifest, package
versions and `CTG_RUNTIME_PATCH_SHA256` remain unchanged on combined-v21.
Selecting v22 for a release is a separate manual step.

Candidate patch: `docs/patches/opencode-v2.0.32-session-ui-combined-v22.patch`.
Candidate patch SHA-256: `26b564635e1e2699797e72cf24a816952962bb392713d3812a98e4a3acb30711`.
Pinned source: `843a6c514e606b436a7fe713422ace0a93ad3d61` (v2.0.32).
Pinned Bun: 1.4.2. The lockfile and upstream MIT license are unchanged.

## Ported upstream fixes

- [OpenCode #65980](https://github.com/anomalyco/opencode/pull/65980),
  commit `57f83d690d97297678ed181136d02139ff342c66`: honor abort signals
  in Promise plugin API calls. The pinned adapter accepts only the input argument
  at runtime, ignoring request options. Carthagent already supplies these signals,
  for example to `context.session.get` in its native plugin.
- The port adds the upstream pre-aborted guard before decoding or executing a
  mutation and passes the signal to the existing Effect runner. It preserves
  v21's invocation-context adaptations and adds no dependency or public API.
- Regression coverage uses the pinned session API rather than the newer upstream
  automation API. An aborted removal leaves the session intact. In-flight calls
  interrupt and run their finalizers. Completed successes and errors remain
  unchanged, and calls without a signal continue to work.

The abort-reason follow-ups #66041 and #66102 are intentionally not ported:
upstream reverted both in [#66140](https://github.com/anomalyco/opencode/pull/66140),
while retaining #65980. An in-flight rejection keeps the Effect runner's existing
error contract; this patch does not promise identity with `AbortSignal.reason`.

## Further ported fixes

- [OpenCode #66471](https://github.com/anomalyco/opencode/pull/66471),
  commit `1e16a3177b4e024e733078822cf3be63d623e396`: ignore `node_modules` and
  `.git` in configured plugin directory watches. Carthagent writes its native
  plugin as an absolute configured plugin directory, which the pinned
  `ConfigPluginSource` watches recursively with no ignore list. Upstream passes
  `FSUtil.ignoreGlobs`, which the pin does not have, so the port uses the pinned
  config watcher's own list (`node_modules`, `.git` and their nested globs).
  Upstream's newer list also covers `.venv`, `venv` and `__pycache__`; the port
  intentionally keeps the pin's narrower list for this TypeScript plugin path.
  A new focused test checks the recorded watch subscription; it fails on v21.
- [OpenCode #66477](https://github.com/anomalyco/opencode/pull/66477),
  commit `f3b5e9fa0ae7fac2c5516ccb3481ecc3b3d15831`: name the request method and
  URL in bare provider HTTP errors. The pinned `packages/ai` executor reports only
  `Provider request failed with HTTP <status>` for empty or HTML error bodies, which
  hides a misrouted custom provider base URL. The message now appends the method,
  origin and path; the query string and fragment are dropped so key parameters
  never reach the message. Recognized and raw provider bodies are unchanged. The
  upstream executor tests are ported; the empty-body and HTML cases fail on v21.

## Validation

- Regenerated from a clean v2.0.32 worktree with combined-v21 applied.
  `git apply --check` passes in a separate clean checkout of the exact pin.
- Relative to v21, only `packages/plugin/src/promise/adapter.ts` changes. The
  other differences are new sections: `packages/ai/src/route/executor.ts`,
  `packages/ai/test/executor.test.ts`, `packages/core/src/config/plugin/source.ts`,
  `packages/core/test/config/plugin-source.test.ts` and
  `packages/core/test/plugin/promise-abort.test.ts`.
- The pre-aborted-removal regression fails before the port and passes after it.
- #66471 and #66477 were added as separate regenerations with
  `git diff --full-index`, which reproduces the earlier v22 bytes exactly. The
  plugin-source watch regression and the two upstream executor cases fail
  without their ports and pass with them.
- After both ports: `packages/ai` 1,821 passing tests, no failures; 325 passing
  core tests across `test/config/`, `test/aisdk.test.ts`, the plugin supervisor
  and the focused recipe suites; `packages/ai` and `packages/core` typechecks pass.
- For #65980, Bun core focused suites: 27 passing tests, including session compaction, shell
  retention, Promise tool invocation context, session removal and cancellation.
- Bun plugin package: 9 passing tests. Core and plugin typechecks pass with
  `GOMAXPROCS=2 GOMEMLIMIT=512MiB`. An initial 180-second core typecheck timed out;
  the bounded incremental retry completed.
- Broader plugin run: 440 pass, 1 fail. The organization-integration reload case
  in `test/plugin/supervisor-reload.test.ts` fails with `pending` on this host.
  Its isolated run has 7 pass and 1 fail both before and after the port.
  No timeout or assertion was weakened to hide this baseline failure.
- Carthagent `npm run check` passes. The patch/workflow/runtime selection tests
  pass (77 tests). `npm run quality` passes: 1,432 passing tests, 5 skipped,
  no failures, including lint, formatting and TypeScript checks.

Combined-v23 now supersedes v22 as the staged candidate; see
`docs/staged-native-upstream-v23.md`. When v22 merged, the candidate recipe and
prebuild workflow selected it, including the new regression suite. Five-platform native build/prebuild and merge gates remain
required. No runtime artifact, tag, release, asset upload, or acceptance workflow
is part of this source staging change.
