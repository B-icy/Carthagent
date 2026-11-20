# Module boundaries

First-party code is layered. `tests/architecture.test.mjs` (part of `npm test`)
parses static imports, `export ... from` and literal dynamic `import()` calls
in tracked JavaScript and TypeScript and fails on a forbidden edge.
`eslint.config.mjs` repeats the static-import rules with
`no-restricted-imports`, so editors flag them while typing. ESLint does not see
dynamic imports or TypeScript outside `plugins/`; the test does.

## Layers

| Layer | Paths | May import |
| --- | --- | --- |
| CLI entry | `bin/` | `lib/` only |
| Core library | `lib/` | `lib/`, `vendor/`, packages; two plugin modules listed below |
| Cloud service | `lib/cloud/` | sibling `lib/cloud/` modules and packages only |
| Legacy extensions | `extensions/` | `lib/` only |
| Plugin server | `plugins/carthagent/src/server/`, `src/index.ts`, `src/testing.ts`, `plugins/carthagent/index.ts` | `lib/`, shared plugin contracts, server modules |
| Native UI | `plugins/carthagent/src/ui/`, `src/tui.tsx`, `src/bootstrap.ts`, `plugins/carthagent/tui.ts` | `lib/`, shared plugin contracts, UI modules |
| Shared plugin contracts | `plugins/carthagent/src/rpc.ts`, `src/*-rpc.ts`, `src/daily-goals.mjs`, `src/session-goal.mjs` | `lib/` and packages |
| Tooling and tests | `tools/`, `tests/`, `plugins/carthagent/tests/` | anything; `tools/` does not import `tests/` |

Rules enforced:

- Production code (`bin/`, `lib/`, `extensions/`, `plugins/carthagent/src/`,
  the plugin entry points, `server.mjs`, `evaluate.mjs`) never imports
  `tests/`, `tools/`, `scenarios/` or plugin test code.
- `bin/` and `extensions/` import only `lib/`.
- `lib/` does not import `bin/`, `extensions/` or `plugins/`, except the
  reviewed exceptions below. `lib/cloud/` is self-contained.
- The native UI does not import the plugin server layer, and the plugin server
  does not import the native UI. They share types and RPC names through the
  shared contract modules.
- Only the native UI imports `@opentui/*` and `solid-js`.

## Reviewed exceptions

| From | To | Reason |
| --- | --- | --- |
| `lib/**` | `plugins/carthagent/src/server/framing.mjs` | Dependency-free delivery framing contract shared by the native plugin and the legacy TUI (`lib/guidance.mjs`, `lib/tui/framing.mjs`, `lib/opencode/cli-runtime.mjs`). |
| `lib/opencode/service.mjs` | `plugins/carthagent/src/ui/theme-provision.mjs` | The CLI provisions the default native theme before starting the runtime (dynamic import). The module imports no UI framework. |

Both are real dependencies of `lib/` on plugin code. Moving
`framing.mjs` and `theme-provision.mjs` into `lib/` would remove them. The
test fails when an exception is no longer used, so it must be deleted with the
dependency.

## Changing the rules

Compute the graph first (the test prints every violating import with its
specifier). Add a rule only when it holds for the current code. For a genuine
new cross-layer need, prefer moving the shared module to the lower layer; add
an exception only with a reason, in both `tests/architecture.test.mjs` and this
document.
