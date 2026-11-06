# Carthagent 1.1.0-beta.8 — draft

Release acceptance is in progress. These notes describe the candidate and do not
certify it for publication.

## Modes and quests

- Lite is now displayed as **Quick**, preserving existing sessions and the
  colored Ship / Quick / Plan / Build modes.
- Quest work selection includes owned sessions from any mode. Selected evidence
  is editable and submission remains explicit.
- Completed quests stay off the active board. Friends remains marked WIP.
- User-entered quest evidence is a submitted claim, not independent verification
  or automatic coin/XP eligibility. Verified Ship delivery rewards continue to
  require fresh verified delivery receipts.

## Connection and navigation repairs

- Cold OAuth connection and plugin discovery wait for plugin activation.
- Mounted plugin pages and RPC calls follow the current client after reconnect.
- The terminal rediscovers a replacement service through its profile registration
  and validates runtime identity and authenticated health before reconnecting.
- Failed endpoint validation waits for a validated replacement instead of retrying
  a stale URL that may now belong to another process.
- Same-account recovery preserves selected quest work and Shop previews; navigation
  refresh preserves the selected static destination.
- Newly opened sessions remain reachable through keyboard tab cycling while their
  layout write is pending. Closing a pending tab prevents late resurrection.

## Verification

Final candidate, live acceptance, five-platform builds, and installed-package
acceptance are pending. The [integration evidence](qa/beta8-integration-progress.md)
records successful checks, failed attempts, historical unreproduced findings, and
remaining navigation timing debt. Final release notes will reflect the completed
gates and remaining beta limitations.
