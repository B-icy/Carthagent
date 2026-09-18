# Inkling TUI trial — Voxel Craft (2026-09-18)

> Context: one live, interactive pi2 console run against a JavaScript Voxel Craft fixture
> (`/home/baissi/tests/minecraft`, a browser voxel sandbox with a Node-testable engine)
> in that fixture's own workspace. Raw evidence (session JSONL, delivery report, TUI pane
> captures) lives in the ignored `artifacts/mc-eval/` directory of that run and is not
> committed here. This is a single exploratory trial, **not** a statistically powered
> benchmark; see the caveats at the end.

Environment: Linux, Node 26.7, pi2 0.2.0 (the merged `feat/informational-verification`
build), model `openrouter/thinkingmachines/inkling:free` (medium thinking), provider
OpenRouter. The console ran inside tmux with `--bash-cap 60`, wrapped in
`timeout -k 10 900`, and was polled at ~20 s gaps with an external kill at the deadline.

## Task and outcome

Prompt (as delivered by the console, with framing):

> Item drops stay on the ground forever. Add a drop lifetime: after a dropped item has been
> on the ground for 30 seconds it should despawn and be removed from the world. The ItemDrop
> class already tracks an age field. Add a Node regression test.

Outcome: **verified**, revision 1, one declared check fresh, two acceptance criteria covered.
The agent added `this.drops = this.drops.filter(d => d.age < 30)` to `Game.step` after the
per-drop `update`, and appended a regression test (`drops despawn after 30 seconds lifetime`)
that sets `drop.age = 30` and asserts removal. The repository's own engine, mesh, render,
escape, and smoke suites pass independently of the agent's check (38 tests + smoke green).

| Metric | Value |
|---|---|
| Final status | `verified` (1/1 check fresh, 2/2 criteria) |
| Wall time (first→last assistant turn) | 116.4 s |
| Assistant turns | 30 — **0 plain-text; no closing summary** |
| Tool calls | 28 — `read`×10, `bash`×8, `delivery_status`×6, `delivery_plan`×2, `edit`×2, `delivery_check`×1, `delivery_finish`×1 |
| Cumulative tokens | 884.1k (TUI header), context peak ~4.5% |
| Product change | `src/engine.js`, +2 lines |

## TUI experience

The plan panel is the strongest part of the product and does exactly what the README
promises. The final capture shows:

- header: spinner, `~/tests/minecraft`, model + thinking level, context %, elapsed, `884.1k tok`;
- the live D2 graph `Inspect engine.js ✓ → Modify Game.step ✓ → Write regression test ✓ →
  Run node_regression ✓ → Verify checks ✓ → Review + limits ✓`, with the inactive
  `Repair failures` side channel drawn;
- `CHECKS ▓▓▓▓▓▓▓▓▓▓ 1/1 · ✓ node_regression 0.1s`, `handoff verified`, `COVERAGE 2/2 criteria`,
  usage, and the `fp … verified · rev 1 · run …` footer.

The run feed, however, tells a different story: after `delivery_finish` it fills with
repeated `thinking → delivery_status ✓` cycles. The model's own reasoning reads
*"The user explicitly asks me to use delivery_status…"*. The last visible content is tool
output — the user never gets a sentence saying what changed or how to run it, and the
spinner keeps turning on an already-green contract.

## Log analysis

From the raw session JSONL (68 lines) and the delivery `report.json`:

**Worked**
- Plan → edit → test → check → finish ordering was clean. `validatePlan` rejected the first
  `delivery_plan` because an acceptance criterion referenced an undeclared `runtime_lifetime`
  check; the model replanned correctly and `delivery_finish` recorded honest limitations.
- `delivery-strict` caught an out-of-workspace edit: to "fix" the failed plan the model tried
  to edit the absolute path `/home/baissi/pi2/plan.d2` (i.e. this repository) and was blocked
  by *"BLOCKED — call delivery_plan NOW…"*. No file was written outside the fixture.
- The applied change is correct: the filter runs after `d.update(dt)`, so `age` is advanced
  before the comparison.

**Wasteful or wrong**
- **Guidance false-positive.** The plan recorded `guidanceProfiles: ["authenticated-web",
  "transactional-data"]` for a voxel drop-lifetime task. `routeGuidance` runs on the *framed*
  prompt, and the delivery template contains the trigger words `user` (auth) and `order`
  ("in order", transactional). The raw task routes to `[]`. Irrelevant auth/ledger guidance
  was injected into every turn.
