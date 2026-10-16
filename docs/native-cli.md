# Native OpenCode CLI adapter

`lib/opencode/cli.mjs` is the compatibility boundary for the `ctg` command
surface. It parses the established aliases and flags, chooses interactive vs
headless execution, and dispatches to the native runtime through an injected
port. The current `bin/ctg.mjs` remains the active entrypoint until the native
runtime, Ship credentials, and review/workspace implementations are integrated
and their end-to-end gates pass.

## Runtime integration port

The caller of `runOpenCodeCli()` supplies these concrete capabilities:

| Capability | Request/behavior |
| --- | --- |
| `run({ mode, options, prompt, args })` | Launch native OpenCode interactive or headless (`print`/JSONL) session. Honor `--engine-cli`/`--agent-cli` as an explicit executable override and `--isolate` as extension/skill discovery isolation. |
| `listModels({ query })` | Enumerate models from the native provider catalog, filter the optional query, and print the compatible provider/model/context/token/input/output columns. |
| `login()` | Interactive OpenCode provider login; reject non-TTY calls. |
| `account()` | Display Ship account, grants, and sessions from the credential provider. |
| `billing({ action })` | Create and open Ship checkout or portal link. |
| `logout({ session })` | Revoke named Ship session or current Ship identity and credentials. |
| `review({ args })` | Fresh-context review implementation. Preserve three-attempt admission and bind the verdict to exact remote PR head and local source snapshot. |
| `domain({ command, args })` | Existing status/hash/check/validate behavior backed by delivery domain modules. |
| `command({ command, args })` | Existing serve/test/eval/update utility commands. |

Capabilities that are not wired fail with an explicit missing-capability error;
there are no placeholder success paths. Operations return an integer process
status (or `undefined` for success). Cancellation from a native session maps to
130. Headless resume maps the picker request to continuation; headless calls
without a task fail with an actionable message.

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
- Activation is intentionally staged: integrate this adapter into `bin/ctg.mjs`
  only after the parent integration verifies real service/auth/model/review
  behavior, package installation, and no supported default Pi execution path.
