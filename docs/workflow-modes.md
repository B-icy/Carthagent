# Workflow modes and evidence

The ctg CLI defaults to `--workflow standard`. A valid required acceptance contract enables implementation without mandatory component/port/scenario review. Final verification remains strict: fresh check identities, new requirement executions, artifact/output existence, structured step completion and a snapshot-bound final review are required. Step `done` means implementation complete, not passing integrated checks.

`--workflow strict` keeps tested-design approval before implementation. Direct extension hosts default to strict; restored runs retain their recorded workflowMode. Neither mode is an OS sandbox. Informational contracts cannot authorize implementation.

`delivery_probe` exposes only Node/npm version argv with a ten-second bound; it is discovery, not check evidence. Unknown custom tools remain fail-closed.

Partial revisions merge omitted design/workflow object fields; supplied arrays replace their respective arrays. Strict revisions still relock approval. Standard revisions continue implementation but invalidate affected evidence and final review. Validation observes the current plan and records findings without clearing approval; receipt identity still detects changed plans/source.

Graph navigation is permitted during discovery, returns pagination/coverage and supports file/container filtering. Absolute workspace file paths normalize; directory filters return actionable errors. Name-based call matches remain candidates rather than runtime resolution.

## Fast lane (small edits)

`lib/ship-route.mjs` routes a Ship request with rules only: `answer` (shared `looksInformational`), `small` or `full`. Every check that can say `full` runs before anything can say `small`: sensitive words or file paths (auth, sessions, secrets, payments/coins, migrations/schema/SQL, deploy/release/CI, config/env, routes/keys/URLs), status codes and SCREAMING_CASE names, scope words (everywhere/across/all usages), behaviour phrasing (so it/no longer/rejects/bug/to show), names used by other code (exports, models, props, class names, enum/regex/default values, and any rename not said to be local), content the agent would invent ("the new setup steps"), bumps without an exact version, several parts, and no named file. `small` then needs a small kind of edit (typo/rename/comment/wording/bump/...) and an edit verb. `tests/fixtures/ship-routes.json` holds labelled requests; CI fails if any labelled full request routes small. Add every misroute you meet there. A `small` route frames the task with `prompts/delivery-small.md`, which points the model at `delivery_small`:

- `action:"start"` is refused unless the router chose `small` for the current request. It takes `goal`, 1–3 `files` and at least one test/runtime check, creates a required plan (no review step) and unlocks edits. It snapshots `git diff --numstat` and the declared files' text, and sets the lane kind from the request wording (`lib/small-lane-diff.mjs`): `text`, `rename`, `imports`, `whitespace` or `bump`.
- `action:"finish"` measures the change. Undeclared files, more than 3 files, more than 80 changed lines, or content outside the lane kind escalate it. `text` allows only comments, string literals, copy attributes (alt/title/placeholder/aria-label) and JSX/HTML text, plus docs. `rename` allows one identifier renamed consistently. `imports` allows import lines only. `whitespace` allows whitespace only, and refuses indentation changes in Python/YAML. `bump` allows version numbers in a dependency manifest. Unknown file types are refused. On escalation the run becomes a full delivery with `reviewRequired`, and only `delivery_check` → `delivery_review` → `delivery_finish` can verify it. Otherwise every check runs fresh, and the run is recorded `verified` with `handoff.lane:"small"`.

Off in strict workflow, with user-owned validators and with `--no-fast-lane`. It needs a Git repository.

## Four-arm local pilot

One natural-user trade-validation task, identical bundled engine/model/dependencies, external 900-second/120-tool ceilings, 47 frozen checks:

| Arm | Elapsed | Recorded USD | External checks | Terminal outcome |
|---|---:|---:|---:|---|
| Plain Pi | 247.4 s | 0.033085 | 47/47 | Normal final answer |
| Pi + graph | 535.7 s | 0.066948 | 47/47 | Provider failure; no final answer |
| ctg standard | 509.5 s | 0.097460 | 47/47 | Verified handoff |
| ctg strict | 900.3 s | 0.108461 | 12/47 | Timeout before product implementation |

This is a single-task pilot, not a statistically significant cost/completion claim. Providers varied between requests; interrupted requests have unreconciled usage, so affected totals are lower bounds. Standard completed where strict did not, but plain Pi was faster and cheaper than standard. Graph benefit was not established. The evaluator's 12 strict passes are preserved pre-existing behavior/scope, not delivery completion. Candidate documented test commands are audited separately from external behavior.

Local task, source freezes, events, usage receipts and reports reside in `/home/baissi/ctg_test/`; these paths describe this development machine, not distributed benchmark artifacts. Future evaluation should randomize repeated tasks, retain plain Pi, classify provider errors separately and report user task completion separately from internal handoff completion.