- **Six identical skill reads.** `read skills/game-development/SKILL.md` returned the same
  8 251 characters at 06:09:05, :09, :10, :15, :17 and :24 (plus a partial later read).
- **Whole-file `cat`s.** `cat src/game.js` (28 KB) and `cat src/engine.js` (26 KB) landed in
  context instead of ranged reads.
- **Post-verify `delivery_status` loop (×5 after finish).** The delivery extension's
  `context` hook injects, on every turn, the imperative *"Use delivery_status to inspect
  current freshness."* — and it skips only `blocked`, not `verified`. The compliant model
  treats the injected line as a user instruction and re-calls the tool. The session's last
  logged event is one of these calls: **the run did not stop on its own; the external
  bounded kill ended it.** No `delivery-gate` repair nudge was involved.
- **Plan churn.** Two `delivery_plan` calls plus a blocked `edit` on a phantom `plan.d2`
  before the model understood the validation error.
- **No closing message.** Nothing user-facing was emitted at the end of the run.

## Findings

1. **P0 — `pi2 --review <mode>` crashes the console.** `lib/pi.mjs` emits
   `--delivery-review`, but `extensions/delivery.ts` never registers that flag, so the agent
   exits immediately with `Unknown option: --delivery-review`. This killed the first launch
   before any work happened; the run above only proceeded after omitting `--review`.
2. **P1 — the post-verify context injection invites a loop.** An imperative that is
   re-injected every turn, with no `verified` short-circuit, is an instruction a
   compliance-prone model will keep obeying.
3. **P1 — guidance is routed on the framed prompt.** Template boilerplate (`user`, `order`)
   selects unrelated profiles and injects irrelevant guidance.
4. **P2 — rate-limit/cost flags are unreachable from the TUI.** `evaluate.mjs` sets
   `--delivery-turn-delay-ms 3000` and `--delivery-tool-output-cap`, but `parseTuiArgs`
   forwards only `--bash-cap`. There is no way to add inter-turn gaps from the interactive
   console, which matters most for free/rate-limited models.
5. **P2 — redundant context.** Six identical skill reads plus two whole-file `cat`s dominate
   the 884 k-token total for a two-line change.
6. **P3 — a failed plan costs more than a turn.** The validation error is accurate but the
   model still guessed at a file edit before replanning.

## Recommendations

Prioritized; P0 blocks normal use, P1 is a correctness/cost defect, P2 is polish.

1. **Fix `--review`.** Either register `delivery-review` in the extension or drop it from
   `buildPiArgs`; the review loop is already owned by the console (`shouldOfferReview` +
   `MAX_REVIEW_ROUNDS`). Update the `buildPiArgs` test to match.
2. **Stop the post-verify loop.** Skip `context` re-injection when the contract is current
   (`verified`, or `blocked`), and reword the tail from an imperative to a conditional
   ("only re-inspect if you edited files since the last check").
3. **Route guidance on the raw task.** Unframe the prompt before routing, and tighten
   triggers so generic template words cannot select a profile.
4. **Expose the lean-run flags in the TUI** (`--delivery-turn-delay-ms`,
   `--delivery-tool-output-cap`, `--delivery-rewrite-cap`, `--delivery-protect-existing`) and
   consider defaults for bounded runs.
5. **Discourage redundant reads** (a "read once" line in the guidance) and require a short
   user-facing handoff after `delivery_finish`.

## Evidence and limitations

- Reproduced by `node artifacts/mc-eval/analyze.mjs`, which asserts the captured external
  artifacts (session log, report, engine before/after, TUI panes), the terminal status, the
  passing evidence, and the plan/check/finish tool calls.
- Independent project check: `node --test tests/engine.test.mjs tests/mesh.test.mjs
  tests/render.test.mjs tests/escape.test.mjs && node tests/smoke.mjs`.
- **Not performed:** real-browser/WebGL visual confirmation of the despawn behavior; the
  fixture's pixel check was not run (engine-only change).
- **Single model, single run.** The loop and cost figures are one data point, not an average,
  and task sizes/budgets are not comparable to the Mercury trials in `docs/evaluation.md`.
- The run was terminated by the external monitor while the model was still calling
  `delivery_status`; whether it would eventually have stopped on its own is unanswered — that
  is itself the finding.
