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
| `login()` | Currently fails closed: native provider login and Ship token resolution are not integrated. It never invokes a legacy `opencode auth login` command. |
| `account()` | Uses native OpenCode APIs, but currently fails closed because `credential.list()` does not provide a supported secret/token contract. |
| `billing({ action })` | Uses the Ship cloud API only after supported native credential resolution is integrated. |
| `logout({ session })` | Uses the Ship cloud API only after supported native credential resolution is integrated. |
| `review({ args })` | Uses the shared review facade, whose verdict is bound to the authoritative GitHub PR refs/source or exact local source snapshot. |
| `domain({ command, args })` | Existing status/hash/check/validate behavior backed by delivery domain modules. |
| `command({ command, args })` | Existing serve/test/eval/update utility commands. |

Capabilities that are not wired fail with an explicit missing-capability error;
there are no placeholder success paths. Operations return an integer process
status (or `undefined` for success). Cancellation from a native session maps to
130. Headless resume maps the picker request to continuation; headless calls
without a task fail with an actionable message.

Headless success requires both the assistant's completed `finish: stop` message
and a terminal `idle` message with `outcome: succeeded`; text output alone is not
success. Native thinking levels are passed as model variants. The adapter rejects
`--max-tools`, `--max-seconds`, and `--max-repairs` until the active native
delivery plugin enforces session budgets. It also rejects `--no-delivery`,
`--no-strict`, `--bash-cap`, and `--isolate` until their native policy/plugin
paths enforce them; parsed support is not runtime compatibility. Demo mode and
complete Ship credential/account/billing flows remain integration gaps.

`--json` translates real native session tool lifecycle and completed assistant
messages into the documented `tool_execution_start`, `tool_execution_end`, and
`message_end` JSONL records. It filters to the selected session and reconciles
message history after execution so stream/history projections do not duplicate a
turn.

The disposable real-host adapter smoke is `node tests/native-cli-host-smoke.mjs`.
Set `CTG_OPENCODE_BIN` to the pinned OpenCode 2.0.32 executable and
`CTG_NATIVE_RUNTIME_ROOT` to a native runtime/plugin checkout. It starts its own
temporary profile and local OpenAI-compatible fixture provider, injects that
already-running service through the adapter test seam, and verifies print, a
second print turn in the same session, workspace-scoped continuation when a
newer foreign-workspace session exists, a successful actual tool lifecycle in
JSONL, and explicit rejection of unenforced budget flags. It does not verify normal runtime
service provisioning, profile isolation, or provider login/account/billing.

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
