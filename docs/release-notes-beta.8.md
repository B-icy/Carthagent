# Carthagent 1.1.0-beta.8

Quick mode, quests from any mode, and more reliable sign-in, reconnect, and
navigation.

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

The five-platform runtime prebuild passed on Windows x64, Linux x64/ARM64,
and macOS x64/ARM64, with the Intel macOS coverage exclusion below. Artifact
provenance, archive checksums, executable checksums, and runtime manifests were
verified. Prebuild fixes include portable folder fixtures, settled-layout and
input-focus test synchronization, and macOS Bash compatibility.

The [integration evidence](qa/beta8-integration-progress.md) records earlier
failures and remaining release acceptance gates. Publication requires final
package CI and installed/default-resolver acceptance.

## Known beta limitations

- **Intel macOS coverage:** the release owner accepted exclusion of the
  context-menu resize/reopen Rename regression from this platform's release
  gates. Follow-up traces isolated a test click made before layout settled;
  the corrected test passed a separate 30-repeat navigation diagnostic on both
  Intel macOS and Windows and remains required on other platforms. Intel macOS
  diagnostic coverage is recorded separately from the release-gate exclusion.
- Long navigation stress runs have encountered plugin-readiness timeouts.
- Historical authentication findings AUTH-001 and AUTH-002 are not fully
  reproduced; the verified cold-start repair does not establish their causes.

## Install or update

```sh
npm install -g carthagent@1.1.0-beta.8
ctg
```

This prerelease uses npm's `next` channel. The stable `latest` channel stays on
1.0.7.
