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

Install or update the beta:

```sh
npm install -g carthagent@next
```
