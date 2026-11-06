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
- Dashboard startup reports a failed port bind instead of announcing readiness.

## Verification

Integration passed the full repository suite (1,175 passed, 5 skipped), both
cross-platform CI runs, 91 plugin renderer tests, and the pristine Linux native
suite (1,643 passed, 2 skipped). Actual-window checks covered Quick, any-mode
quest selection/cancellation, compact pointer navigation, and authenticated
service replacement with preserved Shop selection and preview. Read-only local
and remote comparisons confirmed profile/session/inventory preservation.

Release acceptance remains in progress. The first five-platform prebuild passed
Linux x64/ARM64 and macOS ARM64, but failed Windows on a path-specific test
fixture and Intel macOS on the previously unresolved Rename-click interaction.
The fixture is corrected; final prebuild and installed/default-resolver
acceptance remain pending. The [integration evidence](qa/beta8-integration-progress.md)
records these failures, historical unreproduced authentication findings, and
navigation readiness timing debt. These notes will be finalized after the
remaining release gates.

## Known beta limitations

- **Intel macOS:** clicking Rename in a session context menu can fail after
  resizing and reopening the menu. The release owner accepted this issue for
  beta.8; its exact regression is excluded from Intel macOS release gates and
  remains required on other platforms. The issue is not claimed fixed.
- Long navigation stress runs have encountered plugin-readiness timeouts.
- Historical authentication findings AUTH-001 and AUTH-002 are not fully
  reproduced; the verified cold-start repair does not establish their causes.
