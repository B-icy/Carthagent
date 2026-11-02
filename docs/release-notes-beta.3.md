# Carthagent 1.1.0-beta.3 — release candidate

This candidate makes continuation failures actionable. Publication is pending;
these notes do not establish npm availability.

## Continue the existing task

- An exhausted persistent execution budget now reports the reason and recovery
  command instead of an unexplained interrupt.
- `--reset-budget` explicitly authorizes a fresh budget for a resumed session:

  ```sh
  ctg --print --continue --reset-budget "Continue the task"
  ```

- Ordinary continuation and payment preserve the execution budget, including
  elapsed idle time. Billing credit is separate. Interactive users can run
  `/delivery-budget-reset` before continuing the existing task.
- CLI help consistently names Carthagent Cloud and documents `billing refresh`.

## Acceptance evidence

The source fix passed 1,132 tests with five skips, builds and lint. PR #242 CI
passed Linux, macOS and Windows, browser and installed-package gates. One macOS
22 service-stop identity timeout passed on retry; the separate push run passed.

The authorized existing Cloud account completed a real range-fix task. The same
session, profile and installed beta.2 runtime then continued with the source
launcher and explicit reset, adding a regression and passing all five project
tests independently. Final beta.3 installed acceptance remains required.

Backend PRs #180–181 are deployed: automatic payment-status checks, clearer
sign-in and refund guidance, direct Builder review, modern Stripe compatibility
and accurate scheduled-cancellation dates while retaining paid access.
Sandbox purchases, prorated upgrades, initial and upgrade SCA, declined-upgrade
recovery, renewal, failed renewal, automatic refunds and disputes were exercised
separately. These do not establish a single
useful-task → payment boundary → same-task continuation journey: the model task
used existing production credit and payments used an isolated sandbox backend.

## Release channel

Targets npm `next`; stable `latest` remains 1.0.7. Runtime prebuild
[41537249365](https://github.com/B-icy/Carthagent/actions/runs/41537249365) uses
reviewed source `c11103f8b57c6b3254473a78d535a404bea9a84a` and the unchanged
combined-v5 runtime recipe. Final assets and manifest must pass immutable draft
acceptance before publication.
