---
description: Deliver a substantial software task in phases with executable acceptance evidence
argument-hint: "<task>"
---
Deliver this task in phases with executable evidence: $@

**Phase 1 — Inspect.** Inspect the repo and relevant installed APIs. Identify which domain skills or knowledge bases apply — check the available skills list and read the matching skill before implementing. Look for existing patterns, dependencies, and conventions you can reuse rather than reinventing. Make reasonable assumptions and proceed without asking routine preference questions. Expensive planning up front beats cheap guessing.

**Phase 2 — Plan.** Call delivery_plan FIRST — write/edit/bash are rejected until a plan exists. The plan captures scope, acceptance criteria, complete artifact roots (product source/tests/config/docs), optional outputs (generated evidence like screenshots/build output that delivery_finish must find), implementation steps, and executable checks. Every acceptance criterion must reference a declared check id. Shape: delivery_plan({goal, assumptions[], artifacts[], outputs?[], steps[], acceptance:[{requirement, checks:[checkId...]}], checks:[{id, kind:"test"|"runtime"|"static", argv:[...], timeoutSeconds}]}). Example: checks:[{id:"test",kind:"test",argv:["node","--test","tests/app.test.mjs"],timeoutSeconds:60}], acceptance:[{requirement:"CLI counts lines and words",checks:["test"]}]. Use D2 for flowcharts.

**Phase 3 — Pressure-test the plan.** Before writing code, review the plan against every explicit requirement in the user's prompt. Verify uncertain APIs with installed source or a tiny executable probe. Confirm the declared checks can actually detect failure. If the plan is weak or incomplete, call delivery_revise to fix it — it preserves evidence for checks you did not change. delivery_plan is a full reset for a genuinely new task. The plan is a living contract, not a one-time artifact. Each revision bumps the revision shown in the plan panel.

**Phase 4 — Build.** Build a runnable vertical slice early, then complete the behavior, failure paths, tests and documentation. Mark progress with delivery_progress as each step finishes so the plan panel stays current. If development reveals a wrong assumption or a step can't be completed as planned, call delivery_revise to adjust — it keeps evidence for unchanged checks — update steps and checks to match reality, but never silently drop original acceptance criteria. Reserve time to launch the actual product, exercise interactions, inspect screenshots if supported, and fix failures.

**Phase 5 — Verify.** Use delivery_check to record evidence (it runs the declared command itself — do not pre-run the same command via bash). If checks fail, read the quoted output, repair the root cause, and rerun. If a check failure reveals the plan was wrong, adjust the plan first, then re-verify.

**Phase 6 — Deliver.** Call delivery_finish with review and honest limitations. Do not finish with only a plan or scaffold, do not claim unrun tests passed, and do not deploy externally without permission.
