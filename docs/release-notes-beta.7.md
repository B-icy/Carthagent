# Carthagent 1.1.0-beta.7

## Navigation and readability

- Readable selected Projects/Voyages tabs and Voyages menu rows.
- Filled Browse and New session buttons, tighter sidebar spacing, and clear two-line session status.
- Editable new-session folder paths with completion.
- Folder browsing with `./` selection, `../` parent navigation, plain arrow keys, and single-click opening.
- Original colored Ship / Lite / Plan / Build modes retained.

## Quest work discovery

- Choosing completed work now searches saved sessions in the current folder, including sessions not yet opened after a restart.
- Paginated results preserve the selected session's title and project provenance.
- Stale verification remains visible before submission.

## Verification

The local candidate passed the full native TUI suite (1,613 tests), plugin renderer suite (33 tests), repository quality gate (1,146 tests after merging main), browser integration, and 28 Python tests. Actual signed-in terminal checks covered folder navigation, saved quest work, compact shop previews and equip cancellation, account/usage views, and billing confirmation cancellation.

Five-platform packaging and installed-release acceptance results are recorded in the release workflow and [acceptance report](native-e2e-acceptance-2026-11-04.md).

## Beta scope

Daily quests award no coins or XP; verified Ship deliveries provide rewards. Friends remains WIP. This pass does not recertify the entire historical acceptance checklist or live payment completion; see the acceptance report for remaining gaps.
