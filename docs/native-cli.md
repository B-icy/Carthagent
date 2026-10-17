# Native OpenCode CLI adapter

`lib/opencode/cli.mjs` is the compatibility boundary for the `ctg` command
surface. It parses aliases and flags, chooses interactive vs headless execution,
and dispatches to `lib/opencode/cli-runtime.mjs`. `bin/ctg.mjs` selects this route
only with `CTG_NATIVE=1`; the existing CLI remains the default until integration
gates pass.

## Runtime integration port

The caller of `runOpenCodeCli()` supplies these concrete capabilities:

| Capability | Request/behavior |
| --- | --- |
| `run({ mode, options, prompt, args })` | Launch native OpenCode interactive or headless (`print`/JSONL) session. Honor `--engine-cli`/`--agent-cli` as an explicit executable override and `--isolate` as extension/skill discovery isolation. |
| `listModels({ query })` | Enumerate models from the native provider catalog, filter the optional query, and print the compatible provider/model/context/token/input/output columns. |
| `login({ args })` | Uses OpenCode 2 integration list/connect/status/complete/cancel APIs. Defaults to Carthagent Ship when available; optional integration and method arguments select another integration. Key-based methods are not prompted in clear text. |
| `account({ args })` | Uses the profile-owned Ship RPC and active managed OAuth connection; `--json` emits the account response. |
| `billing({ action })` | Uses the profile-owned Ship RPC to create checkout/portal links and opens the returned URL explicitly. |
| `logout({ session })` | Uses the profile-owned Ship RPC to revoke a named session or the current session; current logout also removes its native credential. |
| `archive({ args })` | Uses the profile-owned archive RPC for read-only list/search/read/export of configured legacy transcripts. |
| `review({ args })` | Uses the shared review facade, whose verdict is bound to the authoritative GitHub PR refs/source or exact local source snapshot. |
| `domain({ command, args })` | Existing status/hash/check/validate behavior backed by delivery domain modules. |
| `command({ command, args })` | Existing serve/test/eval/update utility commands; package updates install only the validated release spec. |

Capabilities that are not wired fail with an explicit missing-capability error;
there are no placeholder success paths. Operations return an integer process
status (or `undefined` for success). Cancellation from a native session maps to
130. Headless resume maps the picker request to continuation; headless calls
without a task fail with an actionable message.

Headless success requires both the assistant's completed `finish: stop` message
and a terminal `idle` message with `outcome: succeeded`; text output alone is not
success. Native thinking levels are passed as model variants. The adapter rejects
`--max-tools`, `--max-seconds`, and `--max-repairs` until the active native
delivery plugin enforces session budgets. `--no-delivery`, `--no-strict`,
`--bash-cap`, and `--isolate` remain fail-closed because the active plugin has no
matching enforcement contract. `--no-guide` is stored in durable
`carthagent.options` session metadata and honored by native prompt framing; on a
resumed session, explicitly supplied options merge with existing session settings. `demo`
runs a separately labeled offline Node fixture in a disposable temporary workspace;
it makes no provider calls, edits no project files, and does not claim evidence for
the user's project. Update
checks use the shared release resolver; npm installs use its validated,
release-pinned package spec, while source clones fail closed rather than
checking out files in place. Both the shared resolver and the final installer
require the exact canonical `v<version>` release tag (including prerelease
identifiers); `--force` cannot bypass tag/version validation. `quit`/`q`/`exit` report that no interactive
session is active when invoked as standalone commands.

`--json` translates real native session tool lifecycle and completed assistant
messages into the documented `tool_execution_start`, `tool_execution_end`, and
`message_end` JSONL records. It filters to the selected session and reconciles
message history after execution so stream/history projections do not duplicate a
turn. Failed assistant responses retain their error and stop reason, and terminal
failure/interruption outcomes are emitted as idle records rather than returning
an empty JSONL stream.
Accepted turns that time out or are cancelled keep their captured session and
tool lifecycle events, but are never reconciled against older session history.
Pre-admission interruption has no accepted marker and emits no prior-session
events. OAuth form secret fields are masked in raw terminal input; unsupported
API-key login methods are rejected before any prompt is displayed.

The disposable real-host adapter smoke is `node tests/native-cli-host-smoke.mjs`.
It resolves the pinned OpenCode executable through the package-owned native
runtime resolver and defaults runtime/plugin imports to this package. In a
source checkout without installed runtime dependencies, set `CTG_OPENCODE_BIN`
to an installed pinned binary; `CTG_NATIVE_RUNTIME_ROOT` and
`CTG_NATIVE_PLUGIN_PATH` explicitly override runtime/plugin imports when testing
another package tree. The smoke creates a disposable
cross-platform profile (including Windows profile/temp roots), disables project
configuration loading, and runs a local OpenAI-compatible fixture provider. It
injects the already-running service through the adapter test seam and verifies
print, a second print turn in the same session, workspace-scoped continuation
when a newer foreign-workspace session exists, successful and failing JSONL
lifecycle events, and explicit rejection of unenforced budget flags. It does
not verify normal runtime service provisioning/profile isolation or provider
login/account/billing.

## Migration notes

- `ui` and `interactive` alias `tui`; `sessions` aliases `resume`; `s`, `c`,
  `fingerprint`, `auth`, `cloud`, `web`, and `start` retain their established
  command aliases.
- `--agent-cli` and `--engine-cli` share the explicit native executable
  override. They must not silently select a legacy Pi executable.
- `--isolate` continues to describe extension/skill isolation and never implies
  worktree creation.
- Help/output and domain exit behavior remain the CLI contract. PI session
  stores are archive-only and are not read or continued by this adapter.
- Activation is intentionally staged: `CTG_NATIVE=1` is opt-in; changing the
  default still requires parent integration to verify service/auth/model/review
  behavior, package installation, and no supported default Pi execution path.
