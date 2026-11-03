# Carthagent 1.1.0-beta.5

## Startup and updates

- Animated, transient progress while preparing the runtime, connecting, and loading sessions.
- Staged feedback during `ctg update`, with clean cancellation.
- Quiet redirected/dumb-terminal output and `CTG_REDUCED_MOTION=1` support.
- Faster native startup feedback without the previous three-second hold.

## Projects and Voyages

- Clearer Projects hierarchy, folder headings, current-folder context, session states, and empty states.
- Keyboard navigation with arrows/j/k, folder collapse/expand, session selection, search, and new-session shortcuts.
- Correct folder-aware scrolling and current-session focus.
- Improved Voyages status, completion counts, selection, loading/error states, and narrow-terminal text layout.
- Session drafts, scroll, selection, and collapsed folders survive pane switches.

## Polish and reliability

- Carthagent branding throughout product-facing native console copy and links.
- Cross-platform sidebar fixture paths and isolated draft state.
- Native renderer stress checks run in fresh processes with external deadlines to prevent indefinitely stalled CI jobs.

## Validation

The Linux candidate was exercised through the real launcher and an authenticated
production Cloud account. Voyages loaded the profile, wallet, and three daily
quests; sidebar actions opened both assignments and profile details. Terminal
layouts were checked at 110×36, 80×24, and 60×20. Package quality passed 1,139
tests with five skips, and all 35 runtime check tasks passed. The isolated native
stress runner passed 140 navigation checks and 30 seascape checks locally.

These checks establish startup, navigation, account loading, and display behavior.
They do not establish completion of the earlier expense-reporting coding task.

Install or update the beta:

```sh
npm install -g carthagent@next
```
