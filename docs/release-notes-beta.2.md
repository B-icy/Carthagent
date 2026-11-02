# Carthagent 1.1.0-beta.2 — release candidate

This candidate simplifies Cloud sign-in and keeps billing recovery connected to
the task already open in your terminal. Publication and installed acceptance are
pending; these notes do not establish availability on npm.

## Cloud sign-in and first use

- Hosted models are named **Carthagent Cloud**. **Ship mode** remains the verified
  coding workflow. Existing provider IDs and login aliases continue to work.
- Fresh Cloud sign-in goes directly through browser authorization. Legacy import
  and upstream-key methods require `CARTHAGENT_ADVANCED_AUTH=1`.
- The browser identifies the account and terminal being connected. Device codes
  last 20 minutes, with continuation-preserving sign-in recovery.
- Successful CLI sign-in suggests one small project task and points Cloud users
  to `/account` for identity and actual available usage.

## Review billing, then continue explicitly

- `/billing checkout builder`, `pro` or `max` shows authenticated plan terms
  before opening checkout. Eligible new Builder customers pay **$1 for the first
  month, then $10/month**; Pro starts at **$25/month**, Max at **$50/month**.
- The separate one-time starter usage credit is attempted on first terminal
  authorization. Browser signup alone does not grant it.
- Existing card subscribers review Stripe's prorated amount before confirming a
  change. The renewal anchor and consumed/reserved usage are preserved. Existing
  grandfathered subscriptions retain their documented allowance policy.
- After payment, run `/billing refresh` in the existing session, or
  `ctg billing refresh` outside the TUI. Then explicitly continue the task.
  Checkout does not automatically submit a prompt or restart work.

## Acceptance and limitations

Backend onboarding and retention reporting are deployed through PRs #178 and
#179. Native onboarding PR #238 is merged; first-task guidance is in PR #239.
The original onboarding suite passed 1,131 tests with five skips; corrected
native CI passed on Linux, macOS and Windows. These results precede final
beta.2 installed-package and public-acquisition acceptance.

Stripe test-mode access remains unavailable; real decline/SCA, tax/discount and
the full financial-transition matrix are not verified. No new live purchase or
end-to-end paid task continuation is claimed. Browser screenshot capture remains
unavailable. Local terminal acceptance has shown event-stream timing failures,
although CI package acceptance passed; final draft acceptance is still required.

Verified-delivery rewards remain 25 coins, 100 XP and 1 km per eligible claimed
delivery, up to three per UTC day. Daily classifier assessments remain unrewarded.

## Planned release channel

The candidate targets npm `next` and the beta updater channel. Stable `latest`
remains 1.0.7. Exact installation and update instructions will be verified after
the immutable release and its five runtime archives are published.

Runtime prebuild: [41505735348](https://github.com/B-icy/Carthagent/actions/runs/41505735348),
source `d999644028ed0c0dc70bcaf58060db4018278e48`. The runtime recipe remains
combined-v5 on upstream `843a6c514e606b436a7fe713422ace0a93ad3d61`, compatibility
2.0.32. The final package must pin the generated archive and executable digests.
