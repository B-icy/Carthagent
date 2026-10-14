# Review workflow experiment: not a proven quality improvement

Two matched reruns used the original 52-file voxel-project baseline, identical
prompt, DeepSeek v4.1 Flash, high thinking, and a 30-minute budget. No generated
source was repaired by the evaluator before scoring. These are single attempts,
not controlled evidence of causal performance changes.

| Run | Seconds | Verified usage USD | Playable acceptance |
| --- | ---: | ---: | --- |
| Original CTG | 538.50 | 0.318282600 | Failed |
| Persistent review findings | 420.51 | 0.326691900 | Failed |
| Mandatory outcome-contract experiment | 407.71 | 0.518784300 | Failed |

The first patched run exercised gameplay handlers in smoke, but ordinary startup
crashed and coordinate conventions disagreed. The next run tested a real native
window launch successfully, but rendered geometry, camera-relative strafe and
player-safe placement still failed independent probes. Both reported verified.

Outcome linkage improved traceability; it did not establish assertion adequacy.
The original paired experiment ran concurrently with another agent, whereas the
reruns ran alone; sampling and warm caches also varied. No general speed or cost
advantage is established. Tests and screenshots are not proof of playability.

The final experiment also exposed unnecessary review retries: invented finding
IDs, omitted findings arrays, and resubmitting a resolved finding. Resolution
retries now accept identical evidence idempotently and do not reopen a finding
being explicitly resolved in the same record. Different evidence cannot overwrite
an existing resolution; genuinely recurring findings can still be reported.

Outcome contracts are now **opt-in**, rather than inferred from component count.
Test across CLI, API, persistence, migration and packaging tasks, including simple
changes, before considering a mandatory policy. Measure false verified finishes,
successful deliveries, appropriate blocked results, cost and unnecessary friction.

## Follow-up: fresh-context acceptance review and model repairs

A further fresh implementation with generic representation/integration guidance
still failed single-shot acceptance. A separate fresh CTG reviewer reproduced the
render/control defects and the implementation model repaired them. Subsequent
evaluation found intermittent native graphics output; model repair added a
documented native software-renderer path. A second fresh reviewer found an AABB
overlap error and a raycast boundary error, which the model repaired with tests.
Final fresh review approved the core acceptance, with 75 Python tests passing,
actual native launch, image/state correspondence, camera-relative movement over
60 angle combinations, safe placement and chunk-isolation probes.

This success required multiple review/repair rounds and extra time beyond the
original 30-minute single-run comparison. Some interrupted continuations needed
a fresh repair context. It is not evidence of autonomous single-shot reliability,
lower cost, or a complete manual play test. Physical pointer input was unavailable.
The successful general mechanism was fresh-context executable falsification,
not game-specific rules in CTG. The generated game—not the harness—contains the
domain-specific fixes.

The experimental `ctg review workspace --request-file original-task.txt` command
exposes this review mechanism without requiring a pull request. It runs a separate
context with no delivery extension and does not automatically repair source,
grant verified status, or make its verdict independent proof. Review subprocess
tools are not OS-sandboxed; no source modifications are requested by its prompt.
