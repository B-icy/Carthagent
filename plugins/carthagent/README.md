# Carthagent OpenCode TUI plugin

This is the V2.0.32-native Carthagent TUI host integration. OpenCode owns the terminal renderer, input editor, session lifecycle, model selectors, dialogs, route navigation, and command palette; this package adds Carthagent commands, workspace presentation, status contributions, and a matching semantic theme.

## Commands

The slash/palette inventory lives in `src/ui/commands.ts`. The plugin registers `/help` and `/ctg-help` to show Carthagent commands; the latter is the unambiguous alias if a host context claims `/help`. Both are covered by the pinned OpenCode 2.0.32 PTY smoke test. `/themes` and `/settings` remain native. The plugin leaves `/new` host-owned. CTG uses `/ctg-*` only for CTG-specific operations. `/model`, `/compact`, and `/abort` preserve their historical command names while providing provider-aware selection, notes-aware compaction and interruption. `/guide` toggles per-session framing when bare and sends the canonical delivery-framed task when given an argument. `/raw` tags that prompt with `ctg.raw` so the server bypasses framing without changing execution policy. Bare `/review` invokes the workspace server's independent reviewer, never the active session; `/review ask|yes|no` configures the automatic-review default in the Carthagent profile only, and does not disable the bare command. `/workflow`, `/architecture`, and `/evidence` render the selected session's authoritative workflow graph, architecture nodes/edges/ports, and bounded plan/evidence receipts, refreshing on native session/attention and server reconnect events. `/restart` interrupts only the selected session.

`/copy` uses the native renderer's OSC 52 clipboard operation when supported. Unsupported terminals get a clear error and the response remains selectable. `/export [file]` writes a standalone HTML transcript into the active project directory and refuses to overwrite an existing file.

## Workspace RPC

The client imports the shared contracts from `../workspace-rpc.js` and `../session-rpc.js`; it does not duplicate RPC definitions. Each RPC call supplies the selected OpenCode location and a bounded abort timeout. Workspace event subscriptions are scoped to component lifetime, and events only invalidate data: the page refetches a complete snapshot after an event and on `server.connected`. Native session data is merged with the CTG snapshot only for sessions associated with the snapshot's projects; unrelated OpenCode sessions are not presented as CTG sessions. Workspace navigation actions are also available through `/ctg-open`, `/ctg-task`, and `/ctg-worktree` for keyboard-first use.

## Host compatibility

`/theme [name]` provisions the selected compatibility theme as OpenCode-native semantic theme JSON in the active native profile's `themes/` directory, then writes the selection to `cli.json` while preserving unrelated settings. Since OpenCode discovers theme files at startup, a newly installed theme requires one restart; selecting an already installed theme only changes `cli.json` and uses the host's live config reload. Launchers can call the standalone `provisionDefaultNativeTheme(configDirectory)` export from `src/ui/theme-provision.mjs` before starting OpenCode so `carthage` is available on the first launch. Provisioning does not overwrite an existing user-owned theme file. `/clear` clears only the visible transcript view using the host presentation API; durable session history is unchanged. `/autocompact [on|off]` persists an explicit, idempotent per-session setting; bare `/autocompact` toggles it.

`/compact [notes]` uses the shared `carthagent.session.compact` RPC. The server stores notes for the compaction hook and reports whether the request was admitted; the native `session.compact` API itself does not accept `customInstructions`.

## Theme

`themes/carthage.json` uses the complete OpenCode V2 semantic hue/token structure and the approved Carthagent purple/gold identity. Remaining legacy palette names are converted to native OpenCode semantic tokens and hue scales by `src/ui/theme-provision.mjs` when provisioned. The default launcher provisioner is a separate export so the parent can invoke it without loading or editing the runtime entrypoint.
