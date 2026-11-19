# Carthagent 1.1.2

A stable update to 1.1.1. `ctg update` on the stable channel installs it; no
profile, sign-in or session migration is needed. On first launch Carthagent
downloads the updated checksum-pinned runtime for your platform (runtime patch
v18).

## Getting started

- The home screen explains Ship and Quick and suggests practical first tasks.
- An empty model picker offers provider connection and recovery actions.
- `ctg login` retries an invalid choice without losing the prompt. Enter selects
  Carthagent Cloud; Ctrl+C exits cleanly.
- The composer separates model and provider names, and drops the provider name
  in narrow terminals.
- `ctg doctor` checks Node, the runtime, the background service, providers and
  Cloud sign-in, with a suggested fix for each problem. A revoked Cloud session
  says so.

## Ship and everyday work

- The optional PR review offer is now a brief notice instead of a dialog, so
  you can keep typing. Type `/review` when you want it. The offer does not change
  Ship's checks or its `delivery_review` step.
- Ship's fast lane handles small edits that name their file, with a real check,
  in fewer steps. Fast-lane finishes run the checks fresh but skip the
  self-review; an edit that grows or drifts from the request moves to the full
  workflow and needs a review. Sensitive, unclear or larger changes always use
  the full workflow. Turn it off with `--no-fast-lane`.
- Implementation readiness no longer reads as permission to finish without the
  required checks and review.
- Ship no longer reruns checks when a build or type check only rewrote
  git-ignored output files. Ignored files (other than `.env` files) no longer
  affect whether evidence counts as fresh.
- `/goal <objective>` keeps a session working across turns until the objective is
  done or blocked, within a turn limit. Each continuation is a normal turn
  and is billed like one. See [/goal](native-goal.md).

## Reliability

- Question forms keep the session they were asked from, scroll in small
  terminals, and keep custom answers editable.
- Older screenshots no longer make Cloud requests too large.
- Full Chrome or Chromium works without a display.
- Interrupting a headless run with Ctrl+C says "Interrupted", prints the resume
  command and exits with status 130.

## Voyages

- `/voyages` opens the Voyages hub; daily goals stay on `/quests`.
- Signed out, daily goals show a preview of real goals and a Sign in action.
- Buy and Equip open with Cancel focused, so a stray Enter spends nothing, and
  a held Enter no longer carries from Buy into Equip.

"Verified" means the declared required checks passed against the current code.
It is not proof that the code is free of bugs, and Quick mode is not tested.
