# Workflow modes and evidence

The ctg CLI defaults to `--workflow standard`. A valid required acceptance contract enables implementation without mandatory component/port/scenario review. Final verification remains strict: fresh check identities, new requirement executions, artifact/output existence, structured step completion and a snapshot-bound final review are required. Step `done` means implementation complete, not passing integrated checks.

`--workflow strict` keeps tested-design approval before implementation. Direct extension hosts default to strict; restored runs retain their recorded workflowMode. Neither mode is an OS sandbox. Informational contracts cannot authorize implementation.

`delivery_probe` exposes only Node/npm version argv with a ten-second bound; it is discovery, not check evidence. Unknown custom tools remain fail-closed.

Partial revisions merge omitted design/workflow object fields; supplied arrays replace their respective arrays. Strict revisions still relock approval. Standard revisions continue implementation but invalidate affected evidence and final review. Validation observes the current plan and records findings without clearing approval; receipt identity still detects changed plans/source.

Graph navigation is permitted during discovery, returns pagination/coverage and supports file/container filtering. Absolute workspace file paths normalize; directory filters return actionable errors. Name-based call matches remain candidates rather than runtime resolution.

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
