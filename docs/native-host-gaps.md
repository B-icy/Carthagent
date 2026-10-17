# Native host contracts still required

The standalone compatibility probes run against pinned OpenCode 2.0.32. The
following behaviors are deliberately not counted as complete until the host
exposes a supported contract:

## Live theme selection

The runtime-author API `context.ui.theme.current()` and
`context.ui.theme.set({ name, mode? })` is now wired through a narrow structural
capability type so this plugin can compile against older published typings.
`/theme` verifies the returned current name/mode and refuses to claim success
when the capability is absent, rejects the selection, or resolves a mismatch.
Compatibility theme files must still be provisioned before startup. The owned
host binary does not yet include this API; the live color PTY acceptance remains
pending until that binary is available and proves an actual post-command repaint
from a contrasting initial theme, plus the persisted selection after reload.

## Natural slash submission

The native PTY acceptance probe types `/ctg-workspace`, `/ctg-help`, and `/help`
and submits with Enter without first dismissing the host completion menu. It
asserts the command output only after submission. The `/help` probe additionally
requires the Carthagent help marker, while bare `/help` remains host-owned on
2.0.32. If slash-command registration does not route submitted input to the
registered plugin command, the probe remains failed; typing Escape to hide
completion is diagnostic only and does not satisfy the acceptance test. The
needed host contract is explicit `/help` ownership override (or native Help
exclusion), and a submitted-slash dispatch event that routes typed input to the
selected registered plugin command. Completion selection must remain separate
from execution; the probe will continue to press Enter naturally and assert
the post-submit result.

## Runtime identity for disposable demos

The native launcher passes its trusted Node executable as
`CTG_NODE_EXECUTABLE`; the plugin must not use Bun/OpenCode's `process.execPath`
to run Node test fixtures. A successful demo means the isolated Node test
runner itself reported its two checks, not merely that the OpenCode binary
accepted an argument and exited zero.
