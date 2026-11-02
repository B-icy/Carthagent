# Cloud onboarding — unreleased implementation

November 2, 2026. This branch is not published beta acceptance. npm `next` remains
1.1.0-beta.1 and `latest` remains 1.0.7.

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

## Outstanding gates

Backend counterpart: `B-icy/Carthagent-Backend`, branch
`feature/cloud-onboarding`; its `ONBOARDING_CONVERSION_AUDIT.md` tracks the full
matrix. Stripe test access is unavailable. First-task/default-model guidance,
contextual exhaustion action, remaining legacy/docs naming and full measurement
segmentation still need work. No new end-to-end paid continuation or visual
screenshot acceptance is claimed.

Publish a new immutable beta and verify its exact public acquisition and upgrade
before deploying website instructions for these commands. Preserve the user's
normal profile and Invest-With-Friends work during acceptance.
