# Carthagent OpenCode TUI plugin

This is the V2.0.32-native Carthagent TUI host integration. OpenCode owns the terminal renderer, input editor, session lifecycle, model selectors, dialogs, route navigation, and command palette; this package adds Carthagent commands, workspace presentation, status contributions, and a matching semantic theme.

## Commands

The slash/palette inventory lives in `src/ui/commands.ts`. Host-owned `/help`, `/themes`, and `/settings` are left native; `/ctg-help` lists Carthagent commands and native shortcuts. The plugin leaves `/new` host-owned. CTG uses `/ctg-*` only for CTG-specific operations. `/model`, `/compact`, and `/abort` preserve their historical command names while providing provider-aware selection, notes-aware compaction and interruption. `/guide` toggles per-session framing when bare and sends the canonical delivery-framed task when given an argument. `/raw` tags that prompt with `ctg.raw` so the server bypasses framing without changing execution policy. Bare `/review` invokes the workspace server's independent reviewer, never the active session; `/review ask|yes|no` configures the automatic-review default in the Carthagent profile only, and does not disable the bare command. `/workflow`, `/architecture`, and `/evidence` remain visible commands. `/restart` interrupts only the selected session.

`/copy` uses the native renderer's OSC 52 clipboard operation when supported. Unsupported terminals get a clear error and the response remains selectable. `/export [file]` writes a standalone HTML transcript into the active project directory and refuses to overwrite an existing file.

## Workspace RPC

The client imports the shared contracts from `../workspace-rpc.js` and `../session-rpc.js`; it does not duplicate RPC definitions. Each RPC call supplies the selected OpenCode location and a bounded abort timeout. Workspace event subscriptions are scoped to component lifetime, and events only invalidate data: the page refetches a complete snapshot after an event and on `server.connected`, so missed events on reconnect cannot leave stale state trusted. The CTG snapshot is the only source of projects/tasks; local OpenCode sessions are a fallback, not a cross-project inventory. Workspace navigation actions are also available through `/ctg-open`, `/ctg-task`, and `/ctg-worktree` for keyboard-first use.

## Host compatibility

`/theme [name]` writes the selected theme to OpenCode's native `cli.json` profile while preserving unrelated settings. OpenCode's [CLI settings documentation](https://opencode.ai/v2/docs/cli/config) says valid edits reload while the TUI is running; the picker includes the complete legacy theme-name inventory. `/clear` remains a precise limitation: OpenCode 2.0.32 has a `session.revert.clear` endpoint, but its documented operation is only to clear staged revert state, not transcript messages. The TUI keymap has `prompt.clear` for the editor but no transcript-view reset or transcript replacement slot, so the plugin will not pretend either operation is conversation clearing. `/autocompact` reports that this host version has no supported per-session policy API; it does not store a misleading UI-only toggle.

`/compact [notes]` uses the shared `carthagent.session.compact` RPC. The server stores notes for the compaction hook and reports whether the request was admitted; the native `session.compact` API itself does not accept `customInstructions`.

## Theme

`themes/carthage.json` uses the complete OpenCode V2 semantic hue/token structure and the approved Carthagent purple/gold identity. The existing Pi-host theme names (`carthage`, `opencode`, `tokyonight`, `nebula`, `ember`, `forest`, `mono`) remain a compatibility set in `/ctg-theme`. Plugin APIs cannot register or change global themes, so named selections are delegated to native OpenCode settings.
