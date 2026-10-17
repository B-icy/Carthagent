# Native runtime acceptance matrix

This is the compatibility inventory for the migration from baseline
`599a8ad`. A name appearing in a command registry is not evidence that its
behavior works. Default-switch approval requires the following checks against
the installed native package.

## Terminal commands

| Command | Aliases / arguments | Required behavior |
| --- | --- | --- |
| `/help` | | CTG commands, arguments and actual native shortcuts |
| `/resume` | `/sessions`, `[id\|name]` | Search and open native sessions; legacy results explicitly archive-only |
| `/new` | | New independent native session, without deleting current work |
| `/restart` | `/kill` | Interrupt/recover the selected session without restarting other sessions |
| `/theme` | `[name]` | Native theme picker; explicit name applies; confirmation commits selection |
| `/model` | `[name]` | Provider-aware search/selection; explicit name actually selects a model |
| `/thinking` | | Supported variant selection, honest errors for unsupported levels |
| `/compact` | `[notes]` | Await or report admitted compaction correctly; notes reach summary context |
| `/autocompact` | `[on\|off]` | Preserve the requested session policy, not a misleading UI-only switch |
| `/review` | `/review-mode`, `[ask\|yes\|no\|status]` | Persist review default/override; fresh reviewer with bounded admission |
| `/export` | `[file]` | Complete HTML transcript, escaped content, explicit output location |
| `/copy` | | Full last assistant response, including content beyond visible viewport |
| `/stats` | | Actual usage/cost; unknown prices remain unknown |
| `/clear` | | Clear presentation without deleting durable transcript |
| `/abort` | | Stop selected session and underlying cancellable work |
| `/raw` | `<prompt>` | Bypass framing for that prompt; keep execution policy enforced |
| `/guide` | `[task]` | Toggle framing or send a framed task |
| `/login` | `/auth` | Native CTG-scoped provider connection |
| `/account` | `/cloud` | Ship credit, plan, grants, sessions |
| `/usage` | | Recent Ship usage from the control plane |
| `/billing` | `[checkout [plan]\|portal]` | Open the authenticated billing destination |
| `/logout-cloud` | `[session-id]` | Revoke/remove current connection or revoke specified Ship session |
| `/update` | `/upgrade`, `[check]` | Check/update CTG without upgrading regular OpenCode |
| `/quit` | `/q`, `/exit` | Clean shutdown of TUI resources and terminal restoration |
| `/workflow` | | Show authoritative execution workflow |
| `/architecture` | | Show current architecture view |
| `/evidence` | | Show check receipts and freshness |

Delivery extension commands, including budget inspection/reset, must be listed
by the native delivery adapter and included in the installed-host test as well.
Built-in OpenCode command collisions must be tested through actual typed input.

## Launcher

Preserve `tui/ui/interactive`, `resume/sessions`, `continue`, `demo`, `status/s`,
`check/c`, `hash/fingerprint`, `validate`, `login/auth`, `account/cloud`,
`billing`, `logout-cloud`, `serve/web/start`, `test`, `eval`, `review`, `update`,
`help/--help/-h`, `--version/-v`, `--list-models`, and bare/prompt invocation.

Preserve provider/model/thinking/theme, engine executable override aliases,
session selection, validators/context, shell and session budgets, review mode,
extension/skill isolation, strict/standard workflow, framing, glyph tier,
codegraph cap, demo, print and JSON flags. Validate before starting work.
The `--` separator must allow literal prompts beginning with a dash.

Headless output needs real terminal success/error/cancel classification,
bounded cancellation, and a documented JSONL contract for evaluation consumers.
`ctg review` preserves exits 0 (approve), 1 (changes requested), and 2
(inconclusive/infrastructure failure). Admission limits do not reset on restart.

## Cross-cutting gates

- Two simultaneous tasks in different worktrees cannot share active contracts,
  budget counters, Ship telemetry identities, or review receipts.
- Normal OpenCode configuration, credentials, service and sessions remain
  separate. Project/ancestor/home discovery and inherited environment settings
  must be probed, not inferred from XDG paths alone.
- Workspace tools retain the intended user environment; host isolation must not
  redirect unrelated tools' config/cache/credentials.
- Reconnect restores snapshots after lost events. Cached stale data cannot
  produce a verified/reviewed state.
- Unicode/large paste, selection, clipboard, terminal title restoration, narrow
  layout, picker keyboard navigation and cancellation work under a real PTY.
- Package-owned runtime resolves from a fresh production-only install on the
  supported platforms. Package contents exclude workspace dependency folders.
- Deterministic software-engineering fixtures execute native tools, edit code,
  run failing/passing checks, and exercise recovery. Mocks alone do not prove
  runtime integration.

## Performance measurements

Targets remain input p95 at most 50 ms, warm session switch p95 at most 150 ms,
cached workspace load at most 300 ms, bounded plugin memory and no plugin-owned
idle redraw loop. Startup time in the bootstrap PTY smoke includes intentional
input delays and must not be reported as a performance measurement.

## Executable native-host evidence

The following probes use a disposable profile and deterministic loopback provider.
`CTG_OPENCODE_BIN` can select an explicit test binary; the default is the pinned
package-owned `node_modules/@opencode/cli/bin/opencode.exe`. An optional first
argument selects an installed plugin directory.

- `node tools/test-native-controls.mjs`: concurrent framing/raw admission,
  persisted launcher settings and framing overrides, compaction notes reaching
  the summary request, cross-location RPC rejection, and whole-service restart
  with authoritative session snapshots.
- `node tools/test-native-outcomes.mjs`: provider rejection produces a failed
  outcome; interrupt closes an in-flight provider request; a neighboring session
  succeeds; the interrupted session recovers with its history preserved.
- `node tools/test-native-delivery-host.mjs <plugin-dir>` loads the production
  `setupCarthagent(..., { delivery: true })` composition, not the isolated test
  plugin. Scenarios cover standard/strict delivery, explicit `delivery:false`,
  configured budget interruption (`resume:false`), mixed session settings, and
  simultaneous identical shell commands in one worktree with per-session counts.
- `npm run test:native-package` repeats those probes against the packed,
  production-only installed artifact. In OpenCode 2.0.32, `ShellCreateBefore`
  lacks session/call identity, so it is never used for attribution or charging;
  the authoritative `tool:execute.before` event supplies session/call identity.

Native `session.wait()` can resolve before the durable session projection exposes
its terminal outcome. Consumers must reconcile within a bounded deadline and
treat a missing outcome as unresolved. Assistant errors appear as `finish: error`
with error details; terminal outcomes are recorded by the final `idle` message.
These probes establish host behavior; delivery adapters, CLI output and installed
UI integration still require their own acceptance checks above.
