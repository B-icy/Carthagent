# Live adaptive-planning trial

A reproducible, dependency-free five-package billing fixture for observing `ctg` planning, test selection, revision recovery and same-session continuation. This is an **opt-in paid-provider trial**, not part of `npm test` and not a benchmark of large-codebase effectiveness.

Read [NOTES.md](NOTES.md) for the original results and [ASSURANCE-NOTES.md](ASSURANCE-NOTES.md) for the fresh safeguards trial, improvements and retained broader numeric failures. Both runs finished verified against declared checks; an independent numeric-boundary probe still found incorrect behavior.

## Files

- `setup.mjs`: creates a separate Git repository under ignored `workspace/`, commits only its seeded baseline, and writes an ignored absolute-path validator manifest.
- `task.md`, `followup.md`: exact prompts.
- `run.mjs`: invokes this checkout's `bin/ctg.mjs`, captures stdout/stderr, samples report transitions, copies the saved session, records exit status and applies an external deadline.
- `inspect.mjs`: reads saved session events to summarize tool calls, errors and provider-reported usage.
- `verify.mjs`: public API, shared arithmetic, CSV and real CLI contract checks; base mode is an injected required validator. Additional numeric-noise mode is visible in source.
- `verify-reconciliation.mjs`: post-run independent check of order-independent final-safe batch totals.
- `verify-numeric-boundary.mjs`: exploratory numeric/string equivalence check that fails on the original candidate and passes on the assurance candidate.
- `verify-magnitudes.mjs`: broader independent 144-case sweep; eight failures remain on the assurance candidate.
- `runs/`: ignored local logs, original session snapshots, report snapshots and metrics.

## Reproduce from a fresh checkout

Requires Node 22+ and configured Carthagent credentials. The runner explicitly uses `lattice/gemini-3.8-flash-high`; adjust its provider/model before launching if unavailable. This spends provider usage; the tool/time limits are **not a billing cap**.

```sh
node tests/live-planning/setup.mjs
cd tests/live-planning/workspace
npm run quality
node ../verify.mjs base                  # expected to fail on the seed
cd ../../..
node tests/live-planning/run.mjs initial
node tests/live-planning/inspect.mjs
node tests/live-planning/run.mjs followup
```

Each run refuses to overwrite existing output; setup refuses to overwrite the existing candidate. Set `CTG_TRIAL=another-name` for both setup and run to create an independent `workspace-another-name/`, `validators-another-name.json`, and `runs/another-name/` without disturbing earlier trials. Archive prior evidence explicitly or use a fresh checkout for a new trial. Do not delete previous failed trials just to retain successes. Run the follow-up promptly: it resumes the same session, preserving its 90-tool/900-second budget rather than resetting it.

Independent checks after both runs:

```sh
cd tests/live-planning/workspace
npm run quality
node ../verify.mjs followup
node ../verify-reconciliation.mjs
node ../verify-numeric-boundary.mjs      # fails on the observed candidate
node ../../../bin/ctg.mjs status
```

The original `ctg -p` runs did not stream tool events. The updated runner uses `--json` and saves live JSONL tool events in `stdout.log`. To monitor while it is active, run `node tests/live-planning/inspect.mjs` in another shell and inspect `runs/<phase>/observations.jsonl`. Do not edit candidate source during checks. The report sampler may miss short-lived transitions; consult the session JSONL for authoritative tool history.

The candidate Git baseline is local to the fixture. Candidate changes, model-generated files, raw provider events and validator paths are ignored in the parent repository. The scaffolding and written findings are intended to remain reviewable source files.
