# Planning startup repair — author review and results

## Implemented

On-demand `delivery_design action=guide` works before a plan without source fingerprint, workspace mutation, or advice call. Compact tested example explains actual component/port/scenario/review fields, requirements and check references; no automatic boilerplate insertion or approval.

Discovery checkpoint at8 built-in discovery results or2 blocked implementation attempts, with stronger wording at16 results. It asks for the first accurate plan or one missing fact. Reads stay available; existing execution gates unchanged. Numeric-only metadata is bounded on restoration and loaded from selected branch. New input resets it, successful plan suppresses it, informational asks are excluded heuristically. Context injection is outbound, not a repeated persistent prompt message.

Unknown IDs/requirement text include invalid values and valid references. Findings remain blocking. Error presentation handles malformed non-array design sections instead of throwing while explaining validation.

Both built-in Jev adapters now transmit check definitions/argv, outputs and assumptions alongside prior semantic input. Test question distinguishes declared commands from execution evidence. Validation precedes optional advice: invalid inspect sends zero calls and reserves zero attempts. Same caps/timeouts, opt-in and no authority; expanded external disclosure documented.

## Tests and challenges

- `npm run quality`: lint/typecheck/build and **360/360 tests pass** (`/tmp/ctg-startup-quality-final.log`).
- `node --test tools/benchmark/planning-startup.test.mjs`: **1/1 installed-engine offline scripted test passes** (`/tmp/ctg-startup-engine-final.log`),20 tool starts:8 reads -> checkpoint -> guide -> plan/validate/inspect/self-review/approve -> actual file write -> real assertion subprocess -> progress/final diff review -> verified.21 zero-cost mocked provider responses. No actual external provider or credentials used.
- Extension loop test adds invalid check reference -> rejected inspect/zero advice -> preserving revision -> real loopback mock Jev returning a flagged tests topic -> ordinary review/approval/edit/check/final review. Schema guide itself passes production structural validators.
- Branch navigation restores only selected checkpoint; compaction notification and session restoration preserve counters. Questions and terminal plans suppress reminders. Existing stale-source, user-validator and persistent-blocker suites pass.
- Both adapter payload/bounds tests verify extra fields unchanged, no plan mutation, and oversized check argv rejected.
- `git diff --check`: clean.

This is **author review**, not independent approval. Scripted plumbing proves the workflow is traversable, not that DeepSeek will stop discovery sooner. No new native model-generated compaction test/paid call or benchmark rerun here. Provider180s deadlines and CURL_56 are not fixed by these changes; no timeout increases, automatic paid retries, token-limit changes or new spending authorization introduced. No browser/Python suite or remote CI/merge claimed.

The old `/tmp/ctg-tested-planning` checkout disappeared between turns. Committed history/artifacts survived; reconstructed edits are now under `/home/baissi/ctg-planning-startup`, branch `fix/planning-startup`, based on93c3693. Primary checkout untouched. Historical benchmark source manifests correctly will not validate this changed implementation; their artifacts are not rewritten.
