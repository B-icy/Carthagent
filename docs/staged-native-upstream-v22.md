# Staged native upstream fixes v22

This is staged source only. The published runtime, release manifest, package
versions and `CTG_RUNTIME_PATCH_SHA256` remain unchanged on combined-v21.
Selecting v22 for a release is a separate manual step.

Candidate patch: `docs/patches/opencode-v2.0.32-session-ui-combined-v22.patch`.
Candidate patch SHA-256: `649cfb098f8a2afc7f44de17d3bcdfb54d64a862866c665bf7bc200169a6c5e1`.
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
  A new focused test checks the recorded watch subscription; it fails on v21.

## Validation

- Regenerated from a clean v2.0.32 worktree with combined-v21 applied.
  `git apply --check` passes in a separate clean checkout of the exact pin.
- Relative to v21, only `packages/plugin/src/promise/adapter.ts` changes; every
  other difference is a new section for the files listed above.
- The pre-aborted-removal regression fails before the port and passes after it.
- Bun core focused suites: 27 passing tests, including session compaction, shell
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

The candidate recipe and prebuild workflow select v22, including the new
regression suite. Five-platform native build/prebuild and merge gates remain
required. No runtime artifact, tag, release, asset upload, or acceptance workflow
is part of this source staging change.
