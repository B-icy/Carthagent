# Cloud onboarding — unreleased implementation

November 2, 2026. This branch is not published beta acceptance. npm `next` remains
1.1.0-beta.1 and `latest` remains 1.0.7.

Native PR #238 merged at `a5ad2164d056fee7f7183579ce6cc97305bae53b` after CI
41504674623 passed. First-task guidance is tracked in PR #239. Beta.2 runtime
prebuild 41505735348 is running; publication remains pending.

## Changes

- Use Carthagent Cloud for hosted models; retain Ship mode, internal IDs and
  compatibility login aliases.
- Fresh device sign-in has one primary flow. Legacy import and upstream key
  configuration require `CARTHAGENT_ADVANCED_AUTH=1`.
- Billing selects Builder/Pro/Max and retrieves authenticated server quote terms.
  TUI review precedes opening checkout. Existing subscribers review exact Stripe
  proration in the browser before confirming a change.
- `/billing refresh` and `ctg billing refresh` show current account access and
  require explicit continuation in the existing task session.
- Cloud account text identifies the signed-in email; usage recovery distinguishes
  starter credit, daily/monthly limits, billing and own-provider access.

## Verification

- Full native suite: 1,131 passed, 5 skipped, 0 failed.
  `/tmp/opencode/onboarding-native-reviewed.log`
- Native build and typecheck pass.
  `/tmp/opencode/onboarding-native-reviewed-build.log`
- RPC regression verifies that eligibility comes from the authenticated server
  and quoting does not create a checkout.
- Native host acceptance passes at `b715ff282b` after correcting stale fresh-auth
  and Cloud-name expectations. Both CI installed-package jobs passed. Run
  41502591162 passed Linux/macOS and Windows 24; Windows 22 hit the two-second
  PowerShell diagnostics timeout, while its parallel run passed. Windows
  diagnostics now allow bounded ten-second cold startup.
- Installed package acceptance and its focused terminal rerun reproduced a
  reconnect overlay. DEBUG-enabled source and installed probes passed; a normal
  source run subsequently hit its existing terminal-snapshot deadline. This is
  timing-sensitive local acceptance, not proof of a fixed runtime defect. Both
  earlier CI package checks passed, and corrected CI passed before merge.
- The subsequent full non-focused installed-package run passed all 28
  probes/scenarios, including terminal semantics, using the package-pinned
  beta.1 owned runtime (`/tmp/opencode/onboarding-native-package-final.log`).
  This closes the local rerun gate for the onboarding source; beta.2 still
  requires acceptance against its own final packaged manifest and release assets.

## Outstanding gates

Backend counterpart: `B-icy/Carthagent-Backend` PR #178 merged at
`b0eacdcbdb71be4c099b1b3839a11164b2d69232`; production deployment 41502378359
succeeded. Its `ONBOARDING_CONVERSION_AUDIT.md` tracks the full matrix. Live
authenticated identity and read-only Builder/Pro/Max handoff terms were verified.
Retention follow-up PR #179 also merged and deployment 41505976672 succeeded.
Stripe test access is unavailable. First-task/default-model guidance,
contextual exhaustion action, remaining legacy/docs naming and full measurement
segmentation still need work. No new end-to-end paid continuation or visual
screenshot acceptance is claimed.

The deployed website now precedes the native release. Publish a new immutable
beta and verify its exact public acquisition and upgrade. Preserve the user's
normal profile and Invest-With-Friends work during acceptance.
